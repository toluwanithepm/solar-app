// Calls to the `public` Edge Function, used by customer pages (no sign-in) and for Paystack payments.
// The request and response shapes are the contract in supabase/functions/_shared/contract.ts.
import { publicAppUrl } from './config';
import { LINK_PATH, TOKEN_RE, type LinkKind, type PublicRequest } from '../../../supabase/functions/_shared/contract';
import { supabaseAnonKey, supabaseUrl } from './config';

export type { LinkKind } from '../../../supabase/functions/_shared/contract';

export async function callPublic<T>(req: PublicRequest, accessToken?: string): Promise<T> {
  const res = await fetch(`${supabaseUrl}/functions/v1/public`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${accessToken ?? supabaseAnonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

/** Link tokens are 64 hex characters; record ids are UUIDs. */
export const isToken = (s?: string) => !!s && TOKEN_RE.test(s);

export const customerUrl = (kind: LinkKind, tokenOrId: string) => `${publicAppUrl()}/${LINK_PATH[kind]}/${tokenOrId}`;
