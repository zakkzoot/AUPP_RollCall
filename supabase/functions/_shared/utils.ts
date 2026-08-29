// Shared helpers for Edge Functions.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // tighten to your Vercel origin in production if desired
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extra },
  });
}

// Haversine distance in metres between two lat/lng points.
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000; // Earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Resolve "now" into a given IANA timezone as { dow, minutes }.
// dow: 0=Sun..6=Sat (matches JS getDay and the lessons.day_of_week column).
// minutes: minutes since local midnight.
export function localDowAndMinutes(
  now: Date,
  timeZone: string,
): { dow: number; minutes: number } {
  // Use Intl to read the wall-clock parts in the target timezone.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = dowMap[map.weekday] ?? 0;
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // some environments render midnight as 24
  const minute = parseInt(map.minute, 10);
  return { dow, minutes: hour * 60 + minute };
}

// Parse a Postgres TIME string ("09:00:00" or "09:00") to minutes since midnight.
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

// Long, unguessable device token.
export function mintDeviceToken(): string {
  return crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
}

// ---------------------------------------------------------------------------
// Which lesson does a tap at this moment belong to?
//
// Taps are accepted for a grace period either side of the scheduled time, so
// students arriving early or packing up late still register. Two-sided grace
// makes back-to-back lessons overlap, so the choice between them matters:
//
//   1. A lesson actually in session always wins. Grace never steals a tap from
//      a class that is genuinely running.
//   2. Otherwise the nearest edge wins — just-ended beats about-to-start, which
//      is what you want for a student leaving the room they were in.
//
// Kept here, and pure, so the rule can be tested against a real timetable.
// ---------------------------------------------------------------------------

export const GRACE_BEFORE_MIN = 15; // tap this many minutes before the start
export const GRACE_AFTER_MIN = 15;  // ...and this many after the end

export interface SchedulableLesson {
  start_time: string;
  end_time: string;
}

/** Minutes from `now` to the lesson's scheduled window; 0 while in session. */
export function minutesFromWindow(
  lesson: SchedulableLesson,
  nowMinutes: number,
): number {
  const start = timeToMinutes(lesson.start_time);
  const end = timeToMinutes(lesson.end_time);
  if (nowMinutes < start) return start - nowMinutes;
  if (nowMinutes > end) return nowMinutes - end;
  return 0;
}

export function isInSession(
  lesson: SchedulableLesson,
  nowMinutes: number,
): boolean {
  return minutesFromWindow(lesson, nowMinutes) === 0;
}

/**
 * The lesson a tap at `nowMinutes` counts toward, or null if none is close
 * enough. `lessons` should already be filtered to the right teacher and day.
 */
export function selectLesson<T extends SchedulableLesson>(
  lessons: T[],
  nowMinutes: number,
  graceBefore = GRACE_BEFORE_MIN,
  graceAfter = GRACE_AFTER_MIN,
): T | null {
  const candidates = lessons.filter((l) => {
    const start = timeToMinutes(l.start_time) - graceBefore;
    const end = timeToMinutes(l.end_time) + graceAfter;
    return nowMinutes >= start && nowMinutes <= end;
  });
  if (candidates.length === 0) return null;

  return candidates.slice().sort((a, b) => {
    const aIn = isInSession(a, nowMinutes) ? 0 : 1;
    const bIn = isInSession(b, nowMinutes) ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    return minutesFromWindow(a, nowMinutes) - minutesFromWindow(b, nowMinutes);
  })[0];
}
