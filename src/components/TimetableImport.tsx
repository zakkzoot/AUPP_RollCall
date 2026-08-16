import { useState } from "react";
import Papa from "papaparse";
import { supabase } from "../lib/supabase";
import { Lesson, Location } from "../lib/types";

interface RawRow {
  subject?: string;
  day_of_week?: string;
  start_time?: string;
  end_time?: string;
  location_name?: string;
  override_lat?: string;
  override_lng?: string;
  override_radius_m?: string;
}

interface ParsedRow {
  status: "ok" | "error" | "duplicate";
  message?: string;
  payload?: Record<string, unknown>;
  raw: RawRow;
}

const DOW_MAP: Record<string, number> = {
  sun: 0, sunday: 0, "0": 0,
  mon: 1, monday: 1, "1": 1,
  tue: 2, tues: 2, tuesday: 2, "2": 2,
  wed: 3, weds: 3, wednesday: 3, "3": 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, "4": 4,
  fri: 5, friday: 5, "5": 5,
  sat: 6, saturday: 6, "6": 6,
};

function normDow(v: string): number | null {
  const k = v.trim().toLowerCase();
  return k in DOW_MAP ? DOW_MAP[k] : null;
}

function normTime(v: string): string | null {
  const s = v.trim().toLowerCase().replace(/\s/g, "");
  // 9am / 9:30pm
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2] ? parseInt(ampm[2], 10) : 0;
    if (ampm[3] === "pm" && h !== 12) h += 12;
    if (ampm[3] === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  }
  // 24h HH:MM or H:MM
  const hhmm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const h = parseInt(hhmm[1], 10);
    const m = parseInt(hhmm[2], 10);
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  }
  return null;
}

function toMin(t: string) {
  const [h, m] = t.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

const TEMPLATE =
  "subject,day_of_week,start_time,end_time,location_name,override_lat,override_lng,override_radius_m\n" +
  "GCSE Biology,Mon,09:00,10:00,Science Block Room 4,,,\n" +
  "Field Trip Prep,Wed,11:00,12:00,,11.5564,104.9282,80\n";

export default function TimetableImport({
  teacherId,
  locations,
  existing,
  onImported,
}: {
  teacherId: string;
  locations: Location[];
  existing: Lesson[];
  onImported: () => void;
}) {
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [committing, setCommitting] = useState(false);

  function locByName(name: string): Location | undefined {
    const n = name.trim().toLowerCase();
    return locations.find((l) => l.name.toLowerCase() === n);
  }

  function isDuplicate(p: Record<string, unknown>): boolean {
    return existing.some(
      (e) =>
        e.subject.toLowerCase() === String(p.subject).toLowerCase() &&
        e.day_of_week === p.day_of_week &&
        e.start_time === p.start_time &&
        e.end_time === p.end_time &&
        (e.location_id ?? null) === (p.location_id ?? null),
    );
  }

  function validate(raw: RawRow): ParsedRow {
    const subject = (raw.subject ?? "").trim();
    if (!subject) return { status: "error", message: "missing subject", raw };

    const dow = normDow(raw.day_of_week ?? "");
    if (dow === null)
      return { status: "error", message: `bad day_of_week "${raw.day_of_week}"`, raw };

    const start = normTime(raw.start_time ?? "");
    const end = normTime(raw.end_time ?? "");
    if (!start) return { status: "error", message: `bad start_time "${raw.start_time}"`, raw };
    if (!end) return { status: "error", message: `bad end_time "${raw.end_time}"`, raw };
    if (toMin(end) <= toMin(start))
      return { status: "error", message: "end_time must be after start_time", raw };

    const locName = (raw.location_name ?? "").trim();
    const hasOverride =
      (raw.override_lat ?? "").trim() !== "" ||
      (raw.override_lng ?? "").trim() !== "" ||
      (raw.override_radius_m ?? "").trim() !== "";

    let payload: Record<string, unknown> = {
      teacher_id: teacherId,
      subject,
      day_of_week: dow,
      start_time: start,
      end_time: end,
      active: true,
    };

    if (locName && hasOverride) {
      return {
        status: "error",
        message: "set either a location name OR an override, not both",
        raw,
      };
    }

    if (locName) {
      const loc = locByName(locName);
      if (!loc)
        return {
          status: "error",
          message: `unknown location "${locName}" — create it in Locations first`,
          raw,
        };
      payload = {
        ...payload,
        location_id: loc.id,
        override_lat: null,
        override_lng: null,
        override_radius_m: null,
      };
    } else if (hasOverride) {
      const lat = Number(raw.override_lat);
      const lng = Number(raw.override_lng);
      const rad = Number(raw.override_radius_m);
      if (isNaN(lat) || isNaN(lng) || isNaN(rad))
        return {
          status: "error",
          message: "override_lat, override_lng and override_radius_m must all be numbers",
          raw,
        };
      payload = {
        ...payload,
        location_id: null,
        override_lat: lat,
        override_lng: lng,
        override_radius_m: rad,
      };
    } else {
      return {
        status: "error",
        message: "no location — give a location_name or an override",
        raw,
      };
    }

    if (isDuplicate(payload)) {
      return { status: "duplicate", message: "already in timetable — skipped", raw, payload };
    }
    return { status: "ok", payload, raw };
  }

  function handleText(text: string) {
    const result = Papa.parse<RawRow>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
    });
    setRows((result.data ?? []).map(validate));
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => handleText(String(reader.result));
    reader.readAsText(file);
  }

  async function commit() {
    if (!rows) return;
    const toInsert = rows.filter((r) => r.status === "ok").map((r) => r.payload!);
    if (toInsert.length === 0) return;
    setCommitting(true);
    const { error } = await supabase.from("lessons").insert(toInsert as any);
    setCommitting(false);
    if (!error) {
      setRows(null);
      onImported();
    } else {
      alert(`Import failed: ${error.message}`);
    }
  }

  const okCount = rows?.filter((r) => r.status === "ok").length ?? 0;

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
          placeholder="subject,day_of_week,start_time,end_time,location_name,..."
          onChange={(e) => e.target.value.trim() && handleText(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
        />
      </div>

      {rows && (
        <div className="mt-5">
          <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
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
                  <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2">{r.raw.subject || "—"}</td>
                  <td className="px-3 py-2">
                    {r.status === "ok" && (
                      <span className="text-signal font-medium">Ready</span>
                    )}
                    {r.status === "duplicate" && (
                      <span className="text-slate-400">{r.message}</span>
                    )}
                    {r.status === "error" && (
                      <span className="text-halt">{r.message}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={commit}
              disabled={okCount === 0 || committing}
              className="bg-navy text-white font-medium rounded-lg px-5 py-2.5 disabled:opacity-40"
            >
              {committing ? "Importing…" : `Import ${okCount} lesson${okCount === 1 ? "" : "s"}`}
            </button>
            <button
              onClick={() => setRows(null)}
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
