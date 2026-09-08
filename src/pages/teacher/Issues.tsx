import { useCallback, useEffect, useState } from "react";
import TeacherShell from "../../components/TeacherShell";
import { supabase } from "../../lib/supabase";
import {
  CheckinEvent,
  EmergencyCheckin,
  ERROR_LABELS,
  Lesson,
} from "../../lib/types";

const SELFIE_BUCKET = "emergency-selfies";

export default function Issues() {
  const [pending, setPending] = useState<EmergencyCheckin[]>([]);
  const [events, setEvents] = useState<CheckinEvent[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selfies, setSelfies] = useState<Record<string, string>>({});
  const [lessonId, setLessonId] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPending = useCallback(async () => {
    const { data } = await supabase
      .from("emergency_checkins")
      .select(
        "id, created_at, student_id, full_name, selfie_path, distance_m, " +
          "status, reviewed_at, lessons(subject)",
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    const rows = (data as any as EmergencyCheckin[]) ?? [];
    setPending(rows);

    // Signed URLs, because the bucket is private. Short-lived on purpose.
    const urls: Record<string, string> = {};
    for (const r of rows) {
      if (!r.selfie_path) continue;
      const { data: signed } = await supabase.storage
        .from(SELFIE_BUCKET)
        .createSignedUrl(r.selfie_path, 300);
      if (signed?.signedUrl) urls[r.id] = signed.signedUrl;
    }
    setSelfies(urls);
  }, []);

  const loadEvents = useCallback(async () => {
    let q = supabase
      .from("checkin_events")
      .select(
        "id, created_at, error_code, http_status, tag_code, " +
          "attempted_student_id, had_device_token, distance_m, user_agent, " +
          "lessons(subject)",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    if (lessonId) q = q.eq("lesson_id", lessonId);
    if (date) {
      q = q
        .gte("created_at", `${date}T00:00:00Z`)
        .lte("created_at", `${date}T23:59:59Z`);
    }
    const { data } = await q;
    setEvents((data as any) ?? []);
  }, [lessonId, date]);

  useEffect(() => {
    supabase
      .from("lessons")
      .select("id, subject, day_of_week, start_time, end_time")
      .order("subject")
      .then(({ data }) => setLessons((data as any) ?? []));
  }, []);

  useEffect(() => {
    setLoading(true);
    void Promise.all([loadPending(), loadEvents()]).finally(() =>
      setLoading(false),
    );
  }, [loadPending, loadEvents]);

  // Approve creates the attendance record; reject records the decision. Either
  // way the photo has done its job, so it goes.
  async function review(row: EmergencyCheckin, approve: boolean) {
    setBusy(row.id);
    try {
      const { error } = await supabase.rpc(
        approve ? "approve_emergency_checkin" : "reject_emergency_checkin",
        { emergency_id: row.id },
      );
      if (error) throw new Error(error.message);
      if (row.selfie_path) {
        await supabase.storage.from(SELFIE_BUCKET).remove([row.selfie_path]);
        await supabase
          .from("emergency_checkins")
          .update({ selfie_path: null })
          .eq("id", row.id);
      }
      await Promise.all([loadPending(), loadEvents()]);
    } catch (e: any) {
      alert(e.message ?? "Could not record that decision.");
    } finally {
      setBusy(null);
    }
  }

  async function resetDevice(studentId: string) {
    if (
      !confirm(
        `Unbind ${studentId} from their current phone?\n\n` +
          "The next time they tap a tag they'll enter their ID and this device " +
          "becomes theirs. Use this when a student has lost access to their own record.",
      )
    ) {
      return;
    }
    const { error } = await supabase.rpc("reset_student_device", {
      target_student_id: studentId,
    });
    alert(
      error
        ? `Could not reset: ${error.message}`
        : `${studentId} can register again on their next tap.`,
    );
  }

  return (
    <TeacherShell>
      <h1 className="font-display text-2xl font-bold">Issues</h1>
      <p className="text-slate-500 mt-1">
        Students who couldn't check in, and what stopped them.
      </p>

      {/* ---- Emergency check-ins awaiting a decision ---- */}
      <section className="mt-8">
        <h2 className="font-display font-semibold text-lg">
          Waiting for you{pending.length > 0 && ` · ${pending.length}`}
        </h2>

        {loading ? (
          <p className="text-slate-400 mt-3">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="text-slate-400 mt-3">
            Nothing waiting. Emergency requests appear here with a photo.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {pending.map((r) => (
              <div
                key={r.id}
                className="border border-slate-200 rounded-xl overflow-hidden bg-white"
              >
                {selfies[r.id] ? (
                  <img
                    src={selfies[r.id]}
                    alt={`Photo sent by ${r.full_name}`}
                    className="w-full h-56 object-cover bg-slate-100"
                  />
                ) : (
                  <div className="w-full h-56 bg-slate-100 flex items-center justify-center text-slate-400 text-sm">
                    Photo unavailable
                  </div>
                )}
                <div className="p-4">
                  <p className="font-display font-semibold text-lg">
                    {r.full_name}
                  </p>
                  <p className="text-slate-500 text-sm">
                    {r.student_id} · {r.lessons?.subject ?? "—"}
                  </p>
                  <p className="text-slate-400 text-sm mt-1">
                    {new Date(r.created_at).toLocaleString()}
                    {r.distance_m != null && ` · ${r.distance_m} m away`}
                  </p>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => void review(r, true)}
                      disabled={busy === r.id}
                      className="flex-1 bg-navy text-white font-medium rounded-lg px-4 py-2.5 disabled:opacity-40"
                    >
                      {busy === r.id ? "Saving…" : "Approve"}
                    </button>
                    <button
                      onClick={() => void review(r, false)}
                      disabled={busy === r.id}
                      className="flex-1 border border-slate-300 text-slate-700 font-medium rounded-lg px-4 py-2.5 disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </div>
                  <button
                    onClick={() => void resetDevice(r.student_id)}
                    className="mt-3 text-sm text-slate-500 underline"
                  >
                    Unbind this student's phone
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- The log ---- */}
      <section className="mt-12">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-display font-semibold text-lg">Refused taps</h2>
            <p className="text-slate-500 text-sm mt-1">
              Every check-in the server turned away, and why.
            </p>
          </div>
          <div className="flex gap-2">
            <select
              value={lessonId}
              onChange={(e) => setLessonId(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All lessons</option>
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.subject}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm border border-slate-200 rounded-lg">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Lesson</th>
                <th className="px-3 py-2">Student ID</th>
                <th className="px-3 py-2">What stopped them</th>
                <th className="px-3 py-2">Code</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    Nothing refused in this range.
                  </td>
                </tr>
              ) : (
                events.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {e.lessons?.subject ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {e.attempted_student_id ? (
                        <span className="inline-flex items-center gap-2">
                          {e.attempted_student_id}
                          <button
                            onClick={() =>
                              void resetDevice(e.attempted_student_id!)
                            }
                            className="text-xs text-slate-400 underline"
                          >
                            unbind
                          </button>
                        </span>
                      ) : (
                        <span className="text-slate-400">
                          {e.had_device_token ? "saved device" : "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {ERROR_LABELS[e.error_code] ?? e.error_code}
                      {e.error_code === "out_of_range" &&
                        e.distance_m != null &&
                        ` · ${e.distance_m} m`}
                    </td>
                    <td className="px-3 py-2 text-slate-400 font-mono text-xs">
                      {e.http_status} {e.error_code}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </TeacherShell>
  );
}
