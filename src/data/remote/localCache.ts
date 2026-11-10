// On-device copy of a technician's data and unsent changes (NFR-1: work for days with no connection).
// IndexedDB, one encrypted record per staff member (NFR-9). Wiped on sign-out and when the server no longer recognises the user.
import type { DB } from '../types';
import type { Ctx, Flat, Op } from './mapping';
import { cacheKey, decrypt, encrypt, forgetCacheKey } from './secureStore';

export type Rejected = { at: string; unit: string; reason: string; ops: Op[] };
export type Cached = { ctx: Ctx; db: DB; baseline: Flat; rejected: Rejected[]; savedAt: string };

const NAME = 'solar-app-offline';
const STORE = 'state';
const BROWSER_KEY = '__key';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  try {
    const idb = await open();
    return await new Promise<T>((resolve, reject) => {
      const req = fn(idb.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Private browsing or storage full: carry on online-only
    return undefined;
  }
}

const key = () =>
  cacheKey({
    get: () => run<CryptoKey>('readonly', (s) => s.get(BROWSER_KEY)),
    set: (k) => run('readwrite', (s) => s.put(k, BROWSER_KEY)),
  });

// The baseline is a Map of Maps; JSON needs arrays
const encode = (c: Cached) => JSON.stringify({ ...c, baseline: [...c.baseline].map(([t, rows]) => [t, [...rows]]) });
function decode(text: string): Cached {
  const raw = JSON.parse(text) as Omit<Cached, 'baseline'> & { baseline: [string, [string, Record<string, unknown>][]][] };
  return { ...raw, baseline: new Map(raw.baseline.map(([t, rows]) => [t, new Map(rows)])) as Flat };
}

export async function cacheGet(staffId: string): Promise<Cached | undefined> {
  const box = await run<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }>('readonly', (s) => s.get(staffId));
  if (!box?.data) return undefined;
  try {
    return decode(await decrypt(await key(), box));
  } catch {
    // Key gone or record damaged: treat as no copy and load from the server
    return undefined;
  }
}

export async function cacheSet(staffId: string, value: Cached) {
  try {
    const box = await encrypt(await key(), encode(value));
    await run('readwrite', (s) => s.put(box, staffId));
  } catch {
    // Encryption unavailable (very old WebView): keep nothing on the device rather than store it in the clear
  }
}

export async function cacheClear() {
  await run('readwrite', (s) => s.clear());
  await forgetCacheKey();
}
