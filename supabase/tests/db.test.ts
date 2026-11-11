// Database tests: migrations + seed on PGlite (Postgres in WebAssembly), then row-level security checked role by role.
// Run: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

const dir = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, dir), 'utf8');

let db: PGlite;

before(async () => {
  db = await PGlite.create();
  await db.exec(read('tests/shim.sql'));
  for (const f of readdirSync(new URL('migrations/', dir)).sort()) await db.exec(read(`migrations/${f}`));
  await db.exec(read('seed.sql'));
});
after(() => db.close());

// ---------- helpers ----------

type Claims = Record<string, unknown>;

/** Claims the login hook would put in the token for this phone (and optional auth user id). */
async function claimsFor(phone: string, userId = crypto.randomUUID()): Promise<Claims> {
  const event = { user_id: userId, claims: { sub: userId, phone: phone.replace('+', ''), role: 'authenticated' } };
  const r = await db.query<{ out: { claims: Claims } }>('select public.custom_access_token_hook($1) as out', [event]);
  return r.rows[0].out.claims;
}

/** Run queries as a signed-in user, the way PostgREST does: claims in a setting, then the authenticated role. */
async function as<T>(claims: Claims, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params)).n);

const OWNER = '+2348031234567';
const OFFICE = '+2348029876543';
const TECH = '+2348061112233'; // Musa
const VIEWER = '+2348097778899';

// ---------- tests ----------

describe('login token claims (E1-1, E11-1)', () => {
  test('adds firm, staff id and role for active staff', async () => {
    const c = await claimsFor(OWNER);
    assert.equal(c.app_role, 'owner');
    assert.ok(c.firm_id && c.staff_id);
    assert.equal((await claimsFor('08061112233')).app_role, 'technician', 'local phone format is normalised');
  });

  test('unknown or deactivated phones get no firm', async () => {
    assert.equal((await claimsFor('+2348000000000')).firm_id, undefined);
    await db.query(`update staff set active = false where phone = '+2348065556677'`);
    assert.equal((await claimsFor('+2348065556677')).firm_id, undefined);
    await db.query(`update staff set active = true where phone = '+2348065556677'`);
  });

  test('no claims, no data', async () => {
    assert.equal(await as({ sub: crypto.randomUUID(), role: 'authenticated' }, () => count('select * from leads')), 0);
  });
});

describe('firm sign-up and isolation (E1-1, NFR-17)', () => {
  let other: Claims;

  before(async () => {
    const userId = crypto.randomUUID();
    const signingUp = { sub: userId, phone: '2348111111111', role: 'authenticated' };
    await as(signingUp, () => db.query(`select public.create_firm('Sunrise Energy', 'Bola Ade', 'Ibadan', 'Oyo')`));
    other = await claimsFor('+2348111111111', userId);
  });

  test('new firm gets an owner, checklists and plans', async () => {
    assert.equal(other.app_role, 'owner');
    await as(other, async () => {
      assert.equal(await count('select * from checklist_templates'), 4);
      assert.equal(await count('select * from plans'), 2);
      assert.equal((await one<{ name: string }>('select name from firms')).name, 'Sunrise Energy');
    });
  });

  test('cannot sign up twice with the same phone', async () => {
    await assert.rejects(as({ sub: crypto.randomUUID(), phone: '2348031234567' }, () => db.query(`select public.create_firm('X', 'Y')`)), /already belongs/);
  });

  test("a firm sees none of another firm's data", async () => {
    await as(other, async () => {
      for (const t of ['leads', 'jobs', 'quotes', 'invoices', 'payments', 'installations', 'staff', 'price_items', 'audit_log']) {
        const n = await count(`select * from ${t} where firm_id <> app.firm_id()`);
        assert.equal(n, 0, `${t} leaks across firms`);
      }
      assert.equal(await count('select * from staff'), 1);
    });
  });

  test("a firm can't write into another firm", async () => {
    const brightPath = (await claimsFor(OWNER)).firm_id as string;
    await as(other, async () => {
      await assert.rejects(db.query(`insert into leads (firm_id, name, phone, source) values ($1, 'Intruder', '0800', 'Call')`, [brightPath]), /row-level security/);
      const r = await db.query(`update leads set name = 'hacked' where firm_id = $1`, [brightPath]);
      assert.equal(r.affectedRows, 0);
    });
  });
});

describe('technician access (E5-2, NFR-10)', () => {
  test('sees only jobs assigned to them', async () => {
    const tech = await claimsFor(TECH);
    const assigned = await count(`select j.id from jobs j join job_assignees a on a.job_id = j.id where a.staff_id = $1`, [tech.staff_id]);
    await as(tech, async () => {
      assert.equal(await count('select * from jobs'), assigned);
      assert.ok(assigned > 0);
    });
  });

  test('never receives costs, margins or quotes', async () => {
    await as(await claimsFor(TECH), async () => {
      assert.equal(await count('select * from price_item_costs'), 0);
      assert.equal(await count('select * from quote_line_costs'), 0);
      assert.equal(await count('select * from quotes'), 0);
      assert.equal(await count('select * from quote_lines'), 0);
      assert.ok((await count('select * from price_items')) > 0, 'selling prices are visible');
    });
  });

  test('can update field data but not the schedule', async () => {
    const tech = await claimsFor(TECH);
    const job = await one<{ id: string }>(
      `select j.id from jobs j join job_assignees a on a.job_id = j.id where a.staff_id = $1 and j.status = 'Scheduled' limit 1`,
      [tech.staff_id],
    );
    await as(tech, async () => {
      await db.query(`update jobs set status = 'In progress', check_in_at = now(), check_in_lat = 6.45, check_in_lng = 3.47 where id = $1`, [job.id]);
      await assert.rejects(db.query(`update jobs set start_at = now() + interval '1 day' where id = $1`, [job.id]), /only update field data/);
      await assert.rejects(db.query(`update jobs set status = 'Cancelled' where id = $1`, [job.id]), /start or complete/);
      await db.query(`insert into job_serials (job_id, label, category, serial, method) values ($1, 'Inverter', 'inverter', 'TEST-SN-1', 'manual')`, [job.id]);
    });
  });

  test("can't see invoices for other people's jobs", async () => {
    const tech = await claimsFor(TECH);
    await as(tech, async () => {
      const n = await count(`select * from invoices i where i.job_id is null or not exists (select 1 from job_assignees a where a.job_id = i.job_id and a.staff_id = app.staff_id())`);
      assert.equal(n, 0);
    });
  });
});

describe('office and viewer roles (E4-5, E11-1, NFR-2)', () => {
  test("office staff can't read costs, but quote lines still get costed for the owner", async () => {
    const quote = await one<{ option_id: string }>(`select o.id as option_id from quote_options o join quotes q on q.id = o.quote_id where q.number = 'Q-2318' limit 1`);
    const item = await one<{ id: string; cost: string }>(`select p.id, c.cost from price_items p join price_item_costs c on c.item_id = p.id where p.category = 'inverter' limit 1`);
    const line = await as(await claimsFor(OFFICE), async () => {
      assert.equal(await count('select * from price_item_costs'), 0);
      return one<{ id: string }>(
        `insert into quote_lines (option_id, category, description, qty, unit_price, item_id) values ($1, 'inverter', 'Spare inverter', 1, 700000, $2) returning id`,
        [quote.option_id, item.id],
      );
    });
    await as(await claimsFor(OWNER), async () => {
      const c = await one<{ unit_cost: string }>('select unit_cost from quote_line_costs where line_id = $1', [line.id]);
      assert.equal(Number(c.unit_cost), Number(item.cost));
    });
  });

  test('office staff never overwrite field data on a job', async () => {
    const job = await one<{ id: string }>(`select id from jobs where status = 'Done' and jsonb_array_length(checklist) > 0 limit 1`);
    await as(await claimsFor(OFFICE), async () => {
      await assert.rejects(db.query(`update jobs set checklist = '[]' where id = $1`, [job.id]), /technician/);
      await db.query(`update jobs set notes = 'Call before arriving' where id = $1`, [job.id]);
    });
  });

  test('viewers read but cannot change anything', async () => {
    await as(await claimsFor(VIEWER), async () => {
      assert.ok((await count('select * from leads')) > 0);
      await assert.rejects(db.query(`insert into leads (name, phone, source) values ('X', '0800', 'Call')`), /row-level security/);
      assert.equal((await db.query(`update leads set notes = 'x'`)).affectedRows, 0);
    });
  });

  test('only the owner manages staff, and the last owner stays', async () => {
    await as(await claimsFor(OFFICE), async () => {
      assert.equal((await db.query(`update staff set role = 'owner' where phone = $1`, [OFFICE])).affectedRows, 0);
    });
    await as(await claimsFor(OWNER), async () => {
      await assert.rejects(db.query(`update staff set role = 'office' where phone = $1`, [OWNER]), /at least one active owner/);
    });
  });

  test('subscription changes only through billing', async () => {
    await as(await claimsFor(OWNER), async () => {
      await assert.rejects(db.query(`update firms set subscription_status = 'active'`), /billing/);
      await db.query(`update firms set follow_up_days = 4`);
    });
  });
});

describe('payments (E9-4) and audit log (E11-3)', () => {
  test('staff record cash as pending; only the owner approves', async () => {
    const inv = await one<{ id: string }>(`select id from invoices where kind = 'Balance' limit 1`);
    const pay = await as(await claimsFor(OFFICE), async () => {
      await assert.rejects(
        db.query(`insert into payments (invoice_id, amount, method, status) values ($1, 1000, 'Card', 'Confirmed')`, [inv.id]),
        /pending approval/,
      );
      const p = await one<{ id: string; reference: string; recorded_by: string }>(
        `insert into payments (invoice_id, amount, method, status) values ($1, 50000, 'Cash', 'Pending approval') returning id, reference, recorded_by`,
        [inv.id],
      );
      assert.match(p.reference, /^PAY-\d+$/, 'reference is numbered by the database');
      assert.ok(p.recorded_by);
      await assert.rejects(db.query(`update payments set status = 'Confirmed' where id = $1`, [p.id]), /only the owner/);
      return p;
    });
    await as(await claimsFor(OWNER), async () => {
      await assert.rejects(db.query(`update payments set amount = 1 where id = $1`, [pay.id]), /approve or reject/);
      const approved = await one<{ approved_by: string }>(`update payments set status = 'Confirmed' where id = $1 returning approved_by`, [pay.id]);
      assert.ok(approved.approved_by);
      assert.equal((await db.query(`delete from payments where id = $1`, [pay.id])).affectedRows, 0, 'payments cannot be deleted');
    });
  });

  test('price changes are logged with who and before/after values; only the owner reads the log', async () => {
    const owner = await claimsFor(OWNER);
    await as(owner, async () => {
      const item = await one<{ id: string; price: string }>(`select id, price from price_items order by brand limit 1`);
      await db.query(`update price_items set price = price + 5000 where id = $1`, [item.id]);
      const entry = await one<{ actor_id: string; before: { price: number }; after: { price: number }; summary: string }>(
        `select actor_id, before, after, summary from audit_log where entity_id = $1 order by id desc limit 1`,
        [item.id],
      );
      assert.equal(entry.actor_id, owner.staff_id);
      assert.equal(Number(entry.after.price) - Number(entry.before.price), 5000);
      assert.match(entry.summary, /^Changed .*: price$/);
      await assert.rejects(db.query('delete from audit_log'), /permission denied/, 'audit log cannot be deleted');
      await assert.rejects(db.query(`update audit_log set summary = 'edited'`), /permission denied/, 'audit log cannot be edited');
    });
    await as(await claimsFor(OFFICE), async () => assert.equal(await count('select * from audit_log'), 0));
  });

  test('numbers are assigned per firm in sequence', async () => {
    await as(await claimsFor(OFFICE), async () => {
      const lead = await one<{ id: string }>(`insert into leads (name, phone, source) values ('Numbering test', '08000000000', 'Call') returning id`);
      const a = await one<{ number: string }>(`insert into quotes (lead_id) values ($1) returning number`, [lead.id]);
      const b = await one<{ number: string }>(`insert into quotes (lead_id) values ($1) returning number`, [lead.id]);
      assert.equal(Number(b.number.split('-')[1]), Number(a.number.split('-')[1]) + 1);
    });
  });
});

describe('apply_changes: office writes in one transaction (Phase 2)', () => {
  const apply = (ops: unknown[]) => db.query('select public.apply_changes($1)', [JSON.stringify(ops)]);

  test('inserts, updates and deletes across tables atomically, with numbering and defaults', async () => {
    const office = await claimsFor(OFFICE);
    const leadId = crypto.randomUUID();
    const quoteId = crypto.randomUUID();
    const optionId = crypto.randomUUID();
    await as(office, async () => {
      await apply([
        { t: 'leads', op: 'insert', row: { id: leadId, name: 'Batch Ltd', phone: '+2348050000001', source: 'Call', firm_id: 'ignored' } },
        { t: 'quotes', op: 'insert', row: { id: quoteId, lead_id: leadId, number: null } },
        { t: 'quote_options', op: 'insert', row: { id: optionId, quote_id: quoteId, name: 'Recommended', backup_hours: 10 } },
        { t: 'quote_lines', op: 'insert', row: { id: crypto.randomUUID(), option_id: optionId, category: 'service', description: 'Labour', qty: 1, unit_price: 80000 } },
        { t: 'leads', op: 'update', key: { id: leadId }, set: { stage: 'Quoted', not_a_column: 1 } },
      ]);
      const lead = await one<{ stage: string; created_by: string; firm_id: string }>('select stage, created_by, firm_id from leads where id = $1', [leadId]);
      assert.equal(lead.stage, 'Quoted');
      assert.equal(lead.created_by, office.staff_id, 'created_by comes from the token');
      assert.equal(lead.firm_id, office.firm_id);
      assert.match((await one<{ number: string }>('select number from quotes where id = $1', [quoteId])).number, /^Q-\d+$/);
      await apply([{ t: 'quote_options', op: 'delete', key: { id: optionId } }]);
      assert.equal(await count('select * from quote_lines where option_id = $1', [optionId]), 0, 'lines cascade with the option');
    });
  });

  test('a failing op rolls back the whole batch', async () => {
    const leadId = crypto.randomUUID();
    await as(await claimsFor(OFFICE), async () => {
      await assert.rejects(
        apply([
          { t: 'leads', op: 'insert', row: { id: leadId, name: 'Half Ltd', phone: '0800', source: 'Call' } },
          { t: 'price_item_costs', op: 'update', key: { item_id: crypto.randomUUID() }, set: { cost: 1 } },
        ]),
        /no price_item_costs row/,
      );
      assert.equal(await count('select * from leads where id = $1', [leadId]), 0);
    });
  });

  test('security still applies: hidden rows, other firms, unlisted tables', async () => {
    const tech = await claimsFor(TECH);
    const other = await one<{ id: string }>(
      `select j.id from jobs j where not exists (select 1 from job_assignees a where a.job_id = j.id and a.staff_id = $1) limit 1`,
      [tech.staff_id],
    );
    await as(tech, async () => {
      await assert.rejects(apply([{ t: 'jobs', op: 'update', key: { id: other.id }, set: { checklist: [] } }]), /that you can change/);
      await assert.rejects(apply([{ t: 'audit_log', op: 'delete', key: { id: 1 } }]), /cannot be changed from the app/);
      await assert.rejects(apply([{ t: 'counters', op: 'update', key: { prefix: 'Q' }, set: { value: 1 } }]), /cannot be changed from the app/);
    });
    await as(await claimsFor(OFFICE), async () => {
      await assert.rejects(apply([{ t: 'payments', op: 'insert', row: { invoice_id: other.id, amount: 5, method: 'Card', status: 'Confirmed' } }]), /pending approval/);
    });
  });

  test('a job, its installation and ticket can link to each other in one batch', async () => {
    const lead = await one<{ id: string }>(`select id from leads where stage = 'Won' limit 1`);
    const jobId = crypto.randomUUID();
    const insId = crypto.randomUUID();
    await as(await claimsFor(OFFICE), async () => {
      await apply([
        { t: 'jobs', op: 'insert', row: { id: jobId, lead_id: lead.id, type: 'Installation', installation_id: insId } },
        { t: 'installations', op: 'insert', row: { id: insId, lead_id: lead.id, job_id: jobId, installed_at: new Date().toISOString(), next_service_at: new Date().toISOString() } },
      ]);
      assert.equal(await count('select * from jobs where installation_id = $1', [insId]), 1);
    });
  });
});

describe('server reminders (E8-1, E8-2, E9-3)', () => {
  test('queues each reminder once, and WhatsApp only with consent', async () => {
    const first = Number((await one<{ n: number }>('select app.run_automations() as n')).n);
    const second = Number((await one<{ n: number }>('select app.run_automations() as n')).n);
    assert.ok(first > 0, 'seeded overdue balances and due services produce reminders');
    assert.equal(second, 0, 'running again sends nothing new');
    const leak = await count(`select m.* from messages m join leads l on l.phone = m.to_phone and l.firm_id = m.firm_id where m.channel = 'WhatsApp' and not l.whatsapp_consent`);
    assert.equal(leak, 0);
    const overdue = await one<{ reminders_sent: number[] }>(`select reminders_sent from invoices where number = (select number from invoices where kind = 'Balance' and due_at < now() - interval '8 days' order by due_at desc limit 1)`);
    assert.ok(overdue.reminders_sent.includes(7));
  });

  test('app users cannot trigger reminders themselves', async () => {
    await as(await claimsFor(OWNER), async () => {
      await assert.rejects(db.query('select app.run_automations()'), /permission denied/);
    });
  });
});

describe('remote wipe: sign a staff member out of all phones (NFR-11)', () => {
  test('owner ends their sessions and stamps the staff row; a later sign-in still works', async () => {
    const musa = await one<{ id: string }>('select id from staff where phone = $1', [TECH]);
    const userId = crypto.randomUUID();
    await db.query('insert into auth.users (id, phone) values ($1, $2)', [userId, TECH.replace('+', '')]);
    await db.query('insert into auth.sessions (user_id) values ($1), ($1)', [userId]);

    await as(await claimsFor(OWNER), async () => {
      await db.query('select public.sign_out_staff($1)', [musa.id]);
    });
    assert.equal(await count('select * from auth.sessions where user_id = $1', [userId]), 0, 'sessions ended, so refresh tokens stop working');
    const row = await one<{ signed_out_at: string | null }>('select signed_out_at from staff where id = $1', [musa.id]);
    assert.notEqual(row.signed_out_at, null);
    assert.equal((await claimsFor(TECH, userId)).app_role, 'technician', 'signing in again with a new code is allowed');
  });

  test('only the owner can do it, not on themselves, and nobody can edit the stamp directly', async () => {
    const musa = await one<{ id: string }>('select id from staff where phone = $1', [TECH]);
    for (const phone of [OFFICE, TECH, VIEWER]) {
      await as(await claimsFor(phone), async () => {
        await assert.rejects(db.query('select public.sign_out_staff($1)', [musa.id]), /only the owner/);
      });
    }
    const owner = await claimsFor(OWNER);
    await as(owner, async () => {
      await assert.rejects(db.query('select public.sign_out_staff($1)', [owner.staff_id]), /sign yourself out/);
      const ops = [{ t: 'staff', op: 'update', key: { id: musa.id }, set: { signed_out_at: null } }];
      await assert.rejects(db.query('select public.apply_changes($1)', [JSON.stringify(ops)]), /sign out of all phones/);
    });
  });

  test('cannot reach staff in another firm', async () => {
    const other = await one<{ id: string }>('select id from staff where firm_id <> (select firm_id from staff where phone = $1) limit 1', [OWNER]);
    if (!other) return;
    await as(await claimsFor(OWNER), async () => {
      await assert.rejects(db.query('select public.sign_out_staff($1)', [other.id]), /no such staff member/);
    });
  });
});
