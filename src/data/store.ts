// App data store. Everything reads through useDb() and writes through update().
// Demo mode keeps data in this browser (localStorage). Backend mode (VITE_SUPABASE_URL set) holds the firm's data
// loaded from Supabase; update() applies changes here at once and the change listener sends them to the database.
import { useSyncExternalStore } from 'react';
import type { AuditEntity, DB, ID, Message, MessageChannel, Notification, Role, User } from './types';
import { backendConfigured } from './remote/config';
import { createEmpty, createSeed } from './seed';

const DB_KEY = 'solar-app:db';
const SESSION_KEY = 'solar-app:session';
const DB_VERSION = 1;

/** True when the app talks to Supabase instead of keeping demo data in the browser. */
export const isBackend = backendConfigured();

function load(): DB {
  if (isBackend) return createEmpty();
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed.version === DB_VERSION) return parsed;
    }
  } catch {
    // fall through to seed
  }
  return createSeed();
}

let db: DB = load();
const listeners = new Set<() => void>();

function persist() {
  if (isBackend) return;
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    // Quota exceeded (large photos) — keep working in memory
  }
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getDb(): DB {
  return db;
}

/** Subscribe a component to the whole DB or a slice of it. Selectors must return stable references (no new arrays/objects). */
export function useDb(): DB;
export function useDb<T>(select: (d: DB) => T): T;
export function useDb<T>(select?: (d: DB) => T) {
  return useSyncExternalStore(subscribe, () => (select ? select(db) : db));
}

type ChangeListener = (prev: DB, next: DB) => void;
let changeListener: ChangeListener | null = null;

/** Backend mode registers here to send each change to the database. */
export function setChangeListener(fn: ChangeListener | null) {
  changeListener = fn;
}

/** Apply a mutation. The recipe gets a structured clone it can change freely. */
export function update(recipe: (draft: DB) => void) {
  const prev = db;
  const draft = structuredClone(db);
  recipe(draft);
  db = draft;
  emit();
  changeListener?.(prev, draft);
}

/** Replace the whole snapshot (backend mode, after loading from the database). Doesn't trigger a save. */
export function replaceDb(next: DB) {
  db = next;
  emit();
}

export function resetDemoData() {
  if (isBackend) return;
  db = createSeed();
  emit();
}

// ---------- ids and numbering ----------

/** New record id. UUIDs, so the same ids work in the database (the prefix is kept for call-site readability only). */
export function uid(_prefix = ''): ID {
  return crypto.randomUUID();
}

/** Next human-readable number, e.g. nextNumber(draft, 'Q') → 'Q-2319' */
export function nextNumber(draft: DB, prefix: string): string {
  const n = (draft.counters[prefix] ?? 1000) + 1;
  draft.counters[prefix] = n;
  return `${prefix}-${n}`;
}

export const nowIso = () => new Date().toISOString();

// ---------- side-effect helpers used inside update() ----------

export function addAudit(draft: DB, entity: AuditEntity, entityId: ID, summary: string, before?: unknown, after?: unknown) {
  draft.audit.unshift({ id: uid('a_'), at: nowIso(), userId: getSession()?.userId ?? 'system', entity, entityId, summary, before, after });
}

/** Simulated WhatsApp Business API / SMS send. Lands in the outbox (Settings › Messages). */
export function sendMessage(draft: DB, msg: Omit<Message, 'id' | 'at' | 'channel'> & { channel?: MessageChannel }) {
  draft.messages.unshift({ id: uid('m_'), at: nowIso(), channel: msg.channel ?? 'WhatsApp', ...msg });
}

export function notify(draft: DB, text: string, link?: string, forRoles: Role[] = ['owner', 'office']) {
  const n: Notification = { id: uid('n_'), at: nowIso(), text, link, read: false, forRoles };
  draft.notifications.unshift(n);
}

// ---------- session ----------

export type Session = { userId: ID };
let session: Session | null = (() => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
})();
const sessionListeners = new Set<() => void>();

export function getSession() {
  return session;
}

export function setSession(s: Session | null) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
  sessionListeners.forEach((l) => l());
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (l) => {
      sessionListeners.add(l);
      return () => sessionListeners.delete(l);
    },
    () => session,
  );
}

/** The signed-in user, or null. */
export function useCurrentUser(): User | null {
  const s = useSession();
  return useDb((d) => (s ? (d.users.find((u) => u.id === s.userId) ?? null) : null));
}

// ---------- connectivity (NFR-1 offline-first) ----------

const onlineListeners = new Set<() => void>();
let forcedOffline = false;
export function isOnline() {
  return !forcedOffline && (typeof navigator === 'undefined' || navigator.onLine);
}
/** Lets the tech app simulate losing data, for testing offline behaviour. */
export function setForcedOffline(v: boolean) {
  forcedOffline = v;
  onlineListeners.forEach((l) => l());
  if (!v) syncPending();
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    onlineListeners.forEach((l) => l());
    syncPending();
  });
  window.addEventListener('offline', () => onlineListeners.forEach((l) => l()));
}
export function useOnline() {
  return useSyncExternalStore(
    (l) => {
      onlineListeners.add(l);
      return () => onlineListeners.delete(l);
    },
    isOnline,
  );
}

/** Backend mode listens here to send queued changes when the connection returns. */
export function onConnectivityChange(fn: () => void) {
  onlineListeners.add(fn);
  return () => onlineListeners.delete(fn);
}

/** Demo mode: pretend to push queued field data (mark jobs synced and photos uploaded). */
export function syncPending() {
  if (isBackend || !isOnline()) return;
  const hasPending = db.jobs.some((j) => j.pendingSync) || db.surveys.some((s) => s.photos.some((p) => !p.uploaded));
  if (!hasPending) return;
  update((d) => {
    for (const j of d.jobs) {
      if (j.pendingSync) {
        j.pendingSync = false;
        j.photos.forEach((p) => (p.uploaded = true));
      }
    }
    for (const s of d.surveys) s.photos.forEach((p) => (p.uploaded = true));
  });
}

/** Mark a job as edited in the field; it syncs at once when online. */
export function touchJobFromField(draft: DB, jobId: ID) {
  const job = draft.jobs.find((j) => j.id === jobId);
  if (!job) return;
  job.updatedAt = nowIso();
  job.pendingSync = !isOnline();
  if (isOnline()) job.photos.forEach((p) => (p.uploaded = true));
}
