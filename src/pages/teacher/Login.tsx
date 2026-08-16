import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

// A small, common set. Teachers can also type any IANA zone.
const COMMON_TZ = [
  "Asia/Phnom_Penh",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

export default function Login() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Safety net for accounts created before the profile trigger existed. New
  // sign-ups get their teachers row from the on_auth_user_created trigger, which
  // works whether or not email confirmation is on.
  async function ensureTeacherRow(userId: string) {
    const { data } = await supabase
      .from("teachers")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (!data) {
      await supabase.from("teachers").insert({
        id: userId,
        full_name: fullName.trim() || email.split("@")[0],
        timezone,
      });
    }
  }

  async function handle() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "up") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // Read by the profile trigger so the teacher's own name and timezone
          // survive, instead of falling back to the email prefix.
          options: {
            data: {
              full_name: fullName.trim(),
              timezone,
            },
          },
        });
        if (error) throw error;

        // No session means email confirmation is on. Say so — this used to
        // bounce silently back to the login screen with no explanation.
        if (!data.session) {
          setNotice(
            "Account created. Check your email for a confirmation link, then sign in below.",
          );
          setMode("in");
          setPassword("");
          return;
        }
        if (data.user) await ensureTeacherRow(data.user.id);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (data.user) await ensureTeacherRow(data.user.id);
      }
      nav("/dashboard");
    } catch (e: any) {
      setError(e.message ?? "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 font-body">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <img
            src="/aupp-logo-cropped.png"
            alt="American University of Phnom Penh"
            className="w-24 h-24"
          />
          <p className="mt-2 text-xs uppercase tracking-wide text-navy/60 font-display font-semibold">
            American University of Phnom Penh
          </p>
        </div>
        <h1 className="font-display text-2xl font-bold text-navy">
          {mode === "in" ? "Teacher sign in" : "Create your account"}
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          {mode === "in"
            ? "Manage your timetable and attendance."
            : "Set up your teaching profile."}
        </p>

        <div className="mt-6 space-y-3">
          {mode === "up" && (
            <>
              <Field
                label="Full name"
                value={fullName}
                onChange={setFullName}
                placeholder="Mr Smith"
              />
              <div>
                <label className="block text-sm text-slate-600 mb-1">
                  Timezone
                </label>
                <input
                  list="tzlist"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5"
                />
                <datalist id="tzlist">
                  {COMMON_TZ.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
                <p className="text-xs text-slate-400 mt-1">
                  Your timetable times are read in this zone.
                </p>
              </div>
            </>
          )}
          <Field
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            placeholder="you@school.edu"
          />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            placeholder="••••••••"
          />
        </div>

        {notice && (
          <p className="text-signal text-sm mt-4 leading-relaxed">{notice}</p>
        )}
        {error && <p className="text-halt text-sm mt-4">{error}</p>}

        <button
          onClick={handle}
          disabled={busy || !email || !password}
          className="mt-6 w-full bg-navy text-white font-medium rounded-lg py-2.5 disabled:opacity-40"
        >
          {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
        </button>

        <button
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="mt-4 w-full text-sm text-slate-500 hover:text-slate-800"
        >
          {mode === "in"
            ? "Need an account? Create one"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm text-slate-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-slate-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-navy focus:border-navy"
      />
    </div>
  );
}
