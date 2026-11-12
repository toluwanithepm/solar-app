// Customer-facing API for quote, payment, handover and fault-report links (see ../_shared/contract.ts).
// Deployed with JWT verification off: customers aren't signed in; every action is checked against a link token.
import { clientKey, cors, makeDeps } from '../_shared/deps.ts';
import { handlePublic } from '../_shared/handlers.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

const deps = makeDeps();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  // Refuse very large bodies before parsing (a photo is at most ~400 KB as base64)
  if (Number(req.headers.get('content-length') ?? 0) > 600_000) {
    return new Response(JSON.stringify({ error: 'Request too large' }), { status: 413, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  const body = await req.json().catch(() => null);
  const result = await handlePublic(body, req.headers.get('Authorization'), deps, await clientKey(req));
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { ...cors, 'Content-Type': 'application/json' } });
});
