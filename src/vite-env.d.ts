/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_CHECKIN_FN_URL: string;
  readonly VITE_EXPORT_FN_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
