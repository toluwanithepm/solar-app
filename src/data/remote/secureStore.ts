// Keys and sign-in tokens on the device (NFR-9: encrypted local storage on the phone).
// In the Android app they live in the Android Keystore (via the secure-storage plugin); the data copy in
// localCache.ts is encrypted with a key kept there. In a browser the key is a non-exportable browser key.
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Capacitor } from '@capacitor/core';

export const isNativeApp = Capacitor.isNativePlatform();

const KEY_NAME = 'solar-app:cache-key';
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => new Uint8Array(Array.from(atob(s), (c) => c.charCodeAt(0)));

const importKey = (raw: Uint8Array<ArrayBuffer>, extractable: boolean) => crypto.subtle.importKey('raw', raw, 'AES-GCM', extractable, ['encrypt', 'decrypt']);

/**
 * The AES-256 key that encrypts the device copy.
 * `browserKey` reads/writes a non-exportable key in the browser's own storage (used outside the Android app).
 */
export async function cacheKey(browserKey: { get: () => Promise<CryptoKey | undefined>; set: (k: CryptoKey) => Promise<unknown> }): Promise<CryptoKey> {
  if (isNativeApp) {
    const saved = await SecureStorage.get(KEY_NAME);
    if (typeof saved === 'string') return importKey(unb64(saved), false);
    const raw = crypto.getRandomValues(new Uint8Array(32));
    await SecureStorage.set(KEY_NAME, b64(raw));
    return importKey(raw, false);
  }
  const existing = await browserKey.get();
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await browserKey.set(key);
  return key;
}

export async function forgetCacheKey() {
  if (isNativeApp) await SecureStorage.remove(KEY_NAME).catch(() => undefined);
}

export async function encrypt(key: CryptoKey, text: string): Promise<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)) };
}

export async function decrypt(key: CryptoKey, box: { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }): Promise<string> {
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv }, key, box.data));
}

/** Where Supabase keeps the sign-in session: the Keystore in the Android app, the browser's storage otherwise. */
export const authStorage = isNativeApp
  ? {
      getItem: async (k: string) => {
        const v = await SecureStorage.get(k);
        return typeof v === 'string' ? v : null;
      },
      setItem: async (k: string, v: string) => void (await SecureStorage.set(k, v)),
      removeItem: async (k: string) => void (await SecureStorage.remove(k)),
    }
  : undefined;
