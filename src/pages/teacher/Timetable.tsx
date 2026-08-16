import { useEffect, useState } from "react";
import TeacherShell from "../../components/TeacherShell";
import TimetableImport from "../../components/TimetableImport";
import MapPicker from "../../components/MapPicker";
import { supabase } from "../../lib/supabase";
import { DOW_LABELS, Lesson, Location } from "../../lib/types";

const DEFAULT_CENTER = { lat: 11.5564, lng: 104.9282 };

type Draft = {
  id?: string;
  subject: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  useOverride: boolean;
  location_id: string;
  override_lat: number;
  override_lng: number;
  override_radius_m: number;
};

const emptyDraft = (): Draft => ({
  subject: "",
  day_of_week: 1,
  start_time: "09:00",
  end_time: "10:00",
  useOverride: false,
  location_id: "",
  override_lat: DEFAULT_CENTER.lat,
  override_lng: DEFAULT_CENTER.lng,
  override_radius_m: 50,
});

export default function Timetable() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [teacherId, setTeacherId] = useState<string>("");
  const [showImport, setShowImport] = useState(false);

  async function load() {
    const { data: l } = await supabase
      .from("lessons")
      .select("*, locations(name)")
      .order("day_of_week")
      .order("start_time");
    setLessons((l as any) ?? []);
    const { data: locs } = await supabase
      .from("locations")
      .select("*")
      .order("name");
    setLocations((locs as any) ?? []);
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setTeacherId(data.user?.id ?? ""));
    void load();
  }, []);

  function startNew() {
    const d = emptyDraft();
    if (locations[0]) d.location_id = locations[0].id;
    setDraft(d);
  }

  function editLesson(l: Lesson) {
    setDraft({
      id: l.id,
      subject: l.subject,
      day_of_week: l.day_of_week,
      start_time: l.start_time.slice(0, 5),
      end_time: l.end_time.slice(0, 5),
      useOverride: l.location_id === null,
      location_id: l.location_id ?? locations[0]?.id ?? "",
      override_lat: l.override_lat ?? DEFAULT_CENTER.lat,
      override_lng: l.override_lng ?? DEFAULT_CENTER.lng,
      override_radius_m: l.override_radius_m ?? 50,
    });
  }

  async function save() {
    if (!draft || !draft.subject.trim()) return;
    const base: Record<string, unknown> = {
      teacher_id: teacherId,
      subject: draft.subject.trim(),
      day_of_week: draft.day_of_week,
      start_time: `${draft.start_time}:00`,
      end_time: `${draft.end_time}:00`,
      active: true,
    };
    const payload: Record<string, unknown> = draft.useOverride
      ? {
          ...base,
          location_id: null,
          override_lat: draft.override_lat,
          override_lng: draft.override_lng,
          override_radius_m: draft.override_radius_m,
        }
      : {
          ...base,
          location_id: draft.location_id,
          override_lat: null,
          override_lng: null,
          override_radius_m: null,
        };

    if (!draft.useOverride && !draft.location_id) {
      alert("Pick a saved location or switch to a one-off location.");
      return;
    }

    if (draft.id) {
      await supabase.from("lessons").update(payload as any).eq("id", draft.id);
    } else {
      await supabase.from("lessons").insert(payload as any);
    }
    setDraft(null);
    void load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this lesson?")) return;
    await supabase.from("lessons").delete().eq("id", id);
    void load();
  }

  const byDay = DOW_LABELS.map((label, dow) => ({
    label,
    dow,
    items: lessons.filter((l) => l.day_of_week === dow),
  })).filter((d) => d.items.length > 0);

  return (
    <TeacherShell>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-2xl font-bold text-navy">Timetable</h1>
        {!draft && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowImport((s) => !s)}
              className="border border-slate-300 text-slate-700 text-sm font-medium rounded-lg px-4 py-2"
            >
              {showImport ? "Hide import" : "Import CSV"}
            </button>
            <button
              onClick={startNew}
              className="bg-navy text-white text-sm font-medium rounded-lg px-4 py-2"
            >
              Add lesson
            </button>
          </div>
        )}
      </div>

      {locations.length === 0 && (
        <p className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          Add at least one location first, or use a one-off location when
          creating a lesson.
        </p>
      )}

      {showImport && !draft && teacherId && (
        <div className="mt-5">
          <TimetableImport
            teacherId={teacherId}
            locations={locations}
            existing={lessons}
            onImported={() => {
              setShowImport(false);
              void load();
            }}
          />
        </div>
      )}

      {draft ? (
        <div className="mt-6 bg-white border border-slate-200 rounded-xl p-6 max-w-2xl">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm text-slate-600 mb-1">Subject</label>
              <input
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                placeholder="GCSE Biology"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Day</label>
              <select
                value={draft.day_of_week}
                onChange={(e) =>
                  setDraft({ ...draft, day_of_week: Number(e.target.value) })
                }
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5"
              >
                {DOW_LABELS.map((d, i) => (
                  <option key={i} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm text-slate-600 mb-1">Start</label>
                <input
                  type="time"
                  value={draft.start_time}
                  onChange={(e) =>
                    setDraft({ ...draft, start_time: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">End</label>
                <input
                  type="time"
                  value={draft.end_time}
                  onChange={(e) =>
                    setDraft({ ...draft, end_time: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5"
                />
              </div>
            </div>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-5">
            <div className="flex items-center gap-4 mb-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={!draft.useOverride}
                  onChange={() => setDraft({ ...draft, useOverride: false })}
                />
                Saved location
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={draft.useOverride}
                  onChange={() => setDraft({ ...draft, useOverride: true })}
                />
                One-off location
              </label>
            </div>

            {!draft.useOverride ? (
              <select
                value={draft.location_id}
                onChange={(e) =>
                  setDraft({ ...draft, location_id: e.target.value })
                }
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5"
              >
                <option value="">Select a location…</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.radius_m} m)
                  </option>
                ))}
              </select>
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <label className="text-sm text-slate-600">Radius (m)</label>
                  <input
                    type="number"
                    min={5}
                    max={5000}
                    value={draft.override_radius_m}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        override_radius_m: Number(e.target.value),
                      })
                    }
                    className="w-28 border border-slate-300 rounded-lg px-3 py-2"
                  />
                  <span className="text-xs text-slate-400">
                    {draft.override_lat.toFixed(5)}, {draft.override_lng.toFixed(5)}
                  </span>
                </div>
                <MapPicker
                  lat={draft.override_lat}
                  lng={draft.override_lng}
                  radius={draft.override_radius_m}
                  onChange={(lat, lng) =>
                    setDraft({ ...draft, override_lat: lat, override_lng: lng })
                  }
                />
              </div>
            )}
          </div>

          <div className="mt-5 flex gap-2">
            <button
              onClick={save}
              className="bg-navy text-white font-medium rounded-lg px-5 py-2.5"
            >
              Save lesson
            </button>
            <button
              onClick={() => setDraft(null)}
              className="text-slate-500 px-4 py-2.5"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {byDay.length === 0 && (
            <p className="text-slate-400">No lessons yet. Add one or import a CSV.</p>
          )}
          {byDay.map((day) => (
            <div key={day.dow}>
              <h2 className="font-display font-semibold text-slate-500 text-sm uppercase tracking-wide mb-2">
                {day.label}
              </h2>
              <div className="grid gap-2">
                {day.items.map((l) => (
                  <div
                    key={l.id}
                    className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{l.subject}</p>
                      <p className="text-sm text-slate-400">
                        {l.start_time.slice(0, 5)}–{l.end_time.slice(0, 5)} ·{" "}
                        {l.location_id
                          ? (l.locations?.name ?? "saved location")
                          : "one-off location"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => editLesson(l)}
                        className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => remove(l.id)}
                        className="text-sm text-halt px-3 py-1.5"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </TeacherShell>
  );
}
