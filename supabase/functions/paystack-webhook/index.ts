// Paystack webhook (Settings › API Keys & Webhooks › Webhook URL = {SUPABASE_URL}/functions/v1/paystack-webhook).
// Deployed with JWT verification off; requests are trusted only if the HMAC signature matches the secret key.
import { env, makeDeps } from '../_shared/deps.ts';
import { handleWebhook } from '../_shared/handlers.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

const deps = makeDeps();
const secret = env('PAYSTACK_SECRET_KEY');

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await req.text();
  const result = await handleWebhook(raw, req.headers.get('x-paystack-signature'), secret, deps);
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
});
