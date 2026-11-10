// Backend mode: keeps the store in step with Supabase, online or not.
// Online: loads everything the signed-in user may see, reloads on live changes (Realtime), and sends each local change
// to public.apply_changes. Offline (technicians): the data and unsent changes are kept on the device; when the
// connection returns they are sent one unit of work at a time (per job, per survey), then the data is reloaded.
// A unit the database refuses is set aside and reported; it never blocks the others, and nothing is lost to a dropped connection.
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { getDb, isOnline, onConnectivityChange, replaceDb, setChangeListener } from '../store';
import type { DB } from '../types';
import { supabaseAnonKey, supabaseUrl } from './config';
import { cacheClear, cacheGet, cacheSet, type Rejected } from './localCache';
import { authStorage } from './secureStore';
import { applyOps, diff, flatten, fromRemote, groupOps, READ_ONLY_TABLES, TABLES, type Ctx, type Flat, type RawTables } from './mapping';

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  // In the Android app the sign-in session is kept in the Keystore, and there is no sign-in link in the URL to read
  client ??= createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, ...(authStorage ? { storage: authStorage, detectSessionInUrl: false } : {}) } });
  return client;
}

// ---------- status ----------

export type SyncStatus = {
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  /** Changes made on this device that the server doesn't have yet */
  pending: number;
  /** Units of work the server refused (kept on the device for support) */
  rejected: number;
  error?: string;
};
const idle: SyncStatus = { loaded: false, loading: false, saving: false, pending: 0, rejected: 0 };
let status: SyncStatus = idle;
const statusListeners = new Set<() => void>();
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((l) => l());
}
export function useSyncStatus() {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    () => status,
  );
}
export const clearSyncError = () => setStatus({ error: undefined });
export const unsentChanges = () => status.pending;

// ---------- session state ----------

let ctx: Ctx | null = null;
let baseline: Flat | null = null;
let channel: RealtimeChannel | null = null;
let rejected: Rejected[] = [];
let stopConnectivity: (() => void) | null = null;

/** Technicians' data is kept on the device so the app works with no connection (NFR-1). */
const keepsOfflineCopy = (c: Ctx) => c.role === 'technician';

export async function startSync(c: Ctx) {
  // Signing in again (or as someone else) starts from a clean slate
  if (ctx) await stopSync();
  ctx = c;
  setChangeListener(onLocalChange);
  stopConnectivity = onConnectivityChange(() => {
    if (isOnline()) void pushThenReload();
    else countPending();
  });
  channel = supabase()
    .channel(`firm-${c.firmId}`)
    .on('postgres_changes', { event: '*', schema: 'public' }, () => scheduleReload())
    .subscribe();

  // Ask the browser not to clear this site's data when the phone runs low on space (it may still say no)
  if (keepsOfflineCopy(c)) void navigator.storage?.persist?.().catch(() => false);

  const cached = keepsOfflineCopy(c) ? await cacheGet(c.staffId) : undefined;
  if (cached && cached.ctx.firmId === c.firmId) {
    // Start from the device copy at once; catch up with the server in the background
    baseline = cached.baseline;
    rejected = cached.rejected ?? [];
    replaceDb(cached.db);
    setStatus({ loaded: true, loading: false, rejected: rejected.length });
    countPending();
    void pushThenReload();
    return;
  }
  return reload();
}

export async function stopSync() {
  setChangeListener(null);
  stopConnectivity?.();
  stopConnectivity = null;
  if (channel) await supabase().removeChannel(channel);
  channel = null;
  ctx = null;
  baseline = null;
  rejected = [];
  setStatus(idle);
}

/** Remove everything kept on this device (sign-out, or the server no longer recognises the user: NFR-11). */
export const wipeDeviceData = () => cacheClear();

// ---------- device copy ----------

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveToDevice() {
  if (!ctx || !baseline || !keepsOfflineCopy(ctx)) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (ctx && baseline) void cacheSet(ctx.staffId, { ctx, db: getDb(), baseline, rejected, savedAt: new Date().toISOString() });
  }, 400);
}

function pendingOps() {
  return ctx && baseline ? diff(baseline, flatten(getDb(), ctx)) : [];
}
function countPending() {
  setStatus({ pending: pendingOps().length });
}

function onLocalChange() {
  countPending();
  saveToDevice();
  schedulePush();
}

// ---------- loading ----------

async function fetchAll(table: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase().from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function signedUrls(bucket: string, paths: string[]) {
  const urls = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 100) {
    const { data } = await supabase().storage.from(bucket).createSignedUrls(paths.slice(i, i + 100), 60 * 60);
    for (const d of data ?? []) if (d.signedUrl && d.path) urls.set(d.path, d.signedUrl);
  }
  return urls;
}

let reloading: Promise<void> | null = null;
let reloadAgain = false;

/**
 * Load the firm's data and make it the store's snapshot. Unsent local changes are never overwritten:
 * they are sent first. `discardLocal` is used only after the server refused them.
 */
export async function reload(discardLocal = false): Promise<void> {
  if (!ctx) return;
  if (!isOnline()) {
    if (!status.loaded) setStatus({ loading: false, error: "You're offline and this device has no saved copy of your data yet. Connect once to load it." });
    return;
  }
  if (reloading) {
    reloadAgain = true;
    return reloading;
  }
  setStatus({ loading: !status.loaded });
  reloading = (async () => {
    try {
      const names = [...TABLES, ...READ_ONLY_TABLES];
      const raw: RawTables = Object.fromEntries(await Promise.all(names.map(async (t) => [t, await fetchAll(t)] as const)));
      const photoPaths = raw.photos.map((p) => p.storage_path).filter(Boolean) as string[];
      const sigPaths = raw.jobs.map((j) => j.signature_path).filter(Boolean) as string[];
      const [photoUrls, sigUrls] = await Promise.all([signedUrls('photos', photoPaths), signedUrls('signatures', sigPaths)]);
      const fileUrl = (bucket: string, path: string) =>
        bucket === 'logos' ? supabase().storage.from('logos').getPublicUrl(path).data.publicUrl : ((bucket === 'photos' ? photoUrls : sigUrls).get(path) ?? '');
      // A change made while loading is still waiting to be saved; send it before taking the server's copy
      if (pushing || pushTimer || (!discardLocal && baseline && pendingOps().length)) {
        if (!pushing && !pushTimer) schedulePush();
        return;
      }
      const next = fromRemote(raw, ctx!, fileUrl);
      baseline = flatten(next, ctx!);
      replaceDb(next);
      setStatus({ loaded: true, loading: false, pending: 0 });
      saveToDevice();
    } catch (e) {
      // A dropped connection while a device copy is in use is normal; say nothing
      const quiet = status.loaded && isNetworkError(e);
      setStatus({ loading: false, ...(quiet ? {} : { error: `Couldn't load your data: ${(e as Error).message}` }) });
    } finally {
      reloading = null;
      if (reloadAgain) {
        reloadAgain = false;
        scheduleReload();
      }
    }
  })();
  return reloading;
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReload(discardLocal = false) {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void reload(discardLocal);
  }, 400);
}

// ---------- saving ----------

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void push();
  }, 300);
}

async function pushThenReload() {
  if (!isOnline()) return;
  if (pendingOps().length) await push();
  else scheduleReload();
}

const isDataUrl = (u?: string) => !!u && u.startsWith('data:');

const isNetworkError = (e: unknown) => /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out/i.test(String((e as Error)?.message ?? e));

/** Database refusals in plain words; the guards' own messages are already written for people. */
function friendlyError(message: string) {
  if (/that you can change|row-level security|permission denied|cannot be changed from the app/.test(message)) {
    return "your role doesn't allow this change.";
  }
  if (/duplicate key.*serial/.test(message)) return 'that serial number is already recorded.';
  return message;
}

/** Upload new photos, signatures and the logo, recording their storage paths in the snapshot. */
async function uploadFiles(c: Ctx): Promise<void> {
  const db = getDb();
  const uploads: { bucket: string; path: string; dataUrl: string; set: (d: DB, path: string) => void }[] = [];
  const photoTargets = (d: DB) => [
    ...d.surveys.flatMap((s) => s.photos),
    ...d.jobs.flatMap((j) => j.photos),
    ...d.tickets.flatMap((t) => t.photos),
    ...d.payments.flatMap((p) => (p.proofPhoto ? [p.proofPhoto] : [])),
  ];
  for (const p of photoTargets(db)) {
    if (!p.storagePath && isDataUrl(p.dataUrl)) {
      uploads.push({ bucket: 'photos', path: `${c.firmId}/${p.id}.jpg`, dataUrl: p.dataUrl, set: (d, path) => photoTargets(d).filter((x) => x.id === p.id).forEach((x) => (x.storagePath = path)) });
    }
  }
  for (const j of db.jobs) {
    if (j.signature && !j.signature.storagePath && isDataUrl(j.signature.dataUrl)) {
      uploads.push({ bucket: 'signatures', path: `${c.firmId}/${j.id}.png`, dataUrl: j.signature.dataUrl, set: (d, path) => d.jobs.filter((x) => x.id === j.id).forEach((x) => x.signature && (x.signature.storagePath = path)) });
    }
  }
  // A newly picked logo is a data URL; once uploaded it becomes the public URL, so it is sent once
  if (isDataUrl(db.company.logoDataUrl)) {
    uploads.push({
      bucket: 'logos',
      path: `${c.firmId}/logo-${Date.now()}.jpg`,
      dataUrl: db.company.logoDataUrl!,
      set: (d, path) => {
        d.company.logoPath = path;
        d.company.logoDataUrl = supabase().storage.from('logos').getPublicUrl(path).data.publicUrl;
      },
    });
  }
  if (!uploads.length) return;

  // Record each file as it lands, so a connection lost part-way doesn't upload the earlier ones again
  for (const u of uploads) {
    const blob = await (await fetch(u.dataUrl)).blob();
    const { error } = await supabase().storage.from(u.bucket).upload(u.path, blob, { upsert: true, contentType: blob.type });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    const next = structuredClone(getDb());
    u.set(next, u.path);
    replaceDb(next);
    saveToDevice();
  }
}

/** Send one unit; an expired sign-in is refreshed once and retried. */
async function sendUnit(ops: unknown[]) {
  let { error } = await supabase().rpc('apply_changes', { ops });
  if (error && /jwt|token/i.test(error.message)) {
    const refreshed = await supabase().auth.refreshSession();
    if (refreshed.error) throw new Error('fetch failed: could not refresh sign-in');
    ({ error } = await supabase().rpc('apply_changes', { ops }));
  }
  return error;
}

async function push(): Promise<void> {
  if (!ctx || !baseline) return;
  if (!isOnline()) return countPending();
  if (pushing) return schedulePush();
  pushing = true;
  setStatus({ saving: true });
  let refused: Rejected[] = [];
  let offline = false;
  try {
    await uploadFiles(ctx);
    const target = flatten(getDb(), ctx);
    const units = groupOps(diff(baseline, target), baseline, target);
    for (const u of units) {
      const error = await sendUnit(u.ops);
      if (!error) {
        baseline = applyOps(baseline, u.ops);
        saveToDevice();
      } else if (isNetworkError(error)) {
        throw new Error(error.message);
      } else {
        refused.push({ at: new Date().toISOString(), unit: u.unit, reason: friendlyError(error.message), ops: u.ops });
      }
    }
  } catch (e) {
    if (isNetworkError(e)) offline = true;
    else refused.push({ at: new Date().toISOString(), unit: 'files', reason: (e as Error).message, ops: [] });
  } finally {
    pushing = false;
  }

  if (refused.length) {
    rejected = [...rejected, ...refused].slice(-50);
    saveToDevice();
  }
  setStatus({
    saving: false,
    rejected: rejected.length,
    error: refused.length ? `${refused.length === 1 ? "Your last change wasn't saved" : `${refused.length} changes weren't saved`}: ${refused[0].reason}` : status.error,
  });
  countPending();
  // Connection dropped: everything unsent stays queued on the device for the next try
  if (offline) return;
  // Pick up numbers, defaults and what the server did; a refused unit is replaced by the server's copy
  scheduleReload(refused.length > 0);
}
