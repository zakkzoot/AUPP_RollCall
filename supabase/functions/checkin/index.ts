// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  corsHeaders,
  distanceMeters,
  json,
  localDowAndMinutes,
  mintDeviceToken,
  selectLesson,
} from "../_shared/utils.ts";

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

  const mode = body?.mode === "emergency" ? "emergency" : "normal";

  // Everything known about this attempt so far. Filled in as the request gets
  // further, so a refusal is logged against the lesson it was refused for.
  const ctx: {
    teacher_id: string | null;
    tag_id: string | null;
    lesson_id: string | null;
    distance_m: number | null;
  } = { teacher_id: null, tag_id: null, lesson_id: null, distance_m: null };

  // Refuse, and record why. The log is a side effect: if writing it fails the
  // student still gets the real answer, because a broken log must never become
  // a second outage.
  async function fail(error: string, status: number, extra: Record<string, unknown> = {}) {
    try {
      await supabase.from("checkin_events").insert({
        teacher_id: ctx.teacher_id,
        tag_id: ctx.tag_id,
        lesson_id: ctx.lesson_id,
        tag_code: tag_code ?? null,
        attempted_student_id: student_id ?? null,
        error_code: error,
        http_status: status,
        had_device_token: !!device_token,
        lat: typeof lat === "number" ? lat : null,
        lng: typeof lng === "number" ? lng : null,
        distance_m: ctx.distance_m,
        user_agent: req.headers.get("user-agent"),
      });
    } catch {
      // Swallowed on purpose. See above.
    }
    return json({ error, ...extra }, status);
  }

  if (!tag_code) return await fail("missing_tag_code", 400);
  if (typeof lat !== "number" || typeof lng !== "number") {
    return await fail("location_required", 400);
  }

  // 1. Tag -> teacher
  const { data: tag } = await supabase
    .from("tags")
    .select("id, teacher_id, teachers(timezone)")
    .eq("tag_code", tag_code)
    .maybeSingle();

  if (!tag) return await fail("unknown_tag", 404);
  ctx.teacher_id = tag.teacher_id;
  ctx.tag_id = tag.id;
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

  // Grace either side of the scheduled time; a lesson in session beats one
  // that is only within grace. See selectLesson in _shared/utils.ts.
  const lesson: any = selectLesson((lessons ?? []) as any[], nowLocal.minutes);

  if (!lesson) {
    return await fail("no_active_lesson", 403);
  }
  ctx.lesson_id = lesson.id;

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
  ctx.distance_m = Math.round(distance);
  if (distance > loc.radius) {
    return await fail("out_of_range", 403, { distance_m: Math.round(distance) });
  }

  // 5. Emergency check-in.
  //
  // For a student whose phone can't identify itself — a lost device token, an
  // ID already bound, anything at all. It reaches here only after the tag, the
  // lesson and the geofence have all resolved, so it is no easier to abuse than
  // a normal tap: the selfie proves who, the geofence proves where.
  //
  // Nothing is recorded as attendance. A pending row waits for the teacher.
  if (mode === "emergency") {
    if (!student_id || !full_name) {
      return await fail("emergency_details_required", 400);
    }
    const selfie: string = body?.selfie ?? "";
    const base64 = selfie.startsWith("data:")
      ? selfie.slice(selfie.indexOf(",") + 1)
      : "";
    if (!base64) {
      return await fail("selfie_required", 400);
    }
    // Roughly the decoded byte count, checked before allocating it.
    if (base64.length * 0.75 > 1_500_000) {
      return await fail("selfie_too_large", 413);
    }

    const emergencyId = crypto.randomUUID();
    const path = `${tag.teacher_id}/${emergencyId}.jpg`;

    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    } catch {
      return await fail("selfie_unreadable", 400);
    }

    const { error: upErr } = await supabase.storage
      .from("emergency-selfies")
      .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (upErr) {
      return await fail("selfie_upload_failed", 500);
    }

    const { error: emErr } = await supabase.from("emergency_checkins").insert({
      id: emergencyId,
      teacher_id: tag.teacher_id,
      lesson_id: lesson.id,
      tag_id: tag.id,
      student_id,
      full_name,
      selfie_path: path,
      lat,
      lng,
      distance_m: Math.round(distance),
    });

    if (emErr) {
      // A duplicate is the partial unique index doing its job: this student
      // already has a request waiting on this lesson. Tell them it's in hand
      // rather than inviting them to try again.
      const already = (emErr as any).code === "23505";
      await supabase.storage.from("emergency-selfies").remove([path]);
      if (already) {
        return json({ ok: true, pending: true, already_pending: true });
      }
      return await fail("emergency_failed", 500);
    }

    return json({ ok: true, pending: true, subject: lesson.subject });
  }

  // 6. Which register applies to this lesson?
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
      return await fail("registration_required", 400);
    }

    // The register decides the name, so a student never types their own.
    const official = await lookupOnRegister(student_id);
    let name = official;

    if (!name) {
      if (await registerHasAnyone()) {
        // There is a register and this ID isn't on it. Turning them away here is
        // the point of having one — and it stops a guessed ID getting anyone in.
        return await fail("not_on_register", 403);
      }
      // No register imported yet: fall back to a typed name, asking for it if
      // the phone hasn't sent one.
      if (!full_name) {
        return await fail("name_required", 400);
      }
      name = full_name;
    }

    // Is this student_id already bound to a device?
    const { data: existing } = await supabase
      .from("students")
      .select("id, device_token")
      .eq("student_id", student_id)
      .maybeSingle();

    // A row with a live token belongs to a phone that is still using it.
    if (existing?.device_token) {
      return await fail("id_already_bound", 409);
    }

    mintedToken = mintDeviceToken();

    if (existing) {
      // A null token means the binding was deliberately cleared — a teacher
      // pressed reset, or an approved emergency check-in created the row. Bind
      // this phone rather than turning the student away: losing a token is not
      // something a student can do anything about, and until now there was no
      // way back at all.
      const { data: rebound, error: rebindErr } = await supabase
        .from("students")
        .update({ device_token: mintedToken, full_name: name })
        .eq("id", existing.id)
        .select("id, full_name, student_id")
        .single();

      if (rebindErr || !rebound) {
        return await fail("could_not_register", 500);
      }
      student = rebound;
    } else {
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
        return await fail("could_not_register", 500);
      }
      student = created;
    }
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
    return await fail("could_not_record", 500);
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
