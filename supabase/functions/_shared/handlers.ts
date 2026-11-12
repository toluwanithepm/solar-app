// Request handling for the `public`, `paystack-webhook` and `bachs-webhook` Edge Functions, independent of the runtime.
// The database functions (svc_*) hold the rules; these handlers check input, sign file URLs and talk to the payment provider.
import { bachsChannel, bachsPaidKobo, validBachsSignature, type BachsEvent } from './bachs.ts';
import type { FirmResponse, PayResponse, PublicRequest, ReportResponse, VerifyResponse, ViewResponse } from './contract.ts';
import { TOKEN_RE } from './contract.ts';
import { validSignature } from './paystack.ts';
import type { PaymentProvider, ProviderName } from './providers.ts';

export type Deps = {
  /** Call a database function as the service role; throws Error(message) on failure. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Call a database function as the signed-in user whose access token this is. */
  userRpc: (accessToken: string, fn: string, args?: Record<string, unknown>) => Promise<unknown>;
  signUrls: (bucket: string, paths: string[]) => Promise<Record<string, string>>;
  publicFileUrl: (bucket: string, path: string) => string;
  upload: (bucket: string, path: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  /** The provider new payments go to (PAYMENT_PROVIDER), or a named one for checking an earlier payment. */
  provider: (name?: ProviderName) => PaymentProvider;
  activeProvider: ProviderName;
  /** Where the web app runs, for the providers' return links, e.g. https://app.example.com */
  appUrl: string;
  /** Count a request from one client; false when it is over the limit (svc_rate_limit). Optional in tests. */
  rateLimit?: (bucket: string, client: string, limit: number, windowSeconds: number) => Promise<boolean>;
};

/**
 * Requests allowed per client (hashed IP address) per window. Generous for a real customer, who opens a link a few
 * times, pays once and sends one enquiry; tight enough to stop scripted abuse.
 */
export const RATE_LIMITS: Record<string, [limit: number, windowSeconds: number]> = {
  view: [60, 600],
  firm: [60, 600],
  enquire: [5, 3600],
  report: [5, 3600],
  'report-photo': [15, 3600],
  pay: [10, 600],
  'pay-subscription': [10, 600],
  verify: [30, 600],
};

/** Over the limit? A broken limiter never blocks customers (fails open) but is logged. */
async function limited(deps: Deps, action: string, client: string): Promise<boolean> {
  const rule = RATE_LIMITS[action];
  if (!deps.rateLimit || !client || !rule) return false;
  try {
    return !(await deps.rateLimit(action, client, rule[0], rule[1]));
  } catch (e) {
    console.error(`Rate limiter unavailable: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

export type Result = { status: number; body: unknown };

const ok = (body: unknown): Result => ({ status: 200, body });
const fail = (status: number, error: string): Result => ({ status, body: { error } });

/** Database errors raised for customers carry readable messages; anything else is hidden. */
function dbError(e: unknown): Result {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not valid or has expired|not available/.test(msg)) return fail(404, msg);
  if (/already|no longer|Choose one|Nothing to pay|Enter your|Tell us|Too many|No more photos|several problems|Only the owner|Unknown payment reference/.test(msg)) return fail(400, msg);
  console.error(msg);
  return fail(500, 'Something went wrong. Please try again.');
}

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

async function signFiles(deps: Deps, paths: { photos?: string[]; signatures?: string[]; logos?: string[] }) {
  const files: Record<string, string> = {};
  for (const bucket of ['photos', 'signatures'] as const) {
    const list = paths[bucket] ?? [];
    if (list.length) Object.entries(await deps.signUrls(bucket, list)).forEach(([p, u]) => (files[`${bucket}/${p}`] = u));
  }
  for (const p of paths.logos ?? []) files[`logos/${p}`] = deps.publicFileUrl('logos', p);
  return files;
}

async function startPayment(deps: Deps, intent: Record<string, unknown>, returnUrl: string): Promise<Result> {
  const provider = deps.provider();
  const reference = String(intent.reference);
  const started = await provider.start({
    reference,
    amountNaira: Number(intent.amount),
    description: String(intent.description ?? ''),
    returnUrl,
    customerName: String(intent.customerName ?? ''),
    customerPhone: String(intent.customerPhone ?? ''),
    metadata: { kind: String(intent.kind), target_id: String(intent.targetId), firm_id: String(intent.firmId) },
  });
  await deps.rpc('svc_set_intent_provider', { p_reference: reference, p_provider: provider.name, p_provider_ref: started.providerRef });
  return ok({ authorizationUrl: started.authorizationUrl, reference } satisfies PayResponse);
}

type Intent = { kind: VerifyResponse['kind']; target_id: string; status: string; provider: ProviderName; provider_ref: string | null };

/** Ask the payment's own provider about a charge and apply it if it succeeded. Safe to call any number of times. */
export async function verifyAndRecord(deps: Deps, reference: string): Promise<VerifyResponse> {
  const intent = (await deps.rpc('svc_intent', { p_reference: reference })) as Intent | null;
  if (!intent) throw new Error('Unknown payment reference');
  if (intent.status === 'paid') return { status: 'success', kind: intent.kind, targetId: intent.target_id };
  if (intent.status === 'mismatch') return { status: 'failed', kind: intent.kind, targetId: intent.target_id };
  const v = await deps.provider(intent.provider).check(reference, intent.provider_ref);
  if (v.status !== 'success') return { status: v.status, kind: intent.kind, targetId: intent.target_id };
  const r = (await deps.rpc('svc_record_gateway_payment', {
    p_reference: reference,
    p_amount_kobo: v.amountKobo,
    p_channel: v.channel,
    p_paid_at: v.paidAt ?? new Date().toISOString(),
  })) as { status: string; kind: VerifyResponse['kind']; targetId: string };
  return { status: r.status === 'success' ? 'success' : 'failed', kind: r.kind, targetId: r.targetId };
}

export async function handlePublic(body: unknown, authHeader: string | null, deps: Deps, client = ''): Promise<Result> {
  const req = body as PublicRequest;
  if (!req || typeof req !== 'object' || Array.isArray(req) || typeof req.action !== 'string') return fail(400, 'Bad request');
  if (!Object.hasOwn(RATE_LIMITS, req.action)) return fail(400, 'Unknown action');
  // Counted before any other check, so guessing tokens or sending junk uses up the allowance too
  if (await limited(deps, req.action, client)) return fail(429, 'Too many requests. Please wait a few minutes and try again.');
  try {
    switch (req.action) {
      case 'view': {
        if (!TOKEN_RE.test(str(req.token))) return fail(404, 'This link is not valid or has expired');
        const v = (await deps.rpc('svc_public_view', { p_token: req.token })) as Omit<ViewResponse, 'files'> & { paths: Record<string, string[]> };
        const { paths, ...rest } = v;
        return ok({ ...rest, files: await signFiles(deps, paths), paymentProvider: deps.activeProvider } satisfies ViewResponse);
      }
      case 'firm': {
        const r = (await deps.rpc('svc_firm_by_enquiry_token', { p_firm_token: str(req.firmToken, 80) })) as { firms: Record<string, unknown>[]; logo_path: string | null } | null;
        if (!r || !r.firms.length) return fail(404, 'This enquiry form is not available');
        return ok({ tables: { firms: r.firms }, files: await signFiles(deps, { logos: r.logo_path ? [r.logo_path] : [] }) } satisfies FirmResponse);
      }
      case 'enquire':
        return ok(
          await deps.rpc('svc_submit_enquiry', {
            p_firm_token: str(req.firmToken, 80),
            p_name: str(req.name, 120),
            p_phone: str(req.phone, 30),
            p_location: str(req.location, 200),
            p_property_type: str(req.propertyType, 20),
            p_consent: req.whatsappConsent === true,
            p_notes: str(req.notes, 2000) || null,
          }),
        );
      case 'report': {
        if (!TOKEN_RE.test(str(req.token))) return fail(404, 'This link is not valid or has expired');
        return ok((await deps.rpc('svc_report_fault', { p_token: req.token, p_description: str(req.description, 2000) })) as ReportResponse);
      }
      case 'report-photo': {
        if (typeof req.dataUrl === 'string' && req.dataUrl.length > 500_000) return fail(400, 'Photo is larger than 300 KB');
        const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(str(req.dataUrl, 500_000));
        if (!m || !isUuid(req.ticketId)) return fail(400, 'Send a JPEG photo');
        let bytes: Uint8Array;
        try {
          bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
        } catch {
          return fail(400, 'Send a JPEG photo');
        }
        if (bytes.length > 300 * 1024) return fail(400, 'Photo is larger than 300 KB');
        // A real JPEG starts with FF D8 FF; anything else renamed to .jpg is refused
        if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return fail(400, 'Send a JPEG photo');
        const slot = (await deps.rpc('svc_add_fault_photo', {
          p_token: str(req.token),
          p_ticket: req.ticketId,
          p_bytes: bytes.length,
          p_taken_at: str(req.takenAt, 40) || new Date().toISOString(),
          p_lat: typeof req.lat === 'number' ? req.lat : null,
          p_lng: typeof req.lng === 'number' ? req.lng : null,
        })) as { photoId: string; path: string };
        try {
          await deps.upload('photos', slot.path, bytes, 'image/jpeg');
        } catch (e) {
          await deps.rpc('svc_drop_photo', { p_photo: slot.photoId });
          throw e;
        }
        return ok({ ok: true });
      }
      case 'pay': {
        if (!TOKEN_RE.test(str(req.token))) return fail(404, 'This link is not valid or has expired');
        const intent = (await deps.rpc('svc_create_payment_intent', { p_token: req.token, p_option: isUuid(req.optionId) ? req.optionId : null })) as Record<string, unknown>;
        const path = intent.kind === 'quote' ? 'q' : 'pay';
        return await startPayment(deps, intent, `${deps.appUrl}/${path}/${req.token}`);
      }
      case 'pay-subscription': {
        const token = authHeader?.replace(/^Bearer\s+/i, '') ?? '';
        if (!token) return fail(401, 'Sign in first');
        const intent = (await deps.userRpc(token, 'create_subscription_intent')) as Record<string, unknown>;
        return await startPayment(deps, intent, `${deps.appUrl}/office/settings/billing`);
      }
      case 'verify': {
        const ref = str(req.reference, 80);
        if (!/^sfs_[0-9a-f]{32}$/.test(ref)) return fail(400, 'Unknown payment reference');
        return ok(await verifyAndRecord(deps, ref));
      }
      default:
        return fail(400, 'Unknown action');
    }
  } catch (e) {
    if (e instanceof Error && /^Payment provider:/.test(e.message)) {
      console.error(e.message);
      return fail(502, 'The payment service is not responding. Please try again.');
    }
    return dbError(e);
  }
}

/**
 * Paystack webhook: verify the signature, then apply charge.success events.
 * 200 tells Paystack to stop retrying; a 500 makes it retry later (e.g. the database was unreachable).
 */
export async function handleWebhook(rawBody: string, signature: string | null, secretKey: string, deps: Pick<Deps, 'rpc'>): Promise<Result> {
  if (!(await validSignature(secretKey, rawBody, signature))) return fail(401, 'Invalid signature');
  let event: { event?: string; data?: { reference?: string; amount?: number; channel?: string; paid_at?: string; status?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return fail(400, 'Bad JSON');
  }
  if (event.event !== 'charge.success' || !event.data?.reference?.startsWith('sfs_')) return ok({ ignored: true });
  return recordCharge(deps, event.data.reference, Number(event.data.amount), event.data.channel ?? '', event.data.paid_at);
}

/**
 * Bachs webhook: verify the signature and freshness, then apply collection.succeeded events for our references.
 * Bachs stops on a 4xx and retries a 5xx, so a bad signature gets 400 and a database failure 500.
 */
export async function handleBachsWebhook(rawBody: string, signatureV2: string | null, secret: string, deps: Pick<Deps, 'rpc'>, nowSeconds?: number): Promise<Result> {
  if (!(await validBachsSignature(secret, rawBody, signatureV2, nowSeconds))) return fail(400, 'Invalid signature');
  let event: BachsEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return fail(400, 'Bad JSON');
  }
  const ref = event.data?.reference;
  if (event.type !== 'collection.succeeded' || !ref?.startsWith('sfs_')) return ok({ ignored: true });
  return recordCharge(deps, ref, bachsPaidKobo(event), bachsChannel(event.data?.payment_method_details?.type ?? ''), event.created_at);
}

/** Apply a provider's successful charge. Not ours → acknowledge; database down → 500 so the provider retries. */
async function recordCharge(deps: Pick<Deps, 'rpc'>, reference: string, amountKobo: number, channel: string, paidAt?: string): Promise<Result> {
  try {
    const r = (await deps.rpc('svc_record_gateway_payment', {
      p_reference: reference,
      p_amount_kobo: amountKobo,
      p_channel: channel,
      p_paid_at: paidAt ?? new Date().toISOString(),
    })) as { status: string };
    // A wrong amount is recorded as a mismatch for the owner; retrying won't change it, so acknowledge
    if (r.status === 'mismatch') console.error(`Webhook amount mismatch for ${reference}`);
    return ok(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Unknown payment reference/.test(msg)) {
      console.error(`Webhook not applied: ${msg}`);
      return ok({ applied: false });
    }
    console.error(msg);
    return fail(500, 'Try again');
  }
}
