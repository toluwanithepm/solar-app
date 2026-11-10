// Bachs webhook (Developer Portal › Webhooks › Add destination = {SUPABASE_URL}/functions/v1/bachs-webhook,
// events: collection.succeeded). Deployed with JWT verification off; trusted only if the signature matches.
import { env, makeDeps } from '../_shared/deps.ts';
import { handleBachsWebhook } from '../_shared/handlers.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

const deps = makeDeps();
const secret = env('BACHS_WEBHOOK_SECRET');

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await req.text();
  const result = await handleBachsWebhook(raw, req.headers.get('X-Bachs-Signature-V2'), secret, deps);
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
});
