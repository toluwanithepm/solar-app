// Builds the handlers' dependencies inside Supabase Edge Functions (Deno).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { bachsProvider } from './bachs.ts';
import type { Deps } from './handlers.ts';
import { paystackProvider } from './paystack.ts';
import type { PaymentProvider, ProviderName } from './providers.ts';

declare const Deno: { env: { get(name: string): string | undefined } };

export const env = (name: string) => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
};

/** PAYMENT_PROVIDER picks where new payments go; Paystack unless set to bachs. */
export const activeProvider = (): ProviderName => (Deno.env.get('PAYMENT_PROVIDER') === 'bachs' ? 'bachs' : 'paystack');

export function makeDeps(): Deps {
  const url = env('SUPABASE_URL');
  const service = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const anonKey = env('SUPABASE_ANON_KEY');
  // Built on first use, so a function only needs the secrets of the providers it actually calls
  const providers: Partial<Record<ProviderName, PaymentProvider>> = {};
  const provider = (name: ProviderName = activeProvider()) =>
    (providers[name] ??= name === 'bachs' ? bachsProvider(env('BACHS_API_KEY')) : paystackProvider(env('PAYSTACK_SECRET_KEY')));
  return {
    async rpc(fn, args) {
      const { data, error } = await service.rpc(fn, args);
      if (error) throw new Error(error.message);
      return data;
    },
    async userRpc(accessToken, fn, args = {}) {
      const asUser = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
      const { data, error } = await asUser.rpc(fn, args);
      if (error) throw new Error(error.message);
      return data;
    },
    async signUrls(bucket, paths) {
      const out: Record<string, string> = {};
      for (let i = 0; i < paths.length; i += 100) {
        const { data } = await service.storage.from(bucket).createSignedUrls(paths.slice(i, i + 100), 60 * 60);
        for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
      }
      return out;
    },
    publicFileUrl: (bucket, path) => service.storage.from(bucket).getPublicUrl(path).data.publicUrl,
    async upload(bucket, path, bytes, contentType) {
      const { error } = await service.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
      if (error) throw new Error(error.message);
    },
    async rateLimit(bucket, client, limit, windowSeconds) {
      const { data, error } = await service.rpc('svc_rate_limit', { p_bucket: bucket, p_key: client, p_limit: limit, p_window_seconds: windowSeconds });
      if (error) throw new Error(error.message);
      return data !== false;
    },
    provider,
    activeProvider: activeProvider(),
    appUrl: env('PUBLIC_APP_URL').replace(/\/$/, ''),
  };
}

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Who is calling, for rate limiting: the first address in X-Forwarded-For (set by Supabase's edge), hashed so raw IP
 * addresses are never stored. Empty when unknown (then no per-client limit applies; the firm-wide limits still do).
 */
export async function clientKey(req: Request): Promise<string> {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || '';
  if (!ip) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`solar-rate:${ip}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}
