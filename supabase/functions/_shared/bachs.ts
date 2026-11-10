// Bachs (docs.bachs.io): hosted checkout sessions, session lookup, and webhook signature checks.
// NGN cards and bank transfer only (no USSD). Return URLs must be public: Bachs refuses localhost, even in the sandbox.
import { hmacHex, timingSafeEqual } from './paystack.ts';
import { toKobo, type Charge, type PaymentProvider } from './providers.ts';

/** Sandbox keys (sk_sandbox_…) use the sandbox API; anything else is live. */
const apiFor = (key: string) => (key.startsWith('sk_sandbox_') ? 'https://sandbox-api.bachs.io' : 'https://api.bachs.io');

const withReference = (url: string, reference: string) => `${url}${url.includes('?') ? '&' : '?'}reference=${encodeURIComponent(reference)}`;

/** Bachs reports how the money moved; the database maps these to Card / Transfer / USSD. */
export const bachsChannel = (methodOrType: string) => {
  const m = methodOrType.toLowerCase();
  if (m.includes('card')) return 'card';
  if (m.includes('transfer') || m.includes('virtual')) return 'bank_transfer';
  return m;
};

export function bachsProvider(apiKey: string, fetchImpl: typeof fetch = fetch): PaymentProvider {
  const api = apiFor(apiKey);
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetchImpl(`${api}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Payment provider: Bachs ${body.message ?? body.error_code ?? res.statusText}`);
    return body.data ?? body;
  };
  return {
    name: 'bachs',
    async start(p) {
      // No customer is passed: the hosted page asks for the buyer's name and email, so no placeholder addresses are needed
      const session = await call('/v1/checkout-sessions', {
        method: 'POST',
        body: JSON.stringify({
          pricing: { currency: 'NGN', amount: p.amountNaira.toFixed(2) },
          payment_method_types: ['NGN_CARD', 'NGN_BANK_TRANSFER'],
          reference: p.reference,
          metadata: { ...p.metadata, description: p.description.slice(0, 200) },
          success_url: withReference(p.returnUrl, p.reference),
          cancel_url: p.returnUrl,
          expires_in_minutes: 60,
        }),
      });
      return { authorizationUrl: session.checkout_url, providerRef: session.id };
    },
    async check(_reference, checkoutId): Promise<Charge> {
      if (!checkoutId) return { status: 'pending', amountKobo: 0, channel: '', paidAt: null };
      const s = await call(`/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`);
      const paid = s.status === 'completed' || s.payment_status === 'succeeded';
      const failed = ['expired', 'cancelled'].includes(s.status) || ['failed', 'canceled'].includes(s.payment_status);
      return {
        status: paid ? 'success' : failed ? 'failed' : 'pending',
        amountKobo: s.currency === 'NGN' ? toKobo(s.amount) : 0,
        channel: bachsChannel(String(s.payment_method ?? '')),
        paidAt: s.completed_at ?? s.updated_at ?? null,
      };
    },
  };
}

type BachsEvent = {
  id?: string;
  type?: string;
  data?: {
    reference?: string | null;
    status?: string;
    amount?: string;
    currency?: string;
    expected_amount?: string;
    processing_fee?: string | null;
    fee_bearer?: string;
    payment_method_details?: { type?: string } | null;
  };
  created_at?: string;
};

/**
 * Bachs signs `${timestamp}.${rawBody}` with HMAC-SHA256 (X-Bachs-Signature-V2: t=…,v1=…[,v1=…]).
 * Deliveries older than 5 minutes are refused as possible replays; any v1 may match (secret rotation).
 */
export async function validBachsSignature(secret: string, rawBody: string, header: string | null, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('=', 2) as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > 300) return false;
  const expected = await hmacHex('SHA-256', secret, `${t}.${rawBody}`);
  return parts.some(([k, v]) => k === 'v1' && timingSafeEqual(expected, v ?? ''));
}

export async function signBachs(secret: string, rawBody: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${await hmacHex('SHA-256', secret, `${t}.${rawBody}`)}`;
}

/**
 * What a collection.succeeded event paid towards our payment, in kobo.
 * OVERPAID applies the amount that was due; a fee the customer carried is not part of the payment.
 */
export function bachsPaidKobo(ev: BachsEvent): number {
  const d = ev.data ?? {};
  if (d.currency && d.currency !== 'NGN') return 0;
  if (d.status === 'OVERPAID' && d.expected_amount) return toKobo(d.expected_amount);
  const fee = d.fee_bearer === 'customer' && d.processing_fee ? Number(d.processing_fee) : 0;
  return toKobo(Number(d.amount ?? 0) - fee);
}

export type { BachsEvent };
