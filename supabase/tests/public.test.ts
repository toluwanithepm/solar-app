// Phase 3: customer links, Paystack payments and subscription billing, through the same handlers the Edge Functions run.
// Paystack is faked; webhooks are signed with a test secret exactly as Paystack signs them.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import type { Deps } from '../functions/_shared/handlers.ts';
import { handleBachsWebhook, handlePublic, handleWebhook } from '../functions/_shared/handlers.ts';
import { bachsProvider, signBachs } from '../functions/_shared/bachs.ts';
import { paystackProvider, signBody } from '../functions/_shared/paystack.ts';
import { toKobo, type Charge, type PaymentProvider, type ProviderName } from '../functions/_shared/providers.ts';

const dir = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, dir), 'utf8');
const SECRET = 'sk_test_fake_secret';
let pg: PGlite;

// ---------- fakes ----------

type Started = { provider: ProviderName; reference: string; amountKobo: number; callbackUrl: string; description: string };
const initialized: Started[] = [];
/** What each fake provider reports when asked about a charge, keyed by our reference */
const charges = new Map<string, Charge>();
let active: ProviderName = 'paystack';
const fakeProvider = (name: ProviderName): PaymentProvider => ({
  name,
  async start(p) {
    initialized.push({ provider: name, reference: p.reference, amountKobo: toKobo(p.amountNaira), callbackUrl: p.returnUrl, description: p.description });
    return { authorizationUrl: `https://checkout.${name}.test/${p.reference}`, providerRef: name === 'bachs' ? `chk_${p.reference.slice(4, 12)}` : p.reference };
  },
  async check(ref, providerRef) {
    if (name === 'bachs' && !providerRef?.startsWith('chk_')) throw new Error('Bachs checks by checkout id');
    return charges.get(ref) ?? { status: 'pending', amountKobo: 0, channel: '', paidAt: null };
  },
});
const fakes = { paystack: fakeProvider('paystack'), bachs: fakeProvider('bachs') };
const uploads: { bucket: string; path: string; bytes: number }[] = [];

async function callFn(fn: string, args: Record<string, unknown>) {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
  try {
    return (await pg.query<{ r: unknown }>(sql, names.map((n) => args[n]))).rows[0]?.r ?? null;
  } catch (e) {
    throw new Error((e as Error).message);
  }
}

let deps: Deps;

async function claimsFor(phone: string) {
  const r = await pg.query<{ c: { claims: Record<string, string> } }>('select public.custom_access_token_hook($1) as c', [{ user_id: crypto.randomUUID(), claims: { phone } }]);
  return { sub: crypto.randomUUID(), ...r.rows[0].c.claims };
}
async function as<T>(claims: Record<string, unknown> | null, fn: () => Promise<T>) {
  await pg.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims ?? {})]);
  await pg.exec(claims ? 'set role authenticated' : 'set role anon');
  try {
    return await fn();
  } finally {
    await pg.exec('reset role');
    await pg.query(`select set_config('request.jwt.claims', '', false)`);
  }
}
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0];
const OWNER = '2348031234567';
const OFFICE = '2348029876543';

before(async () => {
  pg = await PGlite.create();
  await pg.exec(read('tests/shim.sql'));
  for (const f of readdirSync(new URL('migrations/', dir)).sort()) await pg.exec(read(`migrations/${f}`));
  await pg.exec(read('seed.sql'));
  deps = {
    rpc: callFn,
    userRpc: async (token, fn, args = {}) => as(JSON.parse(token), () => callFn(fn, args)),
    signUrls: async (bucket, paths) => Object.fromEntries(paths.map((p) => [p, `https://signed.test/${bucket}/${p}`])),
    publicFileUrl: (bucket, path) => `https://public.test/${bucket}/${path}`,
    upload: async (bucket, path, bytes) => void uploads.push({ bucket, path, bytes: bytes.length }),
    provider: (name) => fakes[name ?? active],
    get activeProvider() {
      return active;
    },
    appUrl: 'https://app.test',
  };
});
after(() => pg.close());

const share = async (claims: Record<string, unknown>, kind: string, target: string) =>
  as(claims, async () => (await one<{ t: string }>('select public.share_link($1, $2) as t', [kind, target])).t);

async function webhook(reference: string, amountKobo: number, channel = 'card', secret = SECRET) {
  const raw = JSON.stringify({ event: 'charge.success', data: { reference, amount: amountKobo, channel, status: 'success', paid_at: new Date().toISOString() } });
  return handleWebhook(raw, await signBody(secret, raw), SECRET, deps);
}

// ---------- tests ----------

describe('customer links', () => {
  test('staff get a token link; messages are rewritten to use it', async () => {
    const office = await claimsFor(OFFICE);
    const q = await one<{ id: string }>(`select id from quotes where status = 'Sent' limit 1`);
    const token = await share(office, 'quote', q.id);
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(await share(office, 'quote', q.id), token, 'the same record keeps one token');
    await as(office, () =>
      pg.query('select public.apply_changes($1)', [
        JSON.stringify([{ t: 'messages', op: 'insert', row: { to_phone: '+2348050000000', text: `Your quote: https://app.test/q/${q.id} thanks`, link: `https://app.test/q/${q.id}`, topic: 'quote' } }]),
      ]),
    );
    const m = await one<{ link: string; text: string }>(`select link, text from messages order by created_at desc limit 1`);
    assert.equal(m.link, `https://app.test/q/${token}`);
    assert.ok(m.text.includes(`/q/${token}`) && !m.text.includes(q.id), 'record ids never reach customers');
  });

  test("staff can't share another firm's records", async () => {
    const office = await claimsFor(OFFICE);
    await assert.rejects(share(office, 'quote', crypto.randomUUID()), /no such quote/);
  });

  test('a quote link shows the quote without costs, other customers or subscription details', async () => {
    const q = await one<{ id: string; lead_id: string }>(`select id, lead_id from quotes where status = 'Sent' limit 1`);
    const token = await share(await claimsFor(OFFICE), 'quote', q.id);
    const r = await handlePublic({ action: 'view', token }, null, deps);
    assert.equal(r.status, 200);
    const v = r.body as { kind: string; targetId: string; tables: Record<string, Record<string, unknown>[]> };
    assert.equal(v.kind, 'quote');
    assert.equal(v.targetId, q.id);
    assert.ok(v.tables.quote_lines.length > 0);
    for (const t of ['price_item_costs', 'quote_line_costs', 'audit_log', 'staff', 'jobs']) assert.equal(v.tables[t], undefined, `${t} leaked`);
    assert.deepEqual(v.tables.leads.map((l) => l.id), [q.lead_id]);
    assert.equal(v.tables.firms[0].subscription_status, undefined);
    assert.equal(v.tables.firms[0].enquiry_token, undefined);
  });

  test('bad, unknown and revoked tokens get nothing', async () => {
    assert.equal((await handlePublic({ action: 'view', token: 'nope' }, null, deps)).status, 404);
    assert.equal((await handlePublic({ action: 'view', token: 'a'.repeat(64) }, null, deps)).status, 404);
    const q = await one<{ id: string }>(`select id from quotes limit 1`);
    const token = await share(await claimsFor(OFFICE), 'quote', q.id);
    await pg.query(`update public_links set revoked_at = now() where token = $1`, [token]);
    assert.equal((await handlePublic({ action: 'view', token }, null, deps)).status, 404);
  });

  test('anonymous and signed-in users cannot call the service functions directly', async () => {
    await as(null, () => assert.rejects(pg.query(`select public.svc_public_view('x')`), /permission denied/));
    await as(await claimsFor(OWNER), () => assert.rejects(pg.query(`select public.svc_record_gateway_payment('x', 1, 'card')`), /permission denied/));
  });
});

describe('quote deposit through Paystack (E4-4)', () => {
  let token = '';
  let quoteId = '';
  let optionId = '';
  let reference = '';

  before(async () => {
    const q = await one<{ id: string }>(`select id from quotes where status = 'Sent' order by created_at limit 1`);
    quoteId = q.id;
    optionId = (await one<{ id: string }>(`select id from quote_options where quote_id = $1 and position = 1`, [quoteId])).id;
    token = await share(await claimsFor(OFFICE), 'quote', quoteId);
  });

  test('the server works out the deposit; the browser cannot set the amount', async () => {
    const r = await handlePublic({ action: 'pay', token, optionId, amount: 1 } as never, null, deps);
    assert.equal(r.status, 200);
    const pay = r.body as { authorizationUrl: string; reference: string };
    reference = pay.reference;
    const expected = await one<{ v: string }>(
      `select round(sum(l.qty * l.unit_price) * q.deposit_pct / 100) * 100 as v from quote_lines l join quote_options o on o.id = l.option_id join quotes q on q.id = o.quote_id where o.id = $1 group by q.deposit_pct`,
      [optionId],
    );
    const init = initialized.at(-1)!;
    assert.equal(init.amountKobo, Number(expected.v));
    assert.equal(init.callbackUrl, `https://app.test/q/${token}`);
  });

  test('a webhook with a bad signature is refused', async () => {
    const init = initialized.at(-1)!;
    assert.equal((await webhook(reference, init.amountKobo, 'card', 'sk_wrong')).status, 401);
    assert.equal((await one<{ status: string }>(`select status from quotes where id = $1`, [quoteId])).status, 'Sent');
  });

  test('a paid deposit accepts the quote and sets up the job and payment schedule', async () => {
    const init = initialized.at(-1)!;
    const r = await webhook(reference, init.amountKobo, 'bank_transfer');
    assert.equal(r.status, 200);
    const q = await one<{ status: string; selected_option_id: string; lead_id: string }>(`select status, selected_option_id, lead_id from quotes where id = $1`, [quoteId]);
    assert.equal(q.status, 'Accepted');
    assert.equal(q.selected_option_id, optionId);
    assert.equal((await one<{ stage: string }>(`select stage from leads where id = $1`, [q.lead_id])).stage, 'Won');
    const job = await one<{ number: string; status: string; n: number; c: number }>(
      `select number, status, jsonb_array_length(equipment) as n, jsonb_array_length(checklist) as c from jobs where quote_id = $1`,
      [quoteId],
    );
    assert.match(job.number, /^SJ-\d+$/);
    assert.equal(job.status, 'Unscheduled');
    assert.ok(job.n > 0 && job.c > 0, 'equipment and checklist copied');
    const invs = (await pg.query<{ kind: string; amount: string }>(`select kind, amount from invoices where quote_id = $1 order by kind::text`, [quoteId])).rows;
    assert.deepEqual(invs.map((i) => i.kind), ['Balance', 'Deposit']);
    const pay = await one<{ method: string; status: string; gateway_reference: string; amount: string }>(`select * from payments where gateway_reference = $1`, [reference]);
    assert.equal(pay.status, 'Confirmed');
    assert.equal(pay.method, 'Transfer');
    assert.equal(Number(pay.amount) * 100, init.amountKobo);
    const receipt = await one<{ link: string }>(`select link from messages where topic = 'receipt' order by created_at desc limit 1`);
    assert.match(receipt.link, /\/pay\/[0-9a-f]{64}$/);
  });

  test('a repeated webhook changes nothing, and the quote cannot be paid again', async () => {
    const init = initialized.at(-1)!;
    const before = await one<{ n: number }>(`select count(*)::int as n from payments`);
    const r = await webhook(reference, init.amountKobo);
    assert.equal((r.body as { duplicate?: boolean }).duplicate, true);
    assert.equal((await one<{ n: number }>(`select count(*)::int as n from payments`)).n, before.n);
    const again = await handlePublic({ action: 'pay', token, optionId }, null, deps);
    assert.equal(again.status, 400);
    assert.match((again.body as { error: string }).error, /already been accepted/);
  });

  test('the customer can then see their accepted quote and pay the balance link', async () => {
    const v = (await handlePublic({ action: 'view', token }, null, deps)).body as { tables: Record<string, Record<string, unknown>[]>; links: Record<string, string> };
    assert.equal(v.tables.quotes[0].status, 'Accepted');
    const balance = v.tables.invoices.find((i) => i.kind === 'Balance')!;
    assert.match(v.links[`invoice:${balance.id}`], /^[0-9a-f]{64}$/);
  });

  test("draft quotes can't be paid", async () => {
    const d = await one<{ id: string }>(`select id from quotes where status = 'Draft' limit 1`);
    const t = await share(await claimsFor(OFFICE), 'quote', d.id);
    const o = await one<{ id: string }>(`select id from quote_options where quote_id = $1 limit 1`, [d.id]);
    assert.equal((await handlePublic({ action: 'pay', token: t, optionId: o.id }, null, deps)).status, 400);
  });
});

describe('invoice payment and the return-page check (E9-2)', () => {
  test('wrong amounts are not applied; the right one settles the balance', async () => {
    const inv = await one<{ id: string }>(
      `select i.id from invoices i where i.kind = 'Balance' and i.amount > coalesce((select sum(amount) from payments p where p.invoice_id = i.id and p.status = 'Confirmed'), 0) limit 1`,
    );
    const token = await share(await claimsFor(OFFICE), 'invoice', inv.id);
    const pay = (await handlePublic({ action: 'pay', token }, null, deps)).body as { reference: string };
    const init = initialized.at(-1)!;

    const bad = await webhook(pay.reference, init.amountKobo - 100);
    assert.equal(bad.status, 200, 'acknowledged so Paystack stops retrying');
    assert.equal((await one<{ status: string }>(`select status from payment_intents where reference = $1`, [pay.reference])).status, 'mismatch');

    const pay2 = (await handlePublic({ action: 'pay', token }, null, deps)).body as { reference: string };
    charges.set(pay2.reference, { status: 'success', amountKobo: initialized.at(-1)!.amountKobo, channel: 'ussd', paidAt: new Date().toISOString() });
    const v = await handlePublic({ action: 'verify', reference: pay2.reference }, null, deps);
    assert.deepEqual(v.body, { status: 'success', kind: 'invoice', targetId: inv.id });
    const bal = await one<{ b: string }>(`select i.amount - coalesce(sum(p.amount), 0) as b from invoices i left join payments p on p.invoice_id = i.id and p.status = 'Confirmed' where i.id = $1 group by i.amount`, [inv.id]);
    assert.equal(Number(bal.b), 0);
    assert.equal((await one<{ method: string }>(`select method from payments where gateway_reference = $1`, [pay2.reference])).method, 'USSD');
    assert.equal((await handlePublic({ action: 'pay', token }, null, deps)).status, 400, 'nothing left to pay');
  });

  test('an unfinished payment reports pending', async () => {
    const inv = await one<{ id: string }>(`select i.id from invoices i where i.kind = 'Deposit' limit 1`);
    await pg.query(`insert into payment_intents (reference, firm_id, kind, target_id, amount) select 'sfs_' || replace(gen_random_uuid()::text, '-', ''), firm_id, 'invoice', id, 10 from invoices where id = $1`, [inv.id]);
    const ref = (await one<{ reference: string }>(`select reference from payment_intents where target_id = $1 order by created_at desc limit 1`, [inv.id])).reference;
    assert.equal(((await handlePublic({ action: 'verify', reference: ref }, null, deps)).body as { status: string }).status, 'pending');
  });
});

describe('subscription (E11-2)', () => {
  test('only the owner pays; seats are active technicians; payment activates the plan', async () => {
    const office = await claimsFor(OFFICE);
    assert.equal((await handlePublic({ action: 'pay-subscription' }, `Bearer ${JSON.stringify(office)}`, deps)).status, 400);
    const owner = await claimsFor(OWNER);
    const r = await handlePublic({ action: 'pay-subscription' }, `Bearer ${JSON.stringify(owner)}`, deps);
    assert.equal(r.status, 200);
    const techs = (await one<{ n: number }>(`select count(*)::int as n from staff where role = 'technician' and active`)).n;
    const init = initialized.at(-1)!;
    assert.equal(init.amountKobo, techs * 7500 * 100);
    assert.equal(init.callbackUrl, 'https://app.test/office/settings/billing');
    await webhook(init.reference, init.amountKobo);
    const f = await one<{ subscription_status: string; subscription_seats: number; paid_until: Date }>(`select * from firms where id = $1`, [owner.firm_id]);
    assert.equal(f.subscription_status, 'active');
    assert.equal(f.subscription_seats, techs);
    assert.ok(new Date(f.paid_until).getTime() > Date.now() + 27 * 86_400_000);
  });
});

describe('public enquiry form (E2-3) and fault reports (E8-3)', () => {
  test('the enquiry form creates a web lead and tells the office', async () => {
    const f = await one<{ enquiry_token: string; id: string }>(`select id, enquiry_token from firms where name = 'BrightPath Solar'`);
    const brand = await handlePublic({ action: 'firm', firmToken: f.enquiry_token }, null, deps);
    assert.equal(((brand.body as { tables: { firms: { name: string }[] } }).tables.firms[0]).name, 'BrightPath Solar');
    const r = await handlePublic({ action: 'enquire', firmToken: f.enquiry_token, name: 'Web Visitor', phone: '0809 111 2222', location: 'Ajah', propertyType: 'Home', whatsappConsent: true }, null, deps);
    assert.deepEqual(r.body, { ok: true, firmName: 'BrightPath Solar' });
    const lead = await one<{ source: string; phone: string; stage: string }>(`select * from leads where name = 'Web Visitor'`);
    assert.deepEqual([lead.source, lead.phone, lead.stage], ['Web form', '+2348091112222', 'New']);
    assert.equal((await handlePublic({ action: 'enquire', firmToken: 'nope', name: 'X', phone: '08091112222', location: '', propertyType: 'Home', whatsappConsent: false }, null, deps)).status, 404);
    assert.equal((await handlePublic({ action: 'enquire', firmToken: f.enquiry_token, name: 'Y', phone: '123', location: '', propertyType: 'Home', whatsappConsent: false }, null, deps)).status, 400);
  });

  test('a fault report creates a ticket with up to 3 photos', async () => {
    const ins = await one<{ id: string }>(`select id from installations limit 1`);
    const token = await share(await claimsFor(OFFICE), 'fault_report', ins.id);
    const r = await handlePublic({ action: 'report', token, description: 'Inverter beeping every few minutes' }, null, deps);
    assert.equal(r.status, 200);
    const { ticketId, number } = r.body as { ticketId: string; number: string };
    assert.match(number, /^T-\d+$/);
    const jpeg = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake jpeg bytes')]).toString('base64')}`;
    for (let i = 0; i < 3; i++) {
      assert.equal((await handlePublic({ action: 'report-photo', token, ticketId, dataUrl: jpeg, takenAt: new Date().toISOString() }, null, deps)).status, 200);
    }
    assert.equal((await handlePublic({ action: 'report-photo', token, ticketId, dataUrl: jpeg, takenAt: new Date().toISOString() }, null, deps)).status, 400);
    assert.equal(uploads.filter((u) => u.path.includes(ticketId)).length, 3);
    const v = (await handlePublic({ action: 'view', token }, null, deps)).body as { tables: Record<string, Record<string, unknown>[]>; files: Record<string, string> };
    assert.ok(v.tables.tickets.some((t) => t.id === ticketId));
    assert.equal(Object.keys(v.files).filter((k) => k.includes(ticketId)).length, 3, 'photos come back as signed URLs');
    const ack = await one<{ link: string; text: string }>(`select link, text from messages where topic = 'ticket' order by created_at desc limit 1`);
    assert.equal(ack.link, `http://localhost:5173/report/${token}`);
    assert.ok(ack.text.includes(number));
  });

  test('a fault link cannot add photos to another installation’s ticket', async () => {
    const [a, b] = (await pg.query<{ id: string }>(`select id from installations order by id limit 2`)).rows;
    const tokenA = await share(await claimsFor(OFFICE), 'fault_report', a.id);
    const tokenB = await share(await claimsFor(OFFICE), 'fault_report', b.id);
    const t = (await handlePublic({ action: 'report', token: tokenB, description: 'Panel cracked after storm' }, null, deps)).body as { ticketId: string };
    const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x78]).toString('base64')}`;
    assert.equal((await handlePublic({ action: 'report-photo', token: tokenA, ticketId: t.ticketId, dataUrl: jpeg, takenAt: new Date().toISOString() }, null, deps)).status, 404);
  });
});

describe('Bachs as a second provider', () => {
  const BACHS_SECRET = 'whsec_test_bachs';
  const bachsHook = async (body: object, opts: { secret?: string; t?: number } = {}) => {
    const raw = JSON.stringify(body);
    return handleBachsWebhook(raw, await signBachs(opts.secret ?? BACHS_SECRET, raw, opts.t), BACHS_SECRET, deps);
  };
  const succeeded = (reference: string, amount: string, extra: Record<string, unknown> = {}) => ({
    id: 'evt_' + crypto.randomUUID().slice(0, 8),
    type: 'collection.succeeded',
    created_at: new Date().toISOString(),
    data: { reference, status: 'SUCCEEDED', amount, currency: 'NGN', fee_bearer: 'merchant', processing_fee: '30.00', payment_method_details: { type: 'bank_transfer' }, ...extra },
  });
  const unpaidInvoice = async () =>
    (await one<{ id: string }>(
      `select i.id from invoices i where i.amount > coalesce((select sum(amount) from payments p where p.invoice_id = i.id and p.status = 'Confirmed'), 0)
         and not exists (select 1 from payment_intents pi where pi.target_id = i.id) order by i.amount desc limit 1`,
    )).id;

  test('switching the provider sends new payments to Bachs and pages name it', async () => {
    active = 'bachs';
    try {
      const inv = await unpaidInvoice();
      const token = await share(await claimsFor(OFFICE), 'invoice', inv);
      const view = (await handlePublic({ action: 'view', token }, null, deps)).body as { paymentProvider: string };
      assert.equal(view.paymentProvider, 'bachs');
      const pay = (await handlePublic({ action: 'pay', token }, null, deps)).body as { authorizationUrl: string; reference: string };
      assert.match(pay.authorizationUrl, /checkout\.bachs\.test/);
      const intent = await one<{ provider: string; provider_ref: string }>(`select provider, provider_ref from payment_intents where reference = $1`, [pay.reference]);
      assert.equal(intent.provider, 'bachs');
      assert.match(intent.provider_ref, /^chk_/);
    } finally {
      active = 'paystack';
    }
  });

  test('a signed collection.succeeded settles the payment; bad, stale or foreign events are not applied', async () => {
    active = 'bachs';
    const inv = await unpaidInvoice();
    const token = await share(await claimsFor(OFFICE), 'invoice', inv);
    const pay = (await handlePublic({ action: 'pay', token }, null, deps)).body as { reference: string };
    active = 'paystack';
    const amount = (initialized.at(-1)!.amountKobo / 100).toFixed(2);

    assert.equal((await bachsHook(succeeded(pay.reference, amount), { secret: 'whsec_wrong' })).status, 400, 'wrong secret');
    assert.equal((await bachsHook(succeeded(pay.reference, amount), { t: Math.floor(Date.now() / 1000) - 600 })).status, 400, 'older than 5 minutes');
    assert.deepEqual((await bachsHook({ ...succeeded(pay.reference, amount), type: 'checkout.completed' })).body, { ignored: true });
    assert.deepEqual((await bachsHook(succeeded('ORD-elsewhere', amount))).body, { ignored: true });

    const r = await bachsHook(succeeded(pay.reference, amount));
    assert.equal((r.body as { status: string }).status, 'success');
    const p = await one<{ method: string; gateway_reference: string }>(`select method, gateway_reference from payments where gateway_reference = $1`, [pay.reference]);
    assert.equal(p.method, 'Transfer');
    assert.equal(((await bachsHook(succeeded(pay.reference, amount))).body as { duplicate?: boolean }).duplicate, true, 'at-least-once delivery is safe');
  });

  test('a fee the customer carried, or an overpayment, still applies the amount that was due', async () => {
    for (const variant of ['customer-fee', 'overpaid'] as const) {
      active = 'bachs';
      const inv = await unpaidInvoice();
      const token = await share(await claimsFor(OFFICE), 'invoice', inv);
      const pay = (await handlePublic({ action: 'pay', token }, null, deps)).body as { reference: string };
      active = 'paystack';
      const due = initialized.at(-1)!.amountKobo / 100;
      const ev =
        variant === 'customer-fee'
          ? succeeded(pay.reference, (due + 150).toFixed(2), { fee_bearer: 'customer', processing_fee: '150.00', payment_method_details: { type: 'card' } })
          : succeeded(pay.reference, (due + 5000).toFixed(2), { status: 'OVERPAID', expected_amount: due.toFixed(2), received_amount: (due + 5000).toFixed(2) });
      assert.equal(((await bachsHook(ev)).body as { status: string }).status, 'success', variant);
    }
  });

  test('a payment started on Bachs is checked with Bachs after switching back to Paystack', async () => {
    active = 'bachs';
    const inv = await unpaidInvoice();
    const token = await share(await claimsFor(OFFICE), 'invoice', inv);
    const pay = (await handlePublic({ action: 'pay', token }, null, deps)).body as { reference: string };
    active = 'paystack';
    charges.set(pay.reference, { status: 'success', amountKobo: initialized.at(-1)!.amountKobo, channel: 'card', paidAt: new Date().toISOString() });
    const v = await handlePublic({ action: 'verify', reference: pay.reference }, null, deps);
    assert.equal((v.body as { status: string }).status, 'success');
    assert.equal((await one<{ method: string }>(`select method from payments where gateway_reference = $1`, [pay.reference])).method, 'Card');
  });
});

describe('provider clients (HTTP shape)', () => {
  const fakeFetch = (reply: unknown, seen: { url: string; init?: RequestInit }[]) =>
    (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
  const params = { reference: 'sfs_' + 'a'.repeat(32), amountNaira: 1502500, description: 'Deposit for quote Q-2318', returnUrl: 'https://app.test/q/tok', customerName: 'Bello Pharmacy', customerPhone: '+2348051230002', metadata: { kind: 'quote' } };

  test('Paystack: amount in kobo, our reference, NGN, USSD offered', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const ps = paystackProvider('sk_test_x', fakeFetch({ status: true, data: { authorization_url: 'https://checkout.paystack.com/abc', reference: params.reference } }, seen));
    const r = await ps.start(params);
    const body = JSON.parse(String(seen[0].init!.body));
    assert.equal(seen[0].url, 'https://api.paystack.co/transaction/initialize');
    assert.equal(body.amount, 150250000);
    assert.equal(body.reference, params.reference);
    assert.equal(body.currency, 'NGN');
    assert.ok(body.channels.includes('ussd'));
    assert.match(body.email, /@example\.com$/);
    assert.equal(r.authorizationUrl, 'https://checkout.paystack.com/abc');
  });

  test('Bachs: sandbox key uses the sandbox API, NGN decimal amount, our reference on return', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const b = bachsProvider('sk_sandbox_x', fakeFetch({ id: 'chk_123', checkout_url: 'https://checkout.bachs.io/c/xyz' }, seen));
    const r = await b.start(params);
    const body = JSON.parse(String(seen[0].init!.body));
    assert.equal(seen[0].url, 'https://sandbox-api.bachs.io/v1/checkout-sessions');
    assert.deepEqual(body.pricing, { currency: 'NGN', amount: '1502500.00' });
    assert.deepEqual(body.payment_method_types, ['NGN_CARD', 'NGN_BANK_TRANSFER']);
    assert.equal(body.reference, params.reference);
    assert.equal(body.success_url, `https://app.test/q/tok?reference=${params.reference}`);
    assert.equal(body.customer, undefined, 'the hosted page asks for name and email');
    assert.deepEqual(r, { authorizationUrl: 'https://checkout.bachs.io/c/xyz', providerRef: 'chk_123' });
    assert.equal(bachsProvider('sk_live_x', fakeFetch({}, [])).name, 'bachs');
  });

  test('Bachs: a completed checkout reads as paid', async () => {
    const b = bachsProvider('sk_sandbox_x', fakeFetch({ id: 'chk_123', status: 'completed', payment_status: 'succeeded', amount: '1502500.00', currency: 'NGN', payment_method: 'NGN_BANK_TRANSFER' }, []));
    assert.deepEqual(await b.check('sfs_x', 'chk_123'), { status: 'success', amountKobo: 150250000, channel: 'bank_transfer', paidAt: null });
  });
});

test('an unknown payment reference is a clear 400, not a server error', async () => {
  const r = await handlePublic({ action: 'verify', reference: 'sfs_' + '0'.repeat(32) }, null, deps);
  assert.equal(r.status, 400);
  assert.match((r.body as { error: string }).error, /Unknown payment reference/);
});
