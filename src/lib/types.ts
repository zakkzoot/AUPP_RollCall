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
  class_id: string | null;
  locations?: { name: string } | null;
  classes?: { name: string } | null;
}

/** A named group of students. Several lessons can share one class register. */
export interface Class {
  id: string;
  teacher_id: string;
  name: string;
}

/** One row of a class register: the school's ID and the official name. */
export interface ClassStudent {
  id: string;
  class_id: string;
  student_id: string;
  full_name: string;
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

/** A refused check-in, recorded against the lesson it was refused for. */
export interface CheckinEvent {
  id: string;
  created_at: string;
  error_code: string;
  http_status: number;
  tag_code: string | null;
  attempted_student_id: string | null;
  had_device_token: boolean;
  distance_m: number | null;
  user_agent: string | null;
  lessons: { subject: string } | null;
}

/** A selfie-backed request for attendance, waiting on the teacher. */
export interface EmergencyCheckin {
  id: string;
  created_at: string;
  student_id: string;
  full_name: string;
  selfie_path: string | null;
  distance_m: number | null;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  lessons: { subject: string } | null;
}

/** Plain-English labels for the codes the check-in function returns. */
export const ERROR_LABELS: Record<string, string> = {
  missing_tag_code: "Tag URL had no code",
  unknown_tag: "Tag not recognised",
  location_required: "No location from the phone",
  no_active_lesson: "No lesson at that time",
  out_of_range: "Outside the classroom",
  not_on_register: "ID not on the register",
  name_required: "Asked for a name",
  registration_required: "Phone sent no ID",
  id_already_bound: "ID bound to another device",
  could_not_register: "Could not create the student",
  could_not_record: "Could not save the check-in",
  emergency_details_required: "Emergency: name or ID missing",
  selfie_required: "Emergency: no photo",
  selfie_too_large: "Emergency: photo too large",
  selfie_unreadable: "Emergency: photo unreadable",
  selfie_upload_failed: "Emergency: photo upload failed",
  emergency_failed: "Emergency: could not save",
};
