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
