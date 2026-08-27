import { useEffect, useState } from "react";
import TeacherShell from "../../components/TeacherShell";
import StudentImport from "../../components/StudentImport";
import { supabase } from "../../lib/supabase";
import { Class, ClassStudent } from "../../lib/types";

interface ClassRow extends Class {
  student_count: number;
  lesson_count: number;
}

export default function Classes() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [register, setRegister] = useState<ClassStudent[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [addId, setAddId] = useState("");
  const [addName, setAddName] = useState("");

  async function loadClasses() {
    const { data } = await supabase
      .from("classes")
      .select("id, teacher_id, name, class_students(count), lessons(count)")
      .order("name");
    setClasses(
      ((data as any[]) ?? []).map((c) => ({
        id: c.id,
        teacher_id: c.teacher_id,
        name: c.name,
        student_count: c.class_students?.[0]?.count ?? 0,
        lesson_count: c.lessons?.[0]?.count ?? 0,
      })),
    );
    setLoading(false);
  }

  async function loadRegister(classId: string) {
    const { data } = await supabase
      .from("class_students")
      .select("id, class_id, student_id, full_name")
      .eq("class_id", classId)
      .order("full_name");
    setRegister((data as any) ?? []);
  }

  useEffect(() => {
    void loadClasses();
  }, []);

  async function createClass() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("classes")
      .insert({ teacher_id: userData.user!.id, name });
    setCreating(false);
    if (error) {
      alert(
        error.code === "23505"
          ? `You already have a class called "${name}".`
          : `Could not create the class: ${error.message}`,
      );
      return;
    }
    setNewName("");
    void loadClasses();
  }

  async function removeClass(c: ClassRow) {
    const warning =
      c.lesson_count > 0
        ? `Delete "${c.name}"? Its register of ${c.student_count} will go too, and ${c.lesson_count} lesson${c.lesson_count === 1 ? "" : "s"} will fall back to asking students for their name.`
        : `Delete "${c.name}" and its register of ${c.student_count}?`;
    if (!confirm(warning)) return;
    await supabase.from("classes").delete().eq("id", c.id);
    if (openId === c.id) setOpenId(null);
    void loadClasses();
  }

  async function open(c: ClassRow) {
    if (openId === c.id) {
      setOpenId(null);
      return;
    }
    setOpenId(c.id);
    setShowImport(false);
    await loadRegister(c.id);
  }

  async function addStudent(classId: string) {
    const sid = addId.trim();
    const name = addName.trim();
    if (!sid || !name) return;
    const { error } = await supabase
      .from("class_students")
      .insert({ class_id: classId, student_id: sid, full_name: name });
    if (error) {
      alert(
        error.code === "23505"
          ? `${sid} is already on this register.`
          : `Could not add the student: ${error.message}`,
      );
      return;
    }
    setAddId("");
    setAddName("");
    await loadRegister(classId);
    void loadClasses();
  }

  async function removeStudent(entry: ClassStudent) {
    if (!confirm(`Remove ${entry.full_name} from this register?`)) return;
    await supabase.from("class_students").delete().eq("id", entry.id);
    await loadRegister(entry.class_id);
    void loadClasses();
  }

  const openClass = classes.find((c) => c.id === openId) ?? null;

  return (
    <TeacherShell>
      <h1 className="font-display text-2xl font-bold text-navy">Classes</h1>
      <p className="mt-2 text-slate-500 max-w-2xl">
        A class holds a register of students. Import the list once, link your
        timetable lessons to it, and a student's first tap matches their ID to the
        name you imported — so the attendance record uses your spelling, not
        theirs.
      </p>

      <div className="mt-6 bg-white border border-slate-200 rounded-xl p-5 max-w-2xl">
        <label className="block text-sm text-slate-600 mb-1">New class</label>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createClass()}
            placeholder="GCSE Biology — Year 10"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2.5"
          />
          <button
            onClick={createClass}
            disabled={!newName.trim() || creating}
            className="bg-navy text-white text-sm font-medium rounded-lg px-4 py-2.5 disabled:opacity-40"
          >
            {creating ? "Adding…" : "Add class"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-3">
        {loading ? (
          <p className="text-slate-400">Loading…</p>
        ) : classes.length === 0 ? (
          <p className="text-slate-400">
            No classes yet. Add one above, then import its student list.
          </p>
        ) : (
          classes.map((c) => (
            <div
              key={c.id}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden"
            >
              <div className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-medium text-slate-900">{c.name}</p>
                  <p className="text-sm text-slate-400">
                    {c.student_count} student{c.student_count === 1 ? "" : "s"} ·{" "}
                    {c.lesson_count === 0
                      ? "not on the timetable yet"
                      : `${c.lesson_count} lesson${c.lesson_count === 1 ? "" : "s"}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => open(c)}
                    className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5"
                  >
                    {openId === c.id ? "Close" : "Register"}
                  </button>
                  <button
                    onClick={() => removeClass(c)}
                    className="text-sm text-halt px-3 py-1.5"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {openId === c.id && (
                <div className="border-t border-slate-100 p-4 bg-slate-50/60">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="font-display font-semibold text-slate-700">
                      Register
                    </h3>
                    <button
                      onClick={() => setShowImport((s) => !s)}
                      className="border border-slate-300 bg-white text-slate-700 text-sm font-medium rounded-lg px-4 py-2"
                    >
                      {showImport ? "Hide import" : "Import CSV"}
                    </button>
                  </div>

                  {showImport && openClass && (
                    <div className="mt-4">
                      <StudentImport
                        classId={openClass.id}
                        className={openClass.name}
                        existing={register}
                        onImported={async () => {
                          setShowImport(false);
                          await loadRegister(openClass.id);
                          void loadClasses();
                        }}
                      />
                    </div>
                  )}

                  <div className="mt-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
                    {register.length === 0 ? (
                      <p className="p-5 text-center text-slate-400 text-sm">
                        Nobody on this register yet. Import a CSV or add students
                        one at a time below.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 text-slate-500 text-left">
                            <tr>
                              <th className="px-4 py-2 font-medium">
                                Student ID
                              </th>
                              <th className="px-4 py-2 font-medium">Name</th>
                              <th className="px-4 py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {register.map((s) => (
                              <tr
                                key={s.id}
                                className="border-t border-slate-100"
                              >
                                <td className="px-4 py-2 font-mono text-xs text-slate-600">
                                  {s.student_id}
                                </td>
                                <td className="px-4 py-2">{s.full_name}</td>
                                <td className="px-4 py-2 text-right">
                                  <button
                                    onClick={() => removeStudent(s)}
                                    className="text-xs text-halt"
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex gap-2 flex-wrap">
                    <input
                      value={addId}
                      onChange={(e) => setAddId(e.target.value)}
                      placeholder="Student ID"
                      className="w-36 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                    <input
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addStudent(c.id)}
                      placeholder="Full name"
                      className="flex-1 min-w-[12rem] border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => addStudent(c.id)}
                      disabled={!addId.trim() || !addName.trim()}
                      className="border border-slate-300 bg-white text-slate-700 text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </TeacherShell>
  );
}
