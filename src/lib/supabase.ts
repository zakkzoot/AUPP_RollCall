import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const CHECKIN_FN_URL = import.meta.env.VITE_CHECKIN_FN_URL as string;
export const EXPORT_FN_URL = import.meta.env.VITE_EXPORT_FN_URL as string;

// Every env var the app needs. App.tsx renders a setup screen listing whatever
// is missing, so a misconfigured deploy explains itself instead of failing blank.
export const MISSING_ENV: string[] = (
  [
    [url, "VITE_SUPABASE_URL"],
    [anon, "VITE_SUPABASE_ANON_KEY"],
    [CHECKIN_FN_URL, "VITE_CHECKIN_FN_URL"],
    [EXPORT_FN_URL, "VITE_EXPORT_FN_URL"],
  ] as const
)
  .filter(([value]) => !value)
  .map(([, name]) => name);

if (MISSING_ENV.length) {
  console.error(
    `Missing env vars: ${MISSING_ENV.join(", ")}. Check your .env.local / Vercel env vars.`,
  );
}

// createClient throws on an empty URL or key, which would take the whole bundle
// down at import time. Fall back to placeholders — nothing is ever sent to them
// because the setup screen renders instead of the app.
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  anon || "placeholder-anon-key",
);
