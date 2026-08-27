import Papa from "papaparse";
import { Lesson, Location } from "./types";

/**
 * Parsing for the two timetable CSV shapes. Kept apart from the import UI so
 * the rules can be exercised directly against real files from the university.
 *
 * Native:
 *   subject,day_of_week,start_time,end_time,location_name,override_lat,...
 *
 * University export (Fall_2026_Teaching_Schedule.csv and friends):
 *   Semester,Course,Course Title,Section,Days,Start Time,End Time,Room,Start Date
 *
 * The university shape needs more than renaming columns: one row covers several
 * days ("Tuesday; Thursday") and becomes one lesson per day, the subject is
 * assembled from three columns, and Room names a classroom that probably isn't
 * a saved location yet.
 */

export type Raw = Record<string, string>;

export interface Draft {
  subject: string;
  dow: number;
  start: string;
  end: string;
  /** Room from the CSV, still to be matched against saved locations. */
  roomName: string | null;
  locationId: string | null;
  override: { lat: number; lng: number; radius: number } | null;
  /** Course + section, used to create a class so the register can attach. */
  className: string | null;
}

export type Status = "ok" | "error" | "duplicate" | "needs_room";

export interface ParsedRow {
  status: Status;
  message?: string;
  draft?: Draft;
  sourceRow: number;
  label: string;
  detail: string;
}

const DOW_MAP: Record<string, number> = {
  sun: 0, sunday: 0, su: 0, "0": 0,
  mon: 1, monday: 1, m: 1, "1": 1,
  tue: 2, tues: 2, tuesday: 2, tu: 2, "2": 2,
  wed: 3, weds: 3, wednesday: 3, w: 3, "3": 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, th: 4, "4": 4,
  fri: 5, friday: 5, f: 5, "5": 5,
  sat: 6, saturday: 6, sa: 6, "6": 6,
};

export function normDow(v: string): number | null {
  const k = v.trim().toLowerCase().replace(/\.$/, "");
  return k in DOW_MAP ? DOW_MAP[k] : null;
}

export function normTime(v: string): string | null {
  const s = v.trim().toLowerCase().replace(/\s/g, "");
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2] ? parseInt(ampm[2], 10) : 0;
    if (ampm[3] === "pm" && h !== 12) h += 12;
    if (ampm[3] === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  }
  const hhmm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const h = parseInt(hhmm[1], 10);
    const m = parseInt(hhmm[2], 10);
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  }
  return null;
}

function toMin(t: string) {
  const [h, m] = t.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

/** "Tuesday; Thursday", "Mon/Wed", "TueThu" → [2, 4]. */
export function splitDays(v: string): { days: number[]; bad: string[] } {
  const raw = v.trim();
  if (!raw) return { days: [], bad: [] };
  let parts = raw.split(/[;,/&+|]| and /i).map((s) => s.trim()).filter(Boolean);
  // A single unseparated token like "TueThu" or "MWF".
  if (parts.length === 1 && normDow(parts[0]) === null) {
    const compact = parts[0].replace(/\s+/g, "");
    const chunks = compact.match(/(sun|mon|tues?|wed(s)?|thur?s?|fri|sat)/gi);
    if (chunks && chunks.join("").length === compact.length) {
      parts = chunks;
    } else if (/^[MTWRFSU]+$/.test(compact)) {
      // MWF / TR style single letters (R = Thursday, U = Sunday).
      const letter: Record<string, number> = {
        U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6,
      };
      const days = compact.split("").map((c) => letter[c]);
      return { days: [...new Set(days)], bad: [] };
    }
  }
  const days: number[] = [];
  const bad: string[] = [];
  for (const p of parts) {
    const d = normDow(p);
    if (d === null) bad.push(p);
    else if (!days.includes(d)) days.push(d);
  }
  return { days, bad };
}

/** Rooms match loosely: "Classroom D5" ≡ "Room D5" ≡ "D5". */
export function normRoom(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^(class\s?room|room|rm)\s+/, "");
}


export interface ParseContext {
  locations: Location[];
  existing: Lesson[];
}

export interface ParseResult {
  format: "native" | "university";
  rows: ParsedRow[];
}

const DOW_SHORT_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function locIdByRoom(name: string, locations: Location[]): string | null {
  const n = normRoom(name);
  return locations.find((l) => normRoom(l.name) === n)?.id ?? null;
}

function isDuplicate(d: Draft, existing: Lesson[]): boolean {
  return existing.some(
    (e) =>
      e.subject.toLowerCase() === d.subject.toLowerCase() &&
      e.day_of_week === d.dow &&
      e.start_time === d.start &&
      e.end_time === d.end,
  );
}

function finish(d: Draft, sourceRow: number, ctx: ParseContext): ParsedRow {
  const detail = `${DOW_SHORT_LABEL[d.dow]} ${d.start.slice(0, 5)}–${d.end.slice(0, 5)}${
    d.roomName ? ` · ${d.roomName}` : ""
  }`;
  const base = { draft: d, sourceRow, label: d.subject, detail };
  if (isDuplicate(d, ctx.existing)) {
    return { ...base, status: "duplicate", message: "already in timetable — skipped" };
  }
  if (d.roomName && !d.locationId) {
    return { ...base, status: "needs_room", message: `no location called "${d.roomName}"` };
  }
  return { ...base, status: "ok" };
}

function err(message: string, sourceRow: number, label: string): ParsedRow {
  return { status: "error", message, sourceRow, label, detail: "" };
}

/** University export: one row can cover several days, so it fans out. */
function parseUniversity(raw: Raw, sourceRow: number, ctx: ParseContext): ParsedRow[] {
  const course = (raw.course ?? "").trim();
  const title = (raw.course_title ?? raw.title ?? "").trim();
  const section = (raw.section ?? "").trim();
  const label = [course, title].filter(Boolean).join(" ") || `row ${sourceRow}`;

  if (!course && !title) return [err("missing Course and Course Title", sourceRow, label)];

  const subject =
    [course, title].filter(Boolean).join(" ") + (section ? ` (Sec ${section})` : "");
  const className = section ? `${course || title} Sec ${section}` : course || title;

  const start = normTime(raw.start_time ?? "");
  const end = normTime(raw.end_time ?? "");
  if (!start) return [err(`bad Start Time "${raw.start_time ?? ""}"`, sourceRow, label)];
  if (!end) return [err(`bad End Time "${raw.end_time ?? ""}"`, sourceRow, label)];
  if (toMin(end) <= toMin(start))
    return [err("End Time must be after Start Time", sourceRow, label)];

  const { days, bad } = splitDays(raw.days ?? "");
  if (bad.length) return [err(`unrecognised day "${bad[0]}"`, sourceRow, label)];
  if (days.length === 0) return [err("no Days given", sourceRow, label)];

  const room = (raw.room ?? "").trim();

  return days.map((dow) =>
    finish(
      {
        subject,
        dow,
        start,
        end,
        roomName: room || null,
        locationId: room ? locIdByRoom(room, ctx.locations) : null,
        override: null,
        className,
      },
      sourceRow,
      ctx,
    ),
  );
}

/** The template format this app has always accepted. */
function parseNative(raw: Raw, sourceRow: number, ctx: ParseContext): ParsedRow[] {
  const subject = (raw.subject ?? "").trim();
  const label = subject || `row ${sourceRow}`;
  if (!subject) return [err("missing subject", sourceRow, label)];

  const dow = normDow(raw.day_of_week ?? "");
  if (dow === null)
    return [err(`bad day_of_week "${raw.day_of_week ?? ""}"`, sourceRow, label)];

  const start = normTime(raw.start_time ?? "");
  const end = normTime(raw.end_time ?? "");
  if (!start) return [err(`bad start_time "${raw.start_time ?? ""}"`, sourceRow, label)];
  if (!end) return [err(`bad end_time "${raw.end_time ?? ""}"`, sourceRow, label)];
  if (toMin(end) <= toMin(start))
    return [err("end_time must be after start_time", sourceRow, label)];

  const locName = (raw.location_name ?? "").trim();
  const hasOverride =
    (raw.override_lat ?? "").trim() !== "" ||
    (raw.override_lng ?? "").trim() !== "" ||
    (raw.override_radius_m ?? "").trim() !== "";

  if (locName && hasOverride)
    return [err("set either a location name OR an override, not both", sourceRow, label)];

  if (hasOverride) {
    const lat = Number(raw.override_lat);
    const lng = Number(raw.override_lng);
    const rad = Number(raw.override_radius_m);
    if (isNaN(lat) || isNaN(lng) || isNaN(rad))
      return [
        err(
          "override_lat, override_lng and override_radius_m must all be numbers",
          sourceRow,
          label,
        ),
      ];
    return [
      finish(
        {
          subject, dow, start, end,
          roomName: null, locationId: null,
          override: { lat, lng, radius: rad },
          className: null,
        },
        sourceRow,
        ctx,
      ),
    ];
  }

  if (!locName)
    return [err("no location — give a location_name or an override", sourceRow, label)];

  return [
    finish(
      {
        subject, dow, start, end,
        roomName: locName,
        locationId: locIdByRoom(locName, ctx.locations),
        override: null,
        className: null,
      },
      sourceRow,
      ctx,
    ),
  ];
}

/** Parse either shape, choosing by the header row. */
export function parseScheduleCsv(text: string, ctx: ParseContext): ParseResult {
  const result = Papa.parse<Raw>(text, {
    header: true,
    skipEmptyLines: true,
    // "Start Time" and "start_time" both land on start_time.
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  const headers = result.meta.fields ?? [];
  const isUniversity = headers.includes("course") && headers.includes("days");
  const rows = (result.data ?? []).flatMap((raw, i) =>
    isUniversity ? parseUniversity(raw, i + 1, ctx) : parseNative(raw, i + 1, ctx),
  );
  return { format: isUniversity ? "university" : "native", rows };
}
