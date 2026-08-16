export const DEVICE_TOKEN_KEY = "nfc_attend_device_token";

export const DOW_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface Location {
  id: string;
  teacher_id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
}

export interface Lesson {
  id: string;
  teacher_id: string;
  subject: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  location_id: string | null;
  override_lat: number | null;
  override_lng: number | null;
  override_radius_m: number | null;
  active: boolean;
  locations?: { name: string } | null;
}

export interface Checkin {
  id: string;
  checked_in_at: string;
  status: "ok" | "flagged";
  flag_reason: string | null;
  distance_m: number | null;
  students: { full_name: string; student_id: string } | null;
  lessons: { subject: string } | null;
}
