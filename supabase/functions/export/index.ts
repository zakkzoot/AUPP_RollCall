// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/utils.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Verify caller identity from their Supabase JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    return new Response("unauthorized", { status: 401, headers: corsHeaders });
  }

  const authClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response("unauthorized", { status: 401, headers: corsHeaders });
  }
  const teacherId = userData.user.id;

  // Query with service role, but always filter to this teacher's rows.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const url = new URL(req.url);
  const date = url.searchParams.get("date"); // YYYY-MM-DD
  const lessonId = url.searchParams.get("lesson_id");

  let q = admin
    .from("checkins")
    .select(
      "checked_in_at, status, flag_reason, distance_m, " +
        "students(full_name, student_id), lessons(subject)",
    )
    .eq("teacher_id", teacherId)
    .order("checked_in_at", { ascending: false });

  if (lessonId) q = q.eq("lesson_id", lessonId);
  if (date) {
    q = q.gte("checked_in_at", `${date}T00:00:00Z`).lte(
      "checked_in_at",
      `${date}T23:59:59Z`,
    );
  }

  const { data, error } = await q;
  if (error) {
    return new Response("query_failed", { status: 500, headers: corsHeaders });
  }

  const header = [
    "checked_in_at",
    "student_name",
    "student_id",
    "subject",
    "status",
    "flag_reason",
    "distance_m",
  ];
  const rows = (data ?? []).map((r: any) =>
    [
      r.checked_in_at,
      r.students?.full_name,
      r.students?.student_id,
      r.lessons?.subject,
      r.status,
      r.flag_reason,
      r.distance_m,
    ]
      .map(csvCell)
      .join(","),
  );
  const csv = [header.join(","), ...rows].join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance${date ? "-" + date : ""}.csv"`,
    },
  });
});
