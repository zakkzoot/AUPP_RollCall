import { useEffect, useState } from "react";
import TeacherShell from "../../components/TeacherShell";
import MapPicker from "../../components/MapPicker";
import { supabase } from "../../lib/supabase";
import { Location } from "../../lib/types";

const DEFAULT_CENTER = { lat: 11.5564, lng: 104.9282 }; // Phnom Penh fallback

export default function Locations() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [editing, setEditing] = useState<Partial<Location> | null>(null);

  async function load() {
    const { data } = await supabase
      .from("locations")
      .select("*")
      .order("name");
    setLocations((data as any) ?? []);
  }
  useEffect(() => {
    void load();
  }, []);

  function startNew() {
    setEditing({
      name: "",
      lat: DEFAULT_CENTER.lat,
      lng: DEFAULT_CENTER.lng,
      radius_m: 50,
    });
  }

  async function save() {
    if (!editing || !editing.name?.trim()) return;
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      teacher_id: userData.user!.id,
      name: editing.name.trim(),
      lat: editing.lat,
      lng: editing.lng,
      radius_m: editing.radius_m,
    };
    if (editing.id) {
      await supabase.from("locations").update(payload).eq("id", editing.id);
    } else {
      await supabase.from("locations").insert(payload);
    }
    setEditing(null);
    void load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this location? Lessons using it will lose their location.")) return;
    await supabase.from("locations").delete().eq("id", id);
    void load();
  }

  return (
    <TeacherShell>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-navy">Locations</h1>
        {!editing && (
          <button
            onClick={startNew}
            className="bg-navy text-white text-sm font-medium rounded-lg px-4 py-2"
          >
            Add location
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-6 bg-white border border-slate-200 rounded-xl p-6 max-w-2xl">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm text-slate-600 mb-1">Name</label>
              <input
                value={editing.name ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                placeholder="Science Block Room 4"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">
                Radius (metres)
              </label>
              <input
                type="number"
                min={5}
                max={5000}
                value={editing.radius_m ?? 50}
                onChange={(e) =>
                  setEditing({ ...editing, radius_m: Number(e.target.value) })
                }
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5"
              />
            </div>
            <div className="col-span-2 text-xs text-slate-400">
              Lat {editing.lat?.toFixed(6)}, Lng {editing.lng?.toFixed(6)} — click
              the map or drag the pin. You can also paste coordinates below.
            </div>
            <div className="col-span-2">
              <input
                placeholder="Paste 'lat, lng' from Google Maps"
                onChange={(e) => {
                  const m = e.target.value.split(",").map((s) => Number(s.trim()));
                  if (m.length === 2 && !isNaN(m[0]) && !isNaN(m[1])) {
                    setEditing({ ...editing, lat: m[0], lng: m[1] });
                  }
                }}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="mt-4">
            <MapPicker
              lat={editing.lat ?? DEFAULT_CENTER.lat}
              lng={editing.lng ?? DEFAULT_CENTER.lng}
              radius={editing.radius_m ?? 50}
              onChange={(lat, lng) => setEditing({ ...editing, lat, lng })}
            />
          </div>

          <div className="mt-5 flex gap-2">
            <button
              onClick={save}
              className="bg-navy text-white font-medium rounded-lg px-5 py-2.5"
            >
              Save location
            </button>
            <button
              onClick={() => setEditing(null)}
              className="text-slate-500 px-4 py-2.5"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-3">
          {locations.length === 0 && (
            <p className="text-slate-400">
              No saved locations yet. Add the rooms you teach in.
            </p>
          )}
          {locations.map((l) => (
            <div
              key={l.id}
              className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between"
            >
              <div>
                <p className="font-medium text-slate-900">{l.name}</p>
                <p className="text-sm text-slate-400">
                  {l.lat.toFixed(5)}, {l.lng.toFixed(5)} · {l.radius_m} m radius
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(l)}
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
      )}
    </TeacherShell>
  );
}
