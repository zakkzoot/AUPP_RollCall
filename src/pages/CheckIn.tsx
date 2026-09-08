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
  | "error"
  | "emergency"
  | "emergency_sent";

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
  not_on_register: {
    title: "Not on the register",
    body: "That student ID isn't on the register for this lesson. Check you typed it correctly, or speak to your teacher.",
  },
  location_required: {
    title: "Location needed",
    body: "Turn on location for this page, then tap the tag again.",
  },
  unknown_tag: {
    title: "Tag not recognised",
    body: "This tag isn't set up yet. Let your teacher know.",
  },
  could_not_record: {
    title: "Couldn't save your check-in",
    body: "You're in the right place at the right time, but the attendance record didn't save. Show your teacher this screen — re-tapping won't help.",
  },
  could_not_register: {
    title: "Couldn't set up this device",
    body: "Your ID looks fine, but the device couldn't be registered. Show your teacher this screen — re-tapping won't help.",
  },
  registration_required: {
    title: "Student ID didn't reach the server",
    body: "Your ID was sent but the server says it didn't arrive. Show your teacher this screen — re-tapping won't help.",
  },
  generic: {
    title: "Something went wrong",
    body: "Couldn't check you in. Try tapping the tag once more.",
  },
};

// One line naming the actual cause. `data` is null when the body wasn't JSON at
// all, which is itself the answer — a gateway rejection rather than our function.
function describeFailure(status: number, data: any, raw: string): string {
  // An HTML error page carries one useful sentence buried in markup; keep the
  // words and drop the tags rather than printing a page of angle brackets.
  const fallback = /^\s*</.test(raw)
    ? raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    : raw.trim();
  const message = data?.error ?? data?.message ?? data?.msg ?? fallback;
  const short = message.length > 160 ? `${message.slice(0, 160)}…` : message;
  return short ? `${status} · ${short}` : `${status} · no response body`;
}

// Phones take enormous photographs and this one only has to be recognisable.
// Downscaling in the browser keeps the request small enough to survive a bad
// classroom connection, and keeps the stored image proportionate to its purpose.
async function shrinkToDataUrl(file: File, maxEdge = 800): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read the photo on this device.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.7);
}

export default function CheckIn() {
  const { tagCode } = useParams();
  const [phase, setPhase] = useState<Phase>("locating");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [errorKey, setErrorKey] = useState("generic");
  // The real status and server message, shown small under the friendly copy so a
  // failure can be diagnosed from the phone in the room rather than guessed at.
  const [detail, setDetail] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessData | null>(null);
  const [flagged, setFlagged] = useState(false);

  // Form fields
  const [fullName, setFullName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Students normally type only their ID and the register supplies the name.
  // The name field appears only when the server says there is no register.
  const [needName, setNeedName] = useState(false);

  // Emergency route: a selfie plus name and ID, held for the teacher.
  const [selfie, setSelfie] = useState<string | null>(null);
  const [selfieBusy, setSelfieBusy] = useState(false);
  const [emergencyError, setEmergencyError] = useState<string | null>(null);

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
          full_name: deviceToken || !needName ? null : fullName.trim(),
          lat: coords.lat,
          lng: coords.lng,
        }),
      });
      // Read as text first. A rejection from the Supabase gateway — the function
      // not deployed, or JWT verification left on — can answer with HTML, and
      // res.json() would throw and lose the one thing worth knowing.
      const raw = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(raw);
      } catch {
        // Leave data null; `raw` still carries the evidence.
      }

      if (!res.ok || !data?.ok) {
        // Two answers send us back to the form rather than to an error. Both
        // set the detail line first: a silent return to the form is how a real
        // failure ends up looking like a dead button.

        // No register for this lesson, so we do need a name after all.
        if (data?.error === "name_required") {
          setNeedName(true);
          setDetail(describeFailure(res.status, data, raw));
          setPhase("form");
          return;
        }

        // A stored token that matches no student — the row it pointed at is
        // gone. Drop it and let them register again, rather than stranding the
        // phone on an error it can never tap its way out of.
        //
        // Only when we actually sent a token, though. The same answer to a
        // request carrying a typed student_id is a genuine failure, and bouncing
        // that back to the form loops forever with nothing on screen.
        if (data?.error === "registration_required" && deviceToken) {
          localStorage.removeItem(DEVICE_TOKEN_KEY);
          setDetail(describeFailure(res.status, data, raw));
          setPhase("form");
          return;
        }
        setErrorKey(ERROR_COPY[data?.error] ? data.error : "generic");
        setDetail(describeFailure(res.status, data, raw));
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
    } catch (e: any) {
      // Never reached the server: DNS, CORS, offline, blocked request.
      setErrorKey("generic");
      setDetail(`No reply from the server · ${e?.message ?? "network error"}`);
      setPhase("error");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitEmergency() {
    if (!coords || !selfie) return;
    setSubmitting(true);
    setEmergencyError(null);
    try {
      const res = await fetch(CHECKIN_FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "emergency",
          tag_code: tagCode,
          student_id: studentId.trim(),
          full_name: fullName.trim(),
          selfie,
          lat: coords.lat,
          lng: coords.lng,
        }),
      });
      const raw = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(raw);
      } catch {
        // Leave null; `raw` is the evidence.
      }
      if (!res.ok || !data?.ok) {
        setEmergencyError(describeFailure(res.status, data, raw));
        return;
      }
      setPhase("emergency_sent");
    } catch (e: any) {
      setEmergencyError(`No reply from the server · ${e?.message ?? "network error"}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function pickSelfie(file: File) {
    setSelfieBusy(true);
    setEmergencyError(null);
    try {
      setSelfie(await shrinkToDataUrl(file));
    } catch (e: any) {
      setEmergencyError(e?.message ?? "Could not read that photo.");
    } finally {
      setSelfieBusy(false);
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
            needName={needName}
            submitting={submitting}
            detail={detail}
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
            detail={detail}
            onEmergency={() => {
              setEmergencyError(null);
              setPhase("emergency");
            }}
          />
        )}
        {phase === "emergency" && (
          <EmergencyForm
            fullName={fullName}
            studentId={studentId}
            setFullName={setFullName}
            setStudentId={setStudentId}
            selfie={selfie}
            selfieBusy={selfieBusy}
            onPickSelfie={pickSelfie}
            onClearSelfie={() => setSelfie(null)}
            submitting={submitting}
            error={emergencyError}
            onSubmit={submitEmergency}
            onBack={() => setPhase("error")}
          />
        )}
        {phase === "emergency_sent" && <EmergencySent name={fullName} />}
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
  needName,
  submitting,
  detail,
  onSubmit,
}: {
  fullName: string;
  studentId: string;
  setFullName: (v: string) => void;
  setStudentId: (v: string) => void;
  detail?: string | null;
  needName: boolean;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const canSubmit =
    studentId.trim().length > 0 && (!needName || fullName.trim().length > 1);
  return (
    <div className="w-full">
      <p className="text-red font-display font-semibold tracking-wide uppercase text-sm">
        First time here
      </p>
      <h1 className="font-display text-3xl font-bold mt-2 leading-tight">
        Set up this device
      </h1>
      <p className="text-mist/60 mt-3 leading-relaxed">
        {needName
          ? "Your teacher hasn't imported a register for this lesson, so add your name this once."
          : "Enter your student ID once. After this, a single tap checks you in — this device becomes yours."}
      </p>

      <div className="mt-8 space-y-4 text-left">
        <div>
          <label className="block text-sm text-mist/70 mb-1.5">
            Student ID
          </label>
          <input
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            autoFocus
            className="w-full bg-dusk border border-white/10 rounded-xl px-4 py-4 text-lg text-mist placeholder-mist/30 focus:outline-none focus:border-red focus:ring-1 focus:ring-red"
            placeholder="S12345"
          />
        </div>
        {needName && (
          <div>
            <label className="block text-sm text-mist/70 mb-1.5">
              Full name
            </label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              className="w-full bg-dusk border border-white/10 rounded-xl px-4 py-4 text-lg text-mist placeholder-mist/30 focus:outline-none focus:border-red focus:ring-1 focus:ring-red"
              placeholder="Jane Doe"
            />
          </div>
        )}
      </div>

      <button
        onClick={onSubmit}
        disabled={!canSubmit || submitting}
        className="mt-8 w-full bg-red text-white font-display font-bold text-lg rounded-xl py-4 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
      >
        {submitting ? "Checking in…" : "Check in"}
      </button>

      {detail && (
        <p className="mt-5 text-mist/35 text-xs font-mono break-words leading-relaxed text-center">
          {detail}
        </p>
      )}
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

function ErrorState({
  title,
  body,
  detail,
  onEmergency,
}: {
  title: string;
  body: string;
  detail?: string | null;
  onEmergency?: () => void;
}) {
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
      {detail && (
        <p className="mt-6 text-mist/35 text-xs font-mono break-words leading-relaxed">
          {detail}
        </p>
      )}

      {onEmergency && (
        <button
          onClick={onEmergency}
          className="mt-8 w-full border border-white/20 text-mist font-display font-semibold rounded-xl py-3.5 active:scale-[0.98] transition-transform"
        >
          Can't check in? Ask your teacher
        </button>
      )}
    </div>
  );
}

function EmergencyForm({
  fullName,
  studentId,
  setFullName,
  setStudentId,
  selfie,
  selfieBusy,
  onPickSelfie,
  onClearSelfie,
  submitting,
  error,
  onSubmit,
  onBack,
}: {
  fullName: string;
  studentId: string;
  setFullName: (v: string) => void;
  setStudentId: (v: string) => void;
  selfie: string | null;
  selfieBusy: boolean;
  onPickSelfie: (f: File) => void;
  onClearSelfie: () => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const canSubmit =
    !!selfie && studentId.trim().length > 0 && fullName.trim().length > 1;
  return (
    <div className="w-full text-left">
      <p className="text-red font-display font-semibold tracking-wide uppercase text-sm">
        Can't check in
      </p>
      <h1 className="font-display text-3xl font-bold mt-2 leading-tight">
        Ask your teacher
      </h1>
      <p className="text-mist/60 mt-3 leading-relaxed">
        Send your teacher a photo with your name and ID. They'll review it and
        mark you present. <strong className="text-mist/80">This is not a
        check-in yet</strong> — don't leave until your teacher has seen it.
      </p>

      <div className="mt-8 space-y-4">
        <div>
          <label className="block text-sm text-mist/70 mb-1.5">Photo of you</label>
          {selfie ? (
            <div className="relative">
              <img
                src={selfie}
                alt="Your photo"
                className="w-full rounded-xl border border-white/10"
              />
              <button
                onClick={onClearSelfie}
                className="mt-2 text-sm text-mist/60 underline"
              >
                Take it again
              </button>
            </div>
          ) : (
            <label className="block border border-dashed border-white/20 rounded-xl px-4 py-8 text-center text-mist/60 cursor-pointer">
              {selfieBusy ? "Preparing…" : "Tap to take a photo"}
              <input
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={(e) =>
                  e.target.files?.[0] && onPickSelfie(e.target.files[0])
                }
              />
            </label>
          )}
        </div>

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
          <label className="block text-sm text-mist/70 mb-1.5">Student ID</label>
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
        {submitting ? "Sending…" : "Send to my teacher"}
      </button>
      <button onClick={onBack} className="mt-3 w-full text-mist/50 py-2">
        Back
      </button>

      {error && (
        <p className="mt-5 text-mist/35 text-xs font-mono break-words leading-relaxed text-center">
          {error}
        </p>
      )}
    </div>
  );
}

function EmergencySent({ name }: { name: string }) {
  return (
    <div className="text-center w-full">
      <div className="mx-auto w-24 h-24 rounded-full bg-amber-400/10 flex items-center justify-center">
        <svg
          viewBox="0 0 24 24"
          className="w-12 h-12 text-amber-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 8v4l3 2" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </div>
      <h1 className="font-display text-3xl font-bold mt-7">Sent for review</h1>
      <p className="text-mist/60 mt-3 leading-relaxed">
        Your teacher has your photo{name.trim() ? `, ${name.trim()}` : ""}. They
        need to approve it before it counts.
      </p>
      <p className="text-mist/80 mt-5 leading-relaxed font-medium">
        You are not marked present yet. Tell your teacher before you leave.
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="mx-auto w-14 h-14 rounded-full border-4 border-dusk border-t-red animate-spin" />
  );
}
