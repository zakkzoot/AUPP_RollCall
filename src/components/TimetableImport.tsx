import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Class, Lesson, Location } from "../lib/types";
import {
  ParsedRow,
  normRoom,
  parseScheduleCsv,
} from "../lib/timetableCsv";

const TEMPLATE =
  "subject,day_of_week,start_time,end_time,location_name,override_lat,override_lng,override_radius_m\n" +
  "GCSE Biology,Mon,09:00,10:00,Science Block Room 4,,,\n" +
  "Field Trip Prep,Wed,11:00,12:00,,11.5564,104.9282,80\n";

// Where auto-created rooms land until the teacher places them.
const FALLBACK_CENTER = { lat: 11.5564, lng: 104.9282 };

export default function TimetableImport({
  teacherId,
  locations,
  classes,
  existing,
  onImported,
}: {
  teacherId: string;
  locations: Location[];
  classes: Class[];
  existing: Lesson[];
  onImported: () => void;
}) {
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [format, setFormat] = useState<"native" | "university" | null>(null);
  const [committing, setCommitting] = useState(false);
  const [createRooms, setCreateRooms] = useState(false);
  const [roomRadius, setRoomRadius] = useState(60);
  const [createClasses, setCreateClasses] = useState(true);

  function handleText(text: string) {
    const { format: detected, rows: parsed } = parseScheduleCsv(text, {
      locations,
      existing,
    });
    setFormat(detected);
    setRows(parsed);
    setCreateRooms(false);
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => handleText(String(reader.result));
    reader.readAsText(file);
  }

  const missingRooms = [
    ...new Set(
      (rows ?? [])
        .filter((r) => r.status === "needs_room" && r.draft?.roomName)
        .map((r) => r.draft!.roomName!),
    ),
  ];

  const usable = (rows ?? []).filter(
    (r) => r.status === "ok" || (createRooms && r.status === "needs_room"),
  );
  const newClassNames = createClasses
    ? [
        ...new Set(
          usable
            .map((r) => r.draft?.className)
            .filter((n): n is string => !!n)
            .filter((n) => !classes.some((c) => c.name.toLowerCase() === n.toLowerCase())),
        ),
      ]
    : [];

  async function commit() {
    if (usable.length === 0) return;
    setCommitting(true);
    try {
      // 1. Create any rooms the teacher opted to add, then resolve names to ids.
      const roomToId = new Map(locations.map((l) => [normRoom(l.name), l.id]));
      if (createRooms && missingRooms.length) {
        const { data, error } = await supabase
          .from("locations")
          .insert(
            missingRooms.map((name) => ({
              teacher_id: teacherId,
              name,
              lat: FALLBACK_CENTER.lat,
              lng: FALLBACK_CENTER.lng,
              radius_m: roomRadius,
            })),
          )
          .select("id, name");
        if (error) throw new Error(`Could not create rooms: ${error.message}`);
        for (const l of data ?? []) roomToId.set(normRoom(l.name), l.id);
      }

      // 2. Create a class per course section so registers have something to hang on.
      const classToId = new Map(classes.map((c) => [c.name.toLowerCase(), c.id]));
      if (newClassNames.length) {
        const { data, error } = await supabase
          .from("classes")
          .insert(newClassNames.map((name) => ({ teacher_id: teacherId, name })))
          .select("id, name");
        if (error) throw new Error(`Could not create classes: ${error.message}`);
        for (const c of data ?? []) classToId.set(c.name.toLowerCase(), c.id);
      }

      // 3. The lessons themselves.
      const payloads = usable.map((r) => {
        const d = r.draft!;
        const locationId = d.roomName ? (roomToId.get(normRoom(d.roomName)) ?? null) : null;
        return {
          teacher_id: teacherId,
          subject: d.subject,
          day_of_week: d.dow,
          start_time: d.start,
          end_time: d.end,
          active: true,
          class_id:
            createClasses && d.className
              ? (classToId.get(d.className.toLowerCase()) ?? null)
              : null,
          location_id: d.override ? null : locationId,
          override_lat: d.override?.lat ?? null,
          override_lng: d.override?.lng ?? null,
          override_radius_m: d.override?.radius ?? null,
        };
      });

      const { error } = await supabase.from("lessons").insert(payloads as any);
      if (error) throw new Error(`Import failed: ${error.message}`);

      setRows(null);
      setFormat(null);
      onImported();
    } catch (e: any) {
      alert(e.message ?? "Import failed.");
    } finally {
      setCommitting(false);
    }
  }

  const errorCount = (rows ?? []).filter((r) => r.status === "error").length;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display font-semibold text-lg">Import from CSV</h2>
        <button
          onClick={() => {
            const blob = new Blob([TEMPLATE], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "timetable-template.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="text-sm text-slate-600 underline"
        >
          Download template CSV
        </button>
      </div>

      <p className="mt-2 text-sm text-slate-500">
        Takes the university's teaching schedule export as-is — a section meeting
        on two days becomes two lessons — or the simpler template format. The
        layout is detected from the header row.
      </p>

      <div className="mt-4 grid gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="text-sm"
        />
        <p className="text-xs text-slate-400">— or paste rows below —</p>
        <textarea
          rows={4}
          placeholder="Semester,Course,Course Title,Section,Days,Start Time,End Time,Room,Start Date"
          onChange={(e) => e.target.value.trim() && handleText(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
        />
      </div>

      {rows && (
        <div className="mt-5">
          <div className="flex items-center gap-3 flex-wrap text-sm">
            <span className="bg-slate-100 text-slate-600 rounded-full px-3 py-1">
              {format === "university"
                ? "University schedule export"
                : "Template format"}
            </span>
            <span className="text-slate-500">
              {usable.length} lesson{usable.length === 1 ? "" : "s"} ready
              {errorCount > 0 && ` · ${errorCount} with errors`}
            </span>
          </div>

          {format === "university" && (
            <p className="mt-3 text-xs text-slate-400">
              Semester and Start Date are read but not stored — lessons repeat
              weekly until you delete them, so clear last term's timetable before
              importing a new one.
            </p>
          )}

          {missingRooms.length > 0 && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
              <p className="text-amber-900 font-medium">
                {missingRooms.length} room{missingRooms.length === 1 ? "" : "s"} in
                this file {missingRooms.length === 1 ? "isn't" : "aren't"} saved as
                a location yet
              </p>
              <p className="text-amber-800 mt-1">{missingRooms.join(", ")}</p>
              <label className="flex items-start gap-2 mt-3 text-amber-900">
                <input
                  type="checkbox"
                  checked={createRooms}
                  onChange={(e) => setCreateRooms(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  Create them now, then place the pins on the Locations page.
                  They all start at the Phnom Penh default with a{" "}
                  <input
                    type="number"
                    min={5}
                    max={5000}
                    value={roomRadius}
                    onChange={(e) => setRoomRadius(Number(e.target.value))}
                    onClick={(e) => e.stopPropagation()}
                    className="w-20 border border-amber-300 rounded px-2 py-0.5 mx-1"
                  />
                  m radius —{" "}
                  <strong>
                    the geofence won't be meaningful until each pin is moved.
                  </strong>
                </span>
              </label>
            </div>
          )}

          {format === "university" && (
            <label className="flex items-start gap-2 mt-4 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={createClasses}
                onChange={(e) => setCreateClasses(e.target.checked)}
                className="mt-1"
              />
              <span>
                Create a class for each course section, so you can import its
                student register.
                {newClassNames.length > 0 && (
                  <span className="text-slate-400">
                    {" "}
                    Adds: {newClassNames.join(", ")}.
                  </span>
                )}
              </span>
            </label>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm border border-slate-200 rounded-lg">
              <thead className="bg-slate-50 text-slate-500 text-left">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Lesson</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const willImport =
                    r.status === "ok" || (createRooms && r.status === "needs_room");
                  return (
                    <tr
                      key={i}
                      className={`border-t border-slate-100 ${
                        r.status === "error"
                          ? "bg-halt/5"
                          : r.status === "duplicate"
                            ? "bg-slate-50"
                            : ""
                      }`}
                    >
                      <td className="px-3 py-2 text-slate-400">{r.sourceRow}</td>
                      <td className="px-3 py-2">{r.label}</td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                        {r.detail || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {willImport ? (
                          <span className="text-signal font-medium">Ready</span>
                        ) : r.status === "needs_room" ? (
                          <span className="text-amber-700">{r.message}</span>
                        ) : r.status === "duplicate" ? (
                          <span className="text-slate-400">{r.message}</span>
                        ) : (
                          <span className="text-halt">{r.message}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={commit}
              disabled={usable.length === 0 || committing}
              className="bg-navy text-white font-medium rounded-lg px-5 py-2.5 disabled:opacity-40"
            >
              {committing
                ? "Importing…"
                : `Import ${usable.length} lesson${usable.length === 1 ? "" : "s"}`}
            </button>
            <button
              onClick={() => {
                setRows(null);
                setFormat(null);
              }}
              className="text-slate-500 px-3 py-2.5"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
