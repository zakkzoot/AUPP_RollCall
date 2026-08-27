// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  corsHeaders,
  distanceMeters,
  json,
  localDowAndMinutes,
  mintDeviceToken,
  timeToMinutes,
} from "../_shared/utils.ts";

const GRACE_MIN = 10; // allow tapping this many minutes before a lesson starts

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // bypasses RLS — server only
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const {
    tag_code,
    device_token = null,
    student_id = null,
    full_name = null,
    lat,
    lng,
  } = body ?? {};

  if (!tag_code) return json({ error: "missing_tag_code" }, 400);
  if (typeof lat !== "number" || typeof lng !== "number") {
    return json({ error: "location_required" }, 400);
  }

  // 1. Tag -> teacher
  const { data: tag } = await supabase
    .from("tags")
    .select("id, teacher_id, teachers(timezone)")
    .eq("tag_code", tag_code)
    .maybeSingle();

  if (!tag) return json({ error: "unknown_tag" }, 404);
  const timezone = (tag as any).teachers?.timezone ?? "UTC";

  // 2. Resolve the active lesson from the timetable (teacher local time)
  const nowLocal = localDowAndMinutes(new Date(), timezone);

  const { data: lessons } = await supabase
    .from("lessons")
    .select(
      "id, subject, start_time, end_time, day_of_week, active, class_id, " +
        "location_id, override_lat, override_lng, override_radius_m, " +
        "locations(lat, lng, radius_m)",
    )
    .eq("teacher_id", tag.teacher_id)
    .eq("day_of_week", nowLocal.dow)
    .eq("active", true);

  const candidates = (lessons ?? []).filter((l: any) => {
    const start = timeToMinutes(l.start_time) - GRACE_MIN;
    const end = timeToMinutes(l.end_time);
    return nowLocal.minutes >= start && nowLocal.minutes <= end;
  });

  if (candidates.length === 0) {
    return json({ error: "no_active_lesson" }, 403);
  }

  // If several overlap, pick the one whose start is nearest to now.
  candidates.sort(
    (a: any, b: any) =>
      Math.abs(timeToMinutes(a.start_time) - nowLocal.minutes) -
      Math.abs(timeToMinutes(b.start_time) - nowLocal.minutes),
  );
  const lesson: any = candidates[0];

  // 3. Location + radius for this lesson
  const loc = lesson.location_id
    ? {
        lat: lesson.locations.lat,
        lng: lesson.locations.lng,
        radius: lesson.locations.radius_m,
      }
    : {
        lat: lesson.override_lat,
        lng: lesson.override_lng,
        radius: lesson.override_radius_m,
      };

  // 4. Geofence
  const distance = distanceMeters(lat, lng, loc.lat, loc.lng);
  if (distance > loc.radius) {
    return json({ error: "out_of_range", distance_m: Math.round(distance) }, 403);
  }

  // 5. Which register applies to this lesson?
  //
  // A lesson linked to a class uses that class's register. A lesson with no
  // class falls back to every register this teacher owns, so names still
  // resolve for a teacher who imported lists but hasn't linked the timetable
  // to them yet. Both cases collapse to a list of class ids to search.
  let registerClassIds: string[] = [];
  if (lesson.class_id) {
    registerClassIds = [lesson.class_id];
  } else {
    const { data: ownClasses } = await supabase
      .from("classes")
      .select("id")
      .eq("teacher_id", tag.teacher_id);
    registerClassIds = (ownClasses ?? []).map((c: any) => c.id);
  }

  // The official name for an ID, or null if it isn't on the register.
  async function lookupOnRegister(id: string): Promise<string | null> {
    if (registerClassIds.length === 0) return null;
    const { data } = await supabase
      .from("class_students")
      .select("full_name")
      .in("class_id", registerClassIds)
      .eq("student_id", id)
      .limit(1)
      .maybeSingle();
    return data?.full_name ?? null;
  }

  // Whether a register exists at all. Decides between turning an unknown ID
  // away and falling back to a student-typed name.
  async function registerHasAnyone(): Promise<boolean> {
    if (registerClassIds.length === 0) return false;
    const { count } = await supabase
      .from("class_students")
      .select("id", { count: "exact", head: true })
      .in("class_id", registerClassIds);
    return (count ?? 0) > 0;
  }

  // 6. Identify student (device binding)
  let student: any = null;
  let mintedToken: string | null = null;
  let status = "ok";
  let flagReason: string | null = null;

  if (device_token) {
    const { data: found } = await supabase
      .from("students")
      .select("id, full_name, student_id")
      .eq("device_token", device_token)
      .maybeSingle();

    if (found) {
      student = found;
      // Returning student. If they also sent a student_id that differs, flag it.
      if (student_id && student_id !== found.student_id) {
        status = "flagged";
        flagReason = "device_reused_different_id";
      }

      // Keep the register as the source of truth for the name. Corrects anyone
      // who registered with a self-typed name before their class was imported.
      const official = await lookupOnRegister(found.student_id);
      if (official && official !== found.full_name) {
        await supabase
          .from("students")
          .update({ full_name: official })
          .eq("id", found.id);
        student.full_name = official;
      }
    }
  }

  if (!student) {
    // New device (or no token) => first registration.
    if (!student_id) {
      return json({ error: "registration_required" }, 400);
    }

    // The register decides the name, so a student never types their own.
    const official = await lookupOnRegister(student_id);
    let name = official;

    if (!name) {
      if (await registerHasAnyone()) {
        // There is a register and this ID isn't on it. Turning them away here is
        // the point of having one — and it stops a guessed ID getting anyone in.
        return json({ error: "not_on_register" }, 403);
      }
      // No register imported yet: fall back to a typed name, asking for it if
      // the phone hasn't sent one.
      if (!full_name) {
        return json({ error: "name_required" }, 400);
      }
      name = full_name;
    }

    // Is this student_id already bound to a different device?
    const { data: existing } = await supabase
      .from("students")
      .select("id")
      .eq("student_id", student_id)
      .maybeSingle();

    if (existing) {
      return json({ error: "id_already_bound" }, 409);
    }

    mintedToken = mintDeviceToken();
    const { data: created, error: createErr } = await supabase
      .from("students")
      .insert({
        student_id,
        full_name: name,
        device_token: mintedToken,
      })
      .select("id, full_name, student_id")
      .single();

    if (createErr || !created) {
      return json({ error: "could_not_register" }, 500);
    }
    student = created;
  }

  // 7. Record the check-in
  const { data: checkin, error: ciErr } = await supabase
    .from("checkins")
    .insert({
      student_id: student.id,
      lesson_id: lesson.id,
      tag_id: tag.id,
      teacher_id: tag.teacher_id,
      lat,
      lng,
      distance_m: Math.round(distance),
      status,
      flag_reason: flagReason,
    })
    .select("checked_in_at")
    .single();

  if (ciErr || !checkin) {
    return json({ error: "could_not_record" }, 500);
  }

  // 8. Response
  return json({
    ok: true,
    device_token: mintedToken ?? device_token,
    full_name: student.full_name,
    subject: lesson.subject,
    checked_in_at: checkin.checked_in_at,
    status,
  });
});
