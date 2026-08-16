import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // Surfaced early so a misconfigured deploy fails loudly, not silently.
  console.error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Check your .env / Vercel env vars.",
  );
}

export const supabase = createClient(url, anon);

export const CHECKIN_FN_URL = import.meta.env.VITE_CHECKIN_FN_URL as string;
export const EXPORT_FN_URL = import.meta.env.VITE_EXPORT_FN_URL as string;
