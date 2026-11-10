// Sign-in and sign-up for both modes. Demo mode simulates the SMS code in the browser;
// backend mode uses Supabase phone OTP, and the login token carries the firm and role (supabase/migrations/*_auth.sql).
import { createEmpty } from './seed';
import { findUserByPhone, sendOtp, signUpFirm } from './salesActions';
import { isBackend, isOnline, replaceDb, setSession, update } from './store';
import type { DB, Role } from './types';
import { toE164 } from './remote/mapping';
import type { Ctx } from './remote/mapping';
import { startSync, stopSync, supabase, wipeDeviceData } from './remote/sync';

export type AuthMode = 'signin' | 'signup';
type Claims = { sub?: string; firm_id?: string; staff_id?: string; app_role?: Role };

const NOT_STAFF = 'No staff account uses this number. Ask your company owner to add you, or start a free trial.';

function claimsOf(accessToken: string): Claims {
  const bin = atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
}

// Who was signed in on this device, so the app can open with no connection (NFR-1)
const CTX_KEY = 'solar-app:signed-in';
function savedCtx(): Ctx | null {
  try {
    return JSON.parse(localStorage.getItem(CTX_KEY) ?? 'null');
  } catch {
    return null;
  }
}

async function enter(c: Claims): Promise<Role> {
  const ctx: Ctx = { firmId: c.firm_id!, staffId: c.staff_id!, role: c.app_role! };
  localStorage.setItem(CTX_KEY, JSON.stringify(ctx));
  await startSync(ctx);
  setSession({ userId: ctx.staffId });
  return ctx.role;
}

/** Forget the user on this device and remove their saved data (sign-out, deactivated staff, lost phone: NFR-11). */
async function leave() {
  setSession(null);
  localStorage.removeItem(CTX_KEY);
  await stopSync();
  await wipeDeviceData();
  replaceDb(createEmpty());
}

/** Send a sign-in code. In demo mode the code comes back to show on screen. */
export async function requestCode(phone: string, mode: AuthMode): Promise<{ demoCode?: string; error?: string }> {
  if (!isBackend) {
    if (mode === 'signin' && !findUserByPhone(phone)) return { error: NOT_STAFF };
    return { demoCode: sendOtp(phone) };
  }
  const { error } = await supabase().auth.signInWithOtp({ phone: toE164(phone) });
  return error ? { error: error.message } : {};
}

/**
 * Check the code. Sign-in returns the user's role once their data is loading;
 * sign-up returns { ok: true } so the company details step can follow.
 */
export async function verifyCode(phone: string, code: string, mode: AuthMode, demoCode?: string): Promise<{ role?: Role; ok?: boolean; error?: string }> {
  if (!isBackend) {
    if (code.trim() !== demoCode) return { error: 'That code is not right. Check the SMS and try again.' };
    if (mode === 'signup') return { ok: true };
    const user = findUserByPhone(phone);
    if (!user) return { error: NOT_STAFF };
    setSession({ userId: user.id });
    return { role: user.role };
  }
  const { data, error } = await supabase().auth.verifyOtp({ phone: toE164(phone), token: code.trim(), type: 'sms' });
  if (error || !data.session) return { error: error?.message ?? 'That code is not right. Check the SMS and try again.' };
  const c = claimsOf(data.session.access_token);
  if (mode === 'signup') {
    if (c.firm_id) return { error: 'This phone number already belongs to a firm. Sign in instead.' };
    return { ok: true };
  }
  if (!c.firm_id) {
    await supabase().auth.signOut();
    return { error: NOT_STAFF };
  }
  return { role: await enter(c) };
}

type FirmInput = { ownerName: string; phone: string; company: Pick<DB['company'], 'name' | 'logoDataUrl' | 'address' | 'state' | 'bankName' | 'accountNumber' | 'accountName'> };

/** E1-1: create the firm after the code is verified. */
export async function finishSignUp(input: FirmInput): Promise<{ error?: string }> {
  if (!isBackend) {
    signUpFirm(input);
    return {};
  }
  const c = input.company;
  const { error } = await supabase().rpc('create_firm', {
    p_firm_name: c.name,
    p_owner_name: input.ownerName,
    p_address: c.address,
    p_state: c.state,
    p_bank_name: c.bankName,
    p_account_number: c.accountNumber,
    p_account_name: c.accountName,
  });
  if (error) return { error: error.message };
  // The new token carries the firm claims
  const { data, error: refreshError } = await supabase().auth.refreshSession();
  if (refreshError || !data.session) return { error: refreshError?.message ?? 'Could not refresh your sign-in.' };
  await enter(claimsOf(data.session.access_token));
  if (c.logoDataUrl) update((d) => (d.company.logoDataUrl = c.logoDataUrl));
  return {};
}

export async function signOut() {
  if (!isBackend) return setSession(null);
  await leave();
  await supabase().auth.signOut();
}

let restoring: Promise<void> | null = null;

/** On app start in backend mode: resume a saved sign-in. Runs once, however many times it is called. */
export function restoreSession(): Promise<void> {
  restoring ??= resume();
  return restoring;
}

async function resume() {
  if (!isBackend) return;
  const { data } = await supabase().auth.getSession().catch(() => ({ data: { session: null } }));
  const c = data.session ? claimsOf(data.session.access_token) : null;
  const saved = savedCtx();
  if (c?.firm_id && c.staff_id && c.app_role) {
    await enter(c);
  } else if (saved && !isOnline()) {
    // No connection to refresh the sign-in: open from the copy kept on this device
    await startSync(saved);
    setSession({ userId: saved.staffId });
  } else {
    // Signed out, or the server no longer recognises this user: nothing stays on the device
    await leave();
  }
  supabase().auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') void leave();
    // A refreshed sign-in with no firm means the staff member was deactivated: sign this device out and wipe it
    if (event === 'TOKEN_REFRESHED' && session && !claimsOf(session.access_token).firm_id) {
      void leave().then(() => supabase().auth.signOut());
    }
  });
}
