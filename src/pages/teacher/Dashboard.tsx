import { useEffect, useState } from "react";
import TeacherShell from "../../components/TeacherShell";
import { supabase, EXPORT_FN_URL } from "../../lib/supabase";
import { Checkin, Lesson } from "../../lib/types";

export default function Dashboard() {
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [date, setDate] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    let q = supabase
      .from("checkins")
      .select(
        "id, checked_in_at, status, flag_reason, distance_m, " +
          "students(full_name, student_id), lessons(subject)",
      )
      .order("checked_in_at", { ascending: false })
      .limit(500);

    if (lessonId) q = q.eq("lesson_id", lessonId);
    if (date) {
      q = q
        .gte("checked_in_at", `${date}T00:00:00Z`)
        .lte("checked_in_at", `${date}T23:59:59Z`);
    }
    const { data } = await q;
    setCheckins((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    supabase
      .from("lessons")
      .select("id, subject, day_of_week, start_time, end_time")
      .order("subject")
      .then(({ data }) => setLessons((data as any) ?? []));
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, lessonId]);

  async function exportCsv() {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return;
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (lessonId) params.set("lesson_id", lessonId);
    const res = await fetch(`${EXPORT_FN_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance${date ? "-" + date : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <TeacherShell>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-2xl font-bold text-navy">Attendance</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
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
          {(date || lessonId) && (
            <button
              onClick={() => {
                setDate("");
                setLessonId("");
              }}
              className="text-sm text-slate-500 hover:text-slate-800 px-2"
            >
              Clear
            </button>
          )}
          <button
            onClick={exportCsv}
            className="bg-navy text-white text-sm font-medium rounded-lg px-4 py-2"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="mt-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-slate-400">Loading…</p>
        ) : checkins.length === 0 ? (
          <p className="p-8 text-center text-slate-400">
            No check-ins yet for this view.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <Th>Time</Th>
                <Th>Student</Th>
                <Th>ID</Th>
                <Th>Lesson</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {checkins.map((c) => (
                <tr
                  key={c.id}
                  className={`border-t border-slate-100 ${
                    c.status === "flagged" ? "bg-halt/5" : ""
                  }`}
                >
                  <Td>
                    {new Date(c.checked_in_at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Td>
                  <Td>{c.students?.full_name ?? "—"}</Td>
                  <Td className="text-slate-500">
                    {c.students?.student_id ?? "—"}
                  </Td>
                  <Td>{c.lessons?.subject ?? "—"}</Td>
                  <Td>
                    {c.status === "flagged" ? (
                      <span className="text-halt font-medium">
                        Flagged
                        {c.flag_reason ? ` · ${c.flag_reason}` : ""}
                      </span>
                    ) : (
                      <span className="text-signal font-medium">OK</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </TeacherShell>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-medium">{children}</th>;
}
function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}
