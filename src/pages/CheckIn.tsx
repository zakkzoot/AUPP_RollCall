import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CHECKIN_FN_URL } from "../lib/supabase";
import { DEVICE_TOKEN_KEY } from "../lib/types";

type Phase =
  | "locating"
  | "location_denied"
  | "checking"
  | "form"
  | "success"
  | "error";

interface SuccessData {
  full_name: string;
  subject: string;
  checked_in_at: string;
}

const ERROR_COPY: Record<string, { title: string; body: string }> = {
  out_of_range: {
    title: "Too far away",
    body: "You need to be at the classroom to check in. Get closer and tap again.",
  },
  no_active_lesson: {
    title: "No lesson right now",
    body: "There's no scheduled lesson for this tag at the moment. Check the time on your timetable.",
  },
  id_already_bound: {
    title: "ID already in use",
    body: "That student ID is registered on another device. Speak to your teacher — this can't be shared.",
  },
  location_required: {
    title: "Location needed",
    body: "Turn on location for this page, then tap the tag again.",
  },
  unknown_tag: {
    title: "Tag not recognised",
    body: "This tag isn't set up yet. Let your teacher know.",
  },
  generic: {
    title: "Something went wrong",
    body: "Couldn't check you in. Try tapping the tag once more.",
  },
};

export default function CheckIn() {
  const { tagCode } = useParams();
  const [phase, setPhase] = useState<Phase>("locating");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [errorKey, setErrorKey] = useState("generic");
  const [success, setSuccess] = useState<SuccessData | null>(null);
  const [flagged, setFlagged] = useState(false);

  // Form fields
  const [fullName, setFullName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Step 1: get location on mount.
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setPhase("location_denied");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => setPhase("location_denied"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }, []);

  // Step 2: once we have coords, either auto-check-in or show the form.
  useEffect(() => {
    if (!coords) return;
    const token = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (token) {
      void submit(token);
    } else {
      setPhase("form");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords]);

  async function submit(deviceToken: string | null) {
    if (!coords) return;
    if (deviceToken) setPhase("checking");
    setSubmitting(true);
    try {
      const res = await fetch(CHECKIN_FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag_code: tagCode,
          device_token: deviceToken,
          student_id: deviceToken ? null : studentId.trim(),
          full_name: deviceToken ? null : fullName.trim(),
          lat: coords.lat,
          lng: coords.lng,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setErrorKey(ERROR_COPY[data.error] ? data.error : "generic");
        setPhase("error");
        return;
      }

      if (data.device_token) {
        localStorage.setItem(DEVICE_TOKEN_KEY, data.device_token);
      }
      setFlagged(data.status === "flagged");
      setSuccess({
        full_name: data.full_name,
        subject: data.subject,
        checked_in_at: data.checked_in_at,
      });
      setPhase("success");
    } catch {
      setErrorKey("generic");
      setPhase("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-ink text-mist font-body flex flex-col items-center">
      {/* Full-width AUPP logo header — spans the device viewport, keeps aspect ratio */}
      <img
        src="/aupp-logo.png"
        alt="American University of Phnom Penh"
        className="w-full h-auto bg-white"
      />
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10 max-w-md mx-auto w-full">
        {phase === "locating" && <Locating />}
        {phase === "location_denied" && (
          <ErrorState
            title={ERROR_COPY.location_required.title}
            body={ERROR_COPY.location_required.body}
          />
        )}
        {phase === "checking" && <Checking />}
        {phase === "form" && (
          <RegisterForm
            fullName={fullName}
            studentId={studentId}
            setFullName={setFullName}
            setStudentId={setStudentId}
            submitting={submitting}
            onSubmit={() => submit(null)}
          />
        )}
        {phase === "success" && success && (
          <SuccessState data={success} flagged={flagged} />
        )}
        {phase === "error" && (
          <ErrorState
            title={ERROR_COPY[errorKey].title}
            body={ERROR_COPY[errorKey].body}
          />
        )}
      </div>
    </div>
  );
}

function Locating() {
  return (
    <div className="text-center">
      <Spinner />
      <p className="mt-6 text-mist/70 text-lg">Finding you…</p>
    </div>
  );
}

function Checking() {
  return (
    <div className="text-center">
      <Spinner />
      <p className="mt-6 text-mist/70 text-lg">Checking you in…</p>
    </div>
  );
}

function RegisterForm({
  fullName,
  studentId,
  setFullName,
  setStudentId,
  submitting,
  onSubmit,
}: {
  fullName: string;
  studentId: string;
  setFullName: (v: string) => void;
  setStudentId: (v: string) => void;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const canSubmit = fullName.trim().length > 1 && studentId.trim().length > 0;
  return (
    <div className="w-full">
      <p className="text-red font-display font-semibold tracking-wide uppercase text-sm">
        First time here
      </p>
      <h1 className="font-display text-3xl font-bold mt-2 leading-tight">
        Set up this device
      </h1>
      <p className="text-mist/60 mt-3 leading-relaxed">
        Enter your details once. After this, a single tap checks you in — this
        device becomes yours.
      </p>

      <div className="mt-8 space-y-4 text-left">
        <div>
          <label className="block text-sm text-mist/70 mb-1.5">Full name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            className="w-full bg-dusk border border-white/10 rounded-xl px-4 py-4 text-lg text-mist placeholder-mist/30 focus:outline-none focus:border-red focus:ring-1 focus:ring-red"
            placeholder="Jane Doe"
          />
        </div>
        <div>
          <label className="block text-sm text-mist/70 mb-1.5">
            Student ID
          </label>
          <input
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="w-full bg-dusk border border-white/10 rounded-xl px-4 py-4 text-lg text-mist placeholder-mist/30 focus:outline-none focus:border-red focus:ring-1 focus:ring-red"
            placeholder="S12345"
          />
        </div>
      </div>

      <button
        onClick={onSubmit}
        disabled={!canSubmit || submitting}
        className="mt-8 w-full bg-red text-white font-display font-bold text-lg rounded-xl py-4 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
      >
        {submitting ? "Checking in…" : "Check in"}
      </button>
    </div>
  );
}

function SuccessState({
  data,
  flagged,
}: {
  data: SuccessData;
  flagged: boolean;
}) {
  const time = new Date(data.checked_in_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="text-center w-full">
      <div className="relative mx-auto w-28 h-28 rounded-full bg-signal/10 flex items-center justify-center ring-pulse">
        <svg
          viewBox="0 0 24 24"
          className="w-14 h-14 text-signal"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <h1 className="font-display text-4xl font-bold mt-8">Checked in</h1>
      <p className="text-mist/80 text-xl mt-2">{data.full_name}</p>
      <div className="mt-8 bg-dusk rounded-2xl p-5 text-left">
        <Row label="Lesson" value={data.subject} />
        <div className="h-px bg-white/10 my-3" />
        <Row label="Time" value={time} />
      </div>
      {flagged && (
        <p className="mt-5 text-halt text-sm leading-relaxed">
          Recorded, but this device is linked to a different ID. Your teacher has
          been notified.
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-mist/50 text-sm uppercase tracking-wide">
        {label}
      </span>
      <span className="text-mist font-display font-semibold text-lg">
        {value}
      </span>
    </div>
  );
}

function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center w-full">
      <div className="mx-auto w-24 h-24 rounded-full bg-halt/10 flex items-center justify-center">
        <svg
          viewBox="0 0 24 24"
          className="w-12 h-12 text-halt"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
      </div>
      <h1 className="font-display text-3xl font-bold mt-7">{title}</h1>
      <p className="text-mist/60 mt-3 leading-relaxed">{body}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="mx-auto w-14 h-14 rounded-full border-4 border-dusk border-t-red animate-spin" />
  );
}
