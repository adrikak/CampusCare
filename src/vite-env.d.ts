/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** https://<project-ref>.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Publishable (sb_publishable_…) or anon key ONLY. Never the secret/service_role key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
