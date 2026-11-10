// Backend settings from Vite env (see .env.example). Without them the app runs on browser demo data.
// Outside Vite (database tests under Node) the same names are read from the process environment.
const env =
  (import.meta as { env?: Record<string, string | undefined> }).env ??
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ??
  {};

export const supabaseUrl = env.VITE_SUPABASE_URL ?? '';
export const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY ?? '';

export const backendConfigured = () => Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Where customers open links (quote, pay, handover). The web app uses its own address; the Android app has no
 * web address of its own, so its build must set VITE_PUBLIC_APP_URL to the hosted web app.
 */
export const publicAppUrl = () => (env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '');
