// Paystack: start a transaction, verify one, and check webhook signatures.
// Web-standard APIs only (fetch, Web Crypto), so it runs in Supabase Edge Functions (Deno) and in Node tests.
import { toKobo, type Charge, type PaymentProvider } from './providers.ts';

const API = 'https://api.paystack.co';

/** Paystack needs an email; customers sign up by phone, so use a non-deliverable address derived from it. */
const payEmail = (phone: string) => `p${phone.replace(/\D/g, '') || 'customer'}@example.com`;

export function paystackProvider(secretKey: string, fetchImpl: typeof fetch = fetch): PaymentProvider {
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.status === false) throw new Error(`Payment provider: Paystack ${body.message ?? res.statusText}`);
    return body.data;
  };
  return {
    name: 'paystack',
    async start(p) {
      const data = await call('/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify({
          email: payEmail(p.customerPhone),
          amount: toKobo(p.amountNaira),
          reference: p.reference,
          callback_url: p.returnUrl,
          currency: 'NGN',
          channels: ['card', 'bank_transfer', 'ussd', 'bank'],
          metadata: { ...p.metadata, description: p.description, customer: p.customerName },
        }),
      });
      return { authorizationUrl: data.authorization_url, providerRef: data.reference };
    },
    async check(reference): Promise<Charge> {
      const data = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
      const status = data.status === 'success' ? 'success' : data.status === 'failed' || data.status === 'abandoned' ? 'failed' : 'pending';
      return { status, amountKobo: Number(data.amount), channel: String(data.channel ?? ''), paidAt: data.paid_at ?? data.paidAt ?? null };
    },
  };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hmacHex(hash: 'SHA-256' | 'SHA-512', secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Paystack signs webhook bodies with HMAC-SHA512 of the raw body using the secret key (x-paystack-signature). */
export async function validSignature(secretKey: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  return timingSafeEqual(await hmacHex('SHA-512', secretKey, rawBody), signature);
}

export const signBody = (secretKey: string, rawBody: string) => hmacHex('SHA-512', secretKey, rawBody);
