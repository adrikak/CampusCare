/**
 * Supabase connection for the browser.
 *
 * Only the PUBLISHABLE / ANON key may be used here. It is safe in a web app
 * because the database's row-level security decides what each signed-in user
 * can read, and only two checked functions can change data.
 * The secret / service_role key bypasses all of that and must NEVER be here.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

function jwtRole(token: string): string | null {
  if (!token.startsWith("eyJ")) return null;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return (JSON.parse(atob(part)) as { role?: string }).role ?? "unknown";
  } catch {
    return "unknown";
  }
}

function checkConfig(): string | null {
  if (!url || !key) {
    return "VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. Create .env.local (copy .env.example), fill in both values, then restart `npm run dev`.";
  }
  if (/your-project-ref|replace_me|PASTE_YOUR/i.test(url + " " + key)) {
    return ".env.local still contains the example values. Put in your real Project URL and publishable key, save, then restart `npm run dev`.";
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
    return "VITE_SUPABASE_URL should look like https://<project-ref>.supabase.co";
  }
  if (key.startsWith("sb_secret_") || jwtRole(key) === "service_role") {
    return "The key in .env.local is a SECRET key. Delete it from .env.local now, revoke/roll it in Supabase (Project Settings → API Keys), and use the publishable or anon key instead.";
  }
  if (!key.startsWith("sb_publishable_") && jwtRole(key) !== "anon") {
    return "VITE_SUPABASE_ANON_KEY must be the publishable (sb_publishable_…) or anon key from Project Settings → API Keys.";
  }
  return null;
}

/** Project address shown on the login screen and in the console, so you can see which database this build uses. Never the key. */
export const supabaseProjectHost = url.replace(/^https:\/\//, "");

/** Non-null when the app is not configured safely; the app shows this message instead of starting. */
export const supabaseConfigError = checkConfig();

/** Null only when supabaseConfigError is set. */
export const supabase: SupabaseClient | null = supabaseConfigError ? null : createClient(url, key);
