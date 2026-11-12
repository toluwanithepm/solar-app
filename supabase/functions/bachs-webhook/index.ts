// Bachs webhook (Developer Portal › Webhooks › Add destination = {SUPABASE_URL}/functions/v1/bachs-webhook,
// events: collection.succeeded). Deployed with JWT verification off; trusted only if the signature matches.
import { makeDeps } from '../_shared/deps.ts';
import { handleBachsWebhook } from '../_shared/handlers.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void; env: { get(name: string): string | undefined } };

// Bachs is the second provider. Until its secret is set, answer "not set up" instead of crashing at start-up (a 500
// would make Bachs retry, and tells a caller nothing useful).
const secret = Deno.env.get('BACHS_WEBHOOK_SECRET');
const deps = secret ? makeDeps() : null;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!secret || !deps) return json(404, { error: 'Bachs payments are not set up' });
  const raw = await req.text();
  const result = await handleBachsWebhook(raw, req.headers.get('X-Bachs-Signature-V2'), secret, deps);
  return json(result.status, result.body);
});
