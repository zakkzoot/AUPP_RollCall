import { useState } from "react";
import Papa from "papaparse";
import { supabase } from "../lib/supabase";
import { ClassStudent } from "../lib/types";

interface RawRow {
  student_id?: string;
  full_name?: string;
}

interface ParsedRow {
  status: "ok" | "error" | "duplicate";
  message?: string;
  payload?: Record<string, unknown>;
  raw: RawRow;
}

const TEMPLATE =
  "student_id,full_name\n" +
  "S12345,Sokha Chan\n" +
  "S12346,Dara Pich\n";

export default function StudentImport({
  classId,
  className,
  existing,
  onImported,
}: {
  classId: string;
  className: string;
  existing: ClassStudent[];
  onImported: () => void;
}) {
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [committing, setCommitting] = useState(false);

  function validate(raw: RawRow, seen: Set<string>): ParsedRow {
    const studentId = (raw.student_id ?? "").trim();
    const fullName = (raw.full_name ?? "").trim();

    if (!studentId) return { status: "error", message: "missing student_id", raw };
    if (!fullName) return { status: "error", message: "missing full_name", raw };

    const key = studentId.toLowerCase();
    if (seen.has(key)) {
      return { status: "duplicate", message: "repeated in this file — skipped", raw };
    }
    seen.add(key);

    if (existing.some((e) => e.student_id.toLowerCase() === key)) {
      return { status: "duplicate", message: "already on the register — skipped", raw };
    }

    return {
      status: "ok",
      payload: { class_id: classId, student_id: studentId, full_name: fullName },
      raw,
    };
  }

  function handleText(text: string) {
    const result = Papa.parse<RawRow>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
    });
    const seen = new Set<string>();
    setRows((result.data ?? []).map((r) => validate(r, seen)));
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
    const { error } = await supabase
      .from("class_students")
      .insert(toInsert as any);
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
        <h2 className="font-display font-semibold text-lg">
          Import students into {className}
        </h2>
        <button
          onClick={() => {
            const blob = new Blob([TEMPLATE], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "class-register-template.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="text-sm text-slate-600 underline"
        >
          Download template CSV
        </button>
      </div>

      <p className="mt-2 text-sm text-slate-500">
        Two columns: <code className="text-slate-700">student_id</code> and{" "}
        <code className="text-slate-700">full_name</code>. Spell the names the way
        you want them to appear on the attendance record — this is what students
        get matched to, so they never type their own name.
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
          placeholder={"student_id,full_name\nS12345,Sokha Chan"}
          onChange={(e) => e.target.value.trim() && handleText(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
        />
      </div>

      {rows && (
        <div className="mt-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-slate-200 rounded-lg">
              <thead className="bg-slate-50 text-slate-500 text-left">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Name</th>
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
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.raw.student_id || "—"}
                    </td>
                    <td className="px-3 py-2">{r.raw.full_name || "—"}</td>
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
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={commit}
              disabled={okCount === 0 || committing}
              className="bg-navy text-white font-medium rounded-lg px-5 py-2.5 disabled:opacity-40"
            >
              {committing
                ? "Importing…"
                : `Import ${okCount} student${okCount === 1 ? "" : "s"}`}
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
