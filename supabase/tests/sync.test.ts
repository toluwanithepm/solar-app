// End-to-end test of the backend-mode pipeline without the network:
// rows (as PostgREST returns them) → app snapshot → the app's own actions → diff → apply_changes as that user → rows again.
// Run: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

type Mapping = typeof import('../../src/data/remote/mapping');
type Store = typeof import('../../src/data/store');
let mapping: Mapping;
let store: Store;
let sales: typeof import('../../src/data/salesActions');
let ops: typeof import('../../src/data/opsActions');
let settings: typeof import('../../src/data/settingsActions');
let workflows: typeof import('../../src/data/workflows');
let tech: typeof import('../../src/data/techActions');

const dir = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, dir), 'utf8');
let pg: PGlite;

before(async () => {
  pg = await PGlite.create();
  await pg.exec(read('tests/shim.sql'));
  for (const f of readdirSync(new URL('migrations/', dir)).sort()) await pg.exec(read(`migrations/${f}`));
  await pg.exec(read('seed.sql'));
  // The app modules expect a browser; give them the little they use (after PGlite starts, which checks for one)
  Object.assign(globalThis, { window: { location: { origin: 'http://test.local' }, addEventListener() {} } });
  // Run the app's actions in backend mode, as they run against Supabase
  process.env.VITE_SUPABASE_URL = 'http://test.local';
  process.env.VITE_SUPABASE_ANON_KEY = 'test';
  mapping = await import('../../src/data/remote/mapping');
  store = await import('../../src/data/store');
  sales = await import('../../src/data/salesActions');
  ops = await import('../../src/data/opsActions');
  settings = await import('../../src/data/settingsActions');
  workflows = await import('../../src/data/workflows');
  tech = await import('../../src/data/techActions');
});
after(() => pg.close());

// ---------- helpers ----------

type Ctx = { firmId: string; staffId: string; role: 'owner' | 'office' | 'technician' | 'viewer' };

async function signIn(phone: string): Promise<Ctx> {
  const event = { user_id: crypto.randomUUID(), claims: { phone: phone.replace('+', '') } };
  const r = await pg.query<{ out: { claims: Record<string, string> } }>('select public.custom_access_token_hook($1) as out', [event]);
  const c = r.rows[0].out.claims;
  return { firmId: c.firm_id, staffId: c.staff_id, role: c.app_role as Ctx['role'] };
}

async function asUser<T>(ctx: Ctx, fn: () => Promise<T>) {
  const claims = { sub: crypto.randomUUID(), firm_id: ctx.firmId, staff_id: ctx.staffId, app_role: ctx.role };
  await pg.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await pg.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await pg.exec('reset role');
  }
}

/** What the browser loads: every table as JSON rows, the way PostgREST serialises them. */
async function load(ctx: Ctx) {
  return asUser(ctx, async () => {
    const raw: Record<string, Record<string, unknown>[]> = {};
    for (const t of [...mapping.TABLES, ...mapping.READ_ONLY_TABLES]) {
      const r = await pg.query<{ rows: Record<string, unknown>[] }>(`select coalesce(jsonb_agg(to_jsonb(x)), '[]') as rows from public.${t} x`);
      raw[t] = r.rows[0].rows;
    }
    return raw;
  });
}

/** Load as this user into the store, run an app action, and save its changes the way sync.ts does. */
async function runAction(ctx: Ctx, action: () => unknown) {
  const db = mapping.fromRemote(await load(ctx), ctx);
  store.replaceDb(db);
  store.setSession({ userId: ctx.staffId });
  const baseline = mapping.flatten(db, ctx);
  const result = action();
  const changes = mapping.diff(baseline, mapping.flatten(store.getDb(), ctx));
  await asUser(ctx, () => pg.query('select public.apply_changes($1)', [JSON.stringify(changes)]));
  return { result, changes, after: mapping.fromRemote(await load(ctx), ctx) };
}

const OWNER = '+2348031234567';
const OFFICE = '+2348029876543';

// ---------- tests ----------

describe('mapping round trip', () => {
  test('loading and flattening changes nothing', async () => {
    for (const phone of [OWNER, OFFICE, '+2348061112233']) {
      const ctx = await signIn(phone);
      const db = mapping.fromRemote(await load(ctx), ctx);
      const again = mapping.fromRemote(await load(ctx), ctx);
      assert.deepEqual(mapping.diff(mapping.flatten(db, ctx), mapping.flatten(again, ctx)), [], `${ctx.role}: a reload looks like a change`);
    }
  });

  test('flattened rows match the database columns they came from', async () => {
    const ctx = await signIn(OWNER);
    const raw = await load(ctx);
    const flat = mapping.flatten(mapping.fromRemote(raw, ctx), ctx);
    const normalise = (v: unknown) => (v === undefined ? null : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v).toISOString() : v);
    for (const t of mapping.TABLES) {
      const rows = flat.get(t)!;
      for (const r of raw[t]) {
        const mine = rows.get(mapping.keyOf(t, r));
        if (t === 'notification_reads') continue;
        assert.ok(mine, `${t} row ${mapping.keyOf(t, r)} lost in mapping`);
        for (const [col, v] of Object.entries(mine)) {
          assert.deepEqual(normalise(v), normalise(r[col]), `${t}.${col} changed in the round trip`);
        }
      }
    }
  });
});

describe("office actions reach the database (Phase 2)", () => {
  test('log an enquiry and book a site survey', async () => {
    const ctx = await signIn(OFFICE);
    let leadId = '';
    const { after } = await runAction(ctx, () => {
      leadId = sales.createLead({ name: 'Sync Test Bakery', phone: '08051112222', location: 'Yaba', address: '1 Yaba Rd', state: 'Lagos', source: 'Call', propertyType: 'Shop', whatsappConsent: true });
      sales.bookSurvey(leadId);
    });
    const lead = after.leads.find((l) => l.id === leadId)!;
    assert.equal(lead.phone, '08051112222');
    const job = after.jobs.find((j) => j.leadId === leadId)!;
    assert.equal(job.type, 'Site survey');
    assert.match(job.number, /^SJ-\d+$/, 'job number assigned by the database');
  });

  test('build a quote from a survey, edit it and send it', async () => {
    const ctx = await signIn(OFFICE);
    const db = mapping.fromRemote(await load(ctx), ctx);
    const survey = db.surveys.find((s) => s.status === 'submitted')!;
    let quoteId = '';
    await runAction(ctx, () => {
      quoteId = sales.createQuote(survey.leadId, survey.id);
    });
    const { after, changes } = await runAction(ctx, () => {
      const q = structuredClone(store.getDb().quotes.find((x) => x.id === quoteId)!);
      q.options[1].lines[0].qty = 2;
      q.options[1].lines.pop();
      sales.saveQuote(q);
      workflows.sendQuote(quoteId);
    });
    assert.ok(changes.some((c) => c.t === 'quote_lines' && c.op === 'delete'));
    assert.ok(!changes.some((c) => c.t === 'quote_line_costs'), 'office staff never send costs');
    const q = after.quotes.find((x) => x.id === quoteId)!;
    assert.equal(q.status, 'Sent');
    assert.equal(q.options.length, 3);
    assert.equal(q.options[1].lines[0].qty, 2);
    // Phase 3: the database swaps the record id in message links for a customer token
    assert.ok(after.messages.some((m) => m.topic === 'quote' && /\/q\/[0-9a-f]{64}$/.test(m.link ?? '')));
    const lead = after.leads.find((l) => l.id === q.leadId)!;
    assert.equal(lead.stage, 'Quoted');

    // The owner sees margin on the new lines: costs were filled in by the database
    const owner = await signIn(OWNER);
    const ownerView = mapping.fromRemote(await load(owner), owner);
    const lines = ownerView.quotes.find((x) => x.id === quoteId)!.options[1].lines.filter((l) => l.itemId);
    assert.ok(lines.every((l) => l.unitCost > 0));
  });

  test('assign and reschedule a job', async () => {
    const ctx = await signIn(OFFICE);
    const db = mapping.fromRemote(await load(ctx), ctx);
    const job = db.jobs.find((j) => j.status === 'Unscheduled' && j.type === 'Installation')!;
    const tech = db.users.find((u) => u.role === 'technician')!;
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const { after } = await runAction(ctx, () => ops.scheduleJob(job.id, start, 5, [tech.id]));
    const saved = after.jobs.find((j) => j.id === job.id)!;
    assert.equal(saved.status, 'Scheduled');
    assert.deepEqual(saved.assigneeIds, [tech.id]);
    assert.equal(new Date(saved.start!).toISOString(), start);
  });

  test('log a fault ticket, schedule the repair and update the customer', async () => {
    const ctx = await signIn(OFFICE);
    const db = mapping.fromRemote(await load(ctx), ctx);
    const ins = db.installations[0];
    let ticketId = '';
    await runAction(ctx, () => {
      ticketId = ops.createTicket({ leadId: ins.leadId, installationId: ins.id, description: 'Battery not charging', channel: 'Call' })!.id;
    });
    const { after } = await runAction(ctx, () => {
      ops.scheduleRepair(ticketId);
      ops.addTicketUpdate(ticketId, 'Technician booked for tomorrow');
    });
    const t = after.tickets.find((x) => x.id === ticketId)!;
    assert.equal(t.status, 'Scheduled');
    assert.match(t.number, /^T-\d+$/);
    assert.ok(t.updates.some((u) => u.text === 'Technician booked for tomorrow'));
    assert.ok(after.jobs.some((j) => j.ticketId === ticketId && j.type === 'Fault repair'));
  });

  test('record cash as pending, then the owner approves it', async () => {
    const office = await signIn(OFFICE);
    const db = mapping.fromRemote(await load(office), office);
    const inv = db.invoices.find((i) => i.kind === 'Balance' && i.amount > 100_000)!;
    const { after } = await runAction(office, () => sales.recordOfflinePayment(inv.id, 100_000, 'Cash'));
    const pay = after.payments.find((p) => p.invoiceId === inv.id && p.status === 'Pending approval' && p.amount === 100_000)!;
    assert.ok(pay, 'pending payment saved');
    assert.equal(pay.recordedById, office.staffId, 'who recorded it comes from the token');
    assert.match(pay.reference, /^PAY-\d+$/);

    const owner = await signIn(OWNER);
    const { after: approved } = await runAction(owner, () => sales.reviewPayment(pay.id, true));
    const p = approved.payments.find((x) => x.id === pay.id)!;
    assert.equal(p.status, 'Confirmed');
    assert.equal(p.approvedById, owner.staffId);
  });

  test('owner edits a price and its cost; the audit log records both', async () => {
    const owner = await signIn(OWNER);
    const db = mapping.fromRemote(await load(owner), owner);
    const item = db.priceItems[0];
    const { after } = await runAction(owner, () => settings.savePriceItem({ ...item, price: item.price + 1000, cost: item.cost + 500 }));
    const saved = after.priceItems.find((p) => p.id === item.id)!;
    assert.equal(saved.price, item.price + 1000);
    assert.equal(saved.cost, item.cost + 500);
    const entries = after.audit.filter((a) => a.entityId === item.id);
    assert.ok(entries.some((a) => a.summary.endsWith(': price')));
    assert.ok(entries.some((a) => a.summary.endsWith(': cost')));
  });

  test('office staff cannot change prices: the batch is refused', async () => {
    const office = await signIn(OFFICE);
    const db = mapping.fromRemote(await load(office), office);
    const item = db.priceItems[0];
    await assert.rejects(runAction(office, () => settings.savePriceItem({ ...item, price: 1 })), /that you can change/);
  });

  test('sell a maintenance plan: installation and invoice change together', async () => {
    const office = await signIn(OFFICE);
    const db = mapping.fromRemote(await load(office), office);
    const ins = db.installations.find((i) => !i.planId)!;
    const { after } = await runAction(office, () => ops.sellPlan(ins.id, db.plans[0].id));
    assert.equal(after.installations.find((i) => i.id === ins.id)!.planId, db.plans[0].id);
    assert.ok(after.invoices.some((i) => i.leadId === ins.leadId && i.kind === 'Maintenance plan'));
  });
});

describe('technician field work reaches the database (Phase 4)', () => {
  const MUSA = '+2348061112233';
  const KELECHI = '+2348062223344';
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
  const photo = (kind: 'before' | 'after') => ({ id: crypto.randomUUID(), kind, dataUrl: '', storagePath: `test/${kind}.jpg`, bytes: 120_000, takenAt: new Date().toISOString(), gps: { lat: 6.45, lng: 3.47 }, uploaded: true });

  test('a job cannot be completed with work missing; nothing from the batch is kept', async () => {
    const ctx = await signIn(MUSA);
    const db = mapping.fromRemote(await load(ctx), ctx);
    const job = db.jobs.find((j) => j.type === 'Installation' && j.status === 'Scheduled')!;
    await assert.rejects(
      runAction(ctx, () => {
        tech.checkIn(job.id, { lat: 6.45, lng: 3.47 });
        job.checklist.forEach((c) => tech.toggleStep(job.id, c.id));
        tech.completeWithHandover(job.id, { dataUrl: '', name: 'Adaeze Okafor' }, undefined);
      }),
      /before and one after photo/,
    );
    const [row] = await q<{ status: string; check_in_at: string | null }>('select status, check_in_at from jobs where id = $1', [job.id]);
    assert.equal(row.status, 'Scheduled');
    assert.equal(row.check_in_at, null, 'the whole batch rolled back');
  });

  test('a whole installation done offline syncs in one batch and the server finishes it', async () => {
    const ctx = await signIn(MUSA);
    const db = mapping.fromRemote(await load(ctx), ctx);
    const job = db.jobs.find((j) => j.type === 'Installation' && j.status === 'Scheduled')!;
    const plan = db.plans[0];
    const extraItem = db.priceItems.find((p) => p.category === 'accessory')!;
    const slots = tech.serialSlots(job);
    assert.ok(slots.length >= 3);

    const { changes, after } = await runAction(ctx, () => {
      tech.checkIn(job.id, { lat: 6.45, lng: 3.47 });
      job.checklist.forEach((c) => tech.toggleStep(job.id, c.id));
      tech.addJobPhoto(job.id, photo('before'));
      tech.addJobPhoto(job.id, photo('after'));
      slots.forEach((s, i) => tech.saveSerial(job.id, s, `SN-P4-${i}`, 'manual'));
      tech.addExtra(job.id, { description: 'Extra surge kit', qty: 2, itemId: extraItem.id });
      tech.completeWithHandover(job.id, { dataUrl: '', name: 'Adaeze Okafor' }, { lat: 6.45, lng: 3.47 }, plan.id);
    });

    // The phone sent field data only
    const touched = [...new Set(changes.map((c) => c.t))].sort();
    assert.deepEqual(touched, ['job_extras', 'job_serials', 'jobs', 'photos']);

    // …and can see the result
    const done = after.jobs.find((j) => j.id === job.id)!;
    assert.equal(done.status, 'Done');
    assert.ok(done.installationId, 'installation linked');
    const ins = after.installations.find((i) => i.id === done.installationId)!;
    assert.equal(ins.items.length, slots.length);
    assert.equal(ins.planId, plan.id);
    const [crew] = await q<{ n: number }>('select count(*)::int as n from installation_technicians where installation_id = $1 and staff_id = $2', [ins.id, ctx.staffId]);
    assert.equal(crew.n, 1, 'the technician is on the installation record');
    const inverter = ins.items.find((i) => i.category === 'inverter')!;
    const years = Math.round((new Date(inverter.warrantyEndsAt).getTime() - Date.now()) / (365.25 * 86_400_000));
    assert.equal(years, inverter.warrantyYears, 'warranty end date set from the term');

    // Server-side records the technician never wrote
    const invs = await q<{ kind: string; amount: string; due_at: string }>(`select kind::text, amount, due_at from invoices where job_id = $1 order by kind::text`, [job.id]);
    const byKind = Object.fromEntries(invs.map((i) => [i.kind, i]));
    assert.equal(Number(byKind['Extras'].amount), 2 * extraItem.price);
    assert.equal(Number(byKind['Maintenance plan'].amount), plan.price);
    assert.ok(Math.abs(new Date(byKind['Balance'].due_at).getTime() - Date.now()) < 60_000, 'balance falls due at handover');
    const msgs = await q<{ topic: string; link: string | null }>(`select topic, link from messages where created_at > now() - interval '1 minute' order by created_at`);
    const handover = msgs.find((m) => m.topic === 'handover')!;
    assert.match(handover.link!, /\/handover\/[0-9a-f]{64}$/, 'handover link is a customer token');
    assert.equal(msgs.filter((m) => m.topic === 'payment-link').length, 2, 'plan and balance pay links');
    const [note] = await q<{ n: number }>(`select count(*)::int as n from notifications where text like '%completed' and created_at > now() - interval '1 minute'`);
    assert.equal(note.n, 1);
  });

  test('completing again changes nothing', async () => {
    const ctx = await signIn(MUSA);
    const before = await q<{ n: number }>('select count(*)::int as n from installations');
    const db = mapping.fromRemote(await load(ctx), ctx);
    const job = db.jobs.find((j) => j.type === 'Installation' && j.status === 'Done' && j.serials.length > 0)!;
    await runAction(ctx, () => tech.toggleStep(job.id, job.checklist[0].id));
    assert.equal((await q<{ n: number }>('select count(*)::int as n from installations'))[0].n, before[0].n);
  });

  test('a submitted survey moves the lead on, closes the survey job and tells the office', async () => {
    const ctx = await signIn(KELECHI);
    const db = mapping.fromRemote(await load(ctx), ctx);
    const job = db.jobs.find((j) => j.type === 'Site survey' && j.status === 'Scheduled')!;
    let surveyId = '';
    const { changes } = await runAction(ctx, () => {
      surveyId = tech.startSurvey(ctx.staffId, { jobId: job.id })!;
      tech.addAppliance(surveyId, { name: 'Fridge', watts: 150, hours: 12, qty: 2 });
      tech.submitSurvey(surveyId);
    });
    assert.ok(!changes.some((c) => c.t === 'leads'), 'the phone does not edit the lead');
    const [lead] = await q<{ stage: string; name: string }>('select stage, name from leads where id = $1', [job.leadId]);
    assert.equal(lead.stage, 'Surveyed');
    const [j] = await q<{ status: string }>('select status from jobs where id = $1', [job.id]);
    assert.equal(j.status, 'Done');
    const [s] = await q<{ submitted_at: string | null; peak_w: string }>('select submitted_at, peak_w from surveys where id = $1', [surveyId]);
    assert.ok(s.submitted_at);
    assert.equal(Number(s.peak_w), 300);
    const [n] = await q<{ n: number }>(`select count(*)::int as n from notifications where text = $1`, [`Site survey for ${lead.name} is ready to quote`]);
    assert.equal(n.n, 1);
  });

  test('a new lead logged on site and surveyed by the technician', async () => {
    const ctx = await signIn(KELECHI);
    let leadId = '';
    let surveyId = '';
    await runAction(ctx, () => {
      leadId = tech.createQuickLead({ name: 'Roadside Tailor', phone: '08055550000', address: '2 Market Road, Ojota', state: 'Lagos', propertyType: 'Shop', whatsappConsent: true });
      surveyId = tech.startSurvey(ctx.staffId, { leadId })!;
      tech.addAppliance(surveyId, { name: 'Sewing machine', watts: 250, hours: 8, qty: 3 });
      tech.submitSurvey(surveyId);
    });
    const [lead] = await q<{ stage: string; created_by: string }>('select stage, created_by from leads where id = $1', [leadId]);
    assert.equal(lead.stage, 'Surveyed');
    assert.equal(lead.created_by, ctx.staffId);
  });
});

describe('offline queue: units of work (Phase 4)', () => {
  test('after working offline, a refused job is set aside and the other job still saves', async () => {
    const ctx = await signIn('+2348061112233');
    // A second job for Musa, created by the office while he was out
    const lead = (await pg.query<{ id: string }>(`select id from leads where name = 'Grace Clinic'`)).rows[0];
    const extraJob = crypto.randomUUID();
    await pg.query(
      `insert into jobs (id, firm_id, lead_id, type, status, start_at, checklist) values ($1, $2, $3, 'Maintenance', 'Scheduled', now(), '[{"id":"m1","label":"Clean panels","hint":"Required","required":true,"done":false}]')`,
      [extraJob, ctx.firmId, lead.id],
    );
    await pg.query(`insert into job_assignees (job_id, staff_id, firm_id) values ($1, $2, $3)`, [extraJob, ctx.staffId, ctx.firmId]);

    const db = mapping.fromRemote(await load(ctx), ctx);
    const good = db.jobs.find((j) => j.type === 'Maintenance' && j.status === 'Scheduled' && j.id !== extraJob)!;
    store.replaceDb(db);
    store.setSession({ userId: ctx.staffId });
    const baseline = mapping.flatten(db, ctx);
    const pic = (kind: 'before' | 'after') => ({ id: crypto.randomUUID(), kind, dataUrl: '', storagePath: `test/${kind}.jpg`, bytes: 90_000, takenAt: new Date().toISOString(), uploaded: true });

    // Offline: one job done properly, one marked done with nothing recorded
    tech.checkIn(good.id);
    good.checklist.forEach((c) => tech.toggleStep(good.id, c.id));
    tech.addJobPhoto(good.id, pic('before'));
    tech.addJobPhoto(good.id, pic('after'));
    tech.completeWithHandover(good.id, { dataUrl: '', name: 'Tunde Adeyemi' }, undefined);
    tech.checkIn(extraJob);
    tech.toggleStep(extraJob, 'm1');
    tech.completeWithHandover(extraJob, { dataUrl: '', name: 'Grace Clinic' }, undefined);

    // Back online: send unit by unit, the way sync.ts does
    const target = mapping.flatten(store.getDb(), ctx);
    const units = mapping.groupOps(mapping.diff(baseline, target), baseline, target);
    assert.deepEqual(units.map((u) => u.unit).sort(), [`job:${extraJob}`, `job:${good.id}`].sort());
    const results: Record<string, string> = {};
    let synced = baseline;
    for (const u of units) {
      try {
        await asUser(ctx, () => pg.query('select public.apply_changes($1)', [JSON.stringify(u.ops)]));
        results[u.unit] = 'saved';
        synced = mapping.applyOps(synced, u.ops);
      } catch (e) {
        results[u.unit] = (e as Error).message;
      }
    }
    assert.equal(results[`job:${good.id}`], 'saved');
    assert.match(results[`job:${extraJob}`], /before and one after photo/);
    const rows = (await pg.query<{ id: string; status: string }>('select id, status::text from jobs where id = any($1)', [[good.id, extraJob]])).rows;
    assert.equal(rows.find((r) => r.id === good.id)!.status, 'Done');
    assert.equal(rows.find((r) => r.id === extraJob)!.status, 'Scheduled');
    // What is still unsent is exactly the refused job
    const left = mapping.groupOps(mapping.diff(synced, target), synced, target);
    assert.deepEqual(left.map((u) => u.unit), [`job:${extraJob}`]);
  });

  test('work that depends on a new lead goes after it', async () => {
    const ctx = await signIn('+2348062223344');
    const db = mapping.fromRemote(await load(ctx), ctx);
    store.replaceDb(db);
    store.setSession({ userId: ctx.staffId });
    const baseline = mapping.flatten(db, ctx);
    const leadId = tech.createQuickLead({ name: 'Order Test Kiosk', phone: '08055550001', address: '9 Test Close, Ikeja', state: 'Lagos', propertyType: 'Shop', whatsappConsent: false });
    const surveyId = tech.startSurvey(ctx.staffId, { leadId })!;
    const target = mapping.flatten(store.getDb(), ctx);
    const units = mapping.groupOps(mapping.diff(baseline, target), baseline, target);
    assert.deepEqual(units.map((u) => u.unit), ['other', `survey:${surveyId}`]);
    for (const u of units) await asUser(ctx, () => pg.query('select public.apply_changes($1)', [JSON.stringify(u.ops)]));
    assert.equal((await pg.query('select 1 from surveys where id = $1', [surveyId])).rows.length, 1);
  });
});
