// Security tests: the attacks we expect against a multi-firm app with public links, run against the real migrations
// (Postgres in WebAssembly) and the same request handlers the Edge Functions run.
//   1. Database hardening      every table has row-level security; definer functions are locked down
//   2. SQL injection           through the batch-save function, link tokens and public forms
//   3. Access control          other firms' data, role escalation, mass assignment, audit-log tampering
//   4. Public API abuse        malformed input, oversized uploads, error leakage, rate limiting per client
//   5. Webhook forgery         missing, wrong, replayed or tampered signatures
// Run: npm run test:security
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { signBachs } from '../functions/_shared/bachs.ts';
import type { Deps } from '../functions/_shared/handlers.ts';
import { handleBachsWebhook, handlePublic, handleWebhook } from '../functions/_shared/handlers.ts';
import { signBody } from '../functions/_shared/paystack.ts';
import { safeHref } from '../../src/lib/safeUrl.ts';

const dir = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, dir), 'utf8');
let pg: PGlite;

// ---------- harness ----------

type Claims = Record<string, unknown>;
const OWNER = '2348031234567';
const OFFICE = '2348029876543';
const TECH = '2348061112233';

async function claimsFor(phone: string): Promise<Claims> {
  const r = await pg.query<{ c: { claims: Claims } }>('select public.custom_access_token_hook($1) as c', [{ user_id: crypto.randomUUID(), claims: { phone } }]);
  return { sub: crypto.randomUUID(), role: 'authenticated', ...r.rows[0].c.claims };
}
/** Run as a signed-in user (claims) or as an anonymous visitor (null), the way PostgREST does. */
async function as<T>(claims: Claims | null, fn: () => Promise<T>): Promise<T> {
  await pg.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims ?? {})]);
  await pg.exec(claims ? 'set role authenticated' : 'set role anon');
  try {
    return await fn();
  } finally {
    await pg.exec('reset role');
    await pg.query(`select set_config('request.jwt.claims', '', false)`);
  }
}
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params)).n);
const apply = (ops: unknown[]) => pg.query('select public.apply_changes($1)', [JSON.stringify(ops)]);

async function callFn(fn: string, args: Record<string, unknown>) {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
  try {
    return (await pg.query<{ r: unknown }>(sql, names.map((n) => args[n]))).rows[0]?.r ?? null;
  } catch (e) {
    throw new Error((e as Error).message);
  }
}

const rpcCalls: string[] = [];
let deps: Deps;
let firmA = '';
let firmB = '';
let ownerB: Claims;

before(async () => {
  pg = await PGlite.create();
  await pg.exec(read('tests/shim.sql'));
  for (const f of readdirSync(new URL('migrations/', dir)).sort()) await pg.exec(read(`migrations/${f}`));
  await pg.exec(read('seed.sql'));
  deps = {
    rpc: async (fn, args) => {
      rpcCalls.push(fn);
      return callFn(fn, args);
    },
    userRpc: async (token, fn, args = {}) => as(JSON.parse(token), () => callFn(fn, args)),
    signUrls: async (bucket, paths) => Object.fromEntries(paths.map((p) => [p, `https://signed.test/${bucket}/${p}`])),
    publicFileUrl: (bucket, path) => `https://public.test/${bucket}/${path}`,
    upload: async () => undefined,
    provider: () => {
      throw new Error('Payment provider: not used in these tests');
    },
    activeProvider: 'paystack',
    appUrl: 'https://app.test',
  };

  // A second firm, so we can attack across firms
  firmA = (await one<{ id: string }>('select firm_id as id from staff where phone = $1', ['+' + OWNER])).id;
  firmB = (await one<{ id: string }>(`insert into firms (name) values ('Rival Solar') returning id`)).id;
  await pg.query(`insert into staff (firm_id, name, phone, role, title) values ($1, 'Rival Owner', '+2348090000001', 'owner', 'Owner')`, [firmB]);
  await pg.query(`insert into leads (firm_id, name, phone, location, address, source, property_type, stage) values ($1, 'Rival Customer', '+2348090000002', 'Abuja', 'Abuja', 'Call', 'Home', 'New')`, [firmB]);
  ownerB = await claimsFor('2348090000001');
});
after(() => pg.close());

// ---------- 1. database hardening ----------

describe('database hardening', () => {
  test('every table in the public schema has row-level security turned on', async () => {
    const open = await rows<{ t: string }>(`select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    assert.deepEqual(open.map((r) => r.t), [], 'tables without row-level security');
  });

  test('every security-definer function pins its search_path (no search_path hijacking)', async () => {
    const loose = await rows<{ f: string }>(`select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'app')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    assert.deepEqual(loose.map((r) => r.f), []);
  });

  test('service-only functions (svc_*) cannot be called by visitors or signed-in users', async () => {
    const exposed = await rows<{ f: string; r: string }>(`select p.proname as f, r.rolname as r from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) r(rolname)
      where n.nspname = 'public' and p.proname like 'svc\\_%' and has_function_privilege(r.rolname, p.oid, 'execute')`);
    assert.deepEqual(exposed, []);
  });

  test('internal definer functions that run dynamic SQL or mint links are not callable by app users', async () => {
    // These run with the owner's rights. app.rows executes any query it is given; tokenize_urls mints customer links.
    for (const fn of ['app.rows(text)', 'app.tokenize_urls(uuid, text)', 'app.safe_firm(uuid)']) {
      for (const role of ['anon', 'authenticated']) {
        const r = await one<{ ok: boolean }>(`select has_function_privilege($1, $2::regprocedure, 'execute') as ok`, [role, fn]);
        assert.equal(r.ok, false, `${role} can execute ${fn}`);
      }
    }
    await as(await claimsFor(OWNER), async () => {
      await assert.rejects(pg.query(`select app.rows('select * from staff')`), /permission denied/);
    });
  });

  test('visitors cannot read any table directly', async () => {
    const tables = await rows<{ t: string }>(`select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`);
    for (const { t } of tables) {
      const n = await as(null, async () => {
        try {
          return (await pg.query(`select 1 from public.${t} limit 1`)).rows.length;
        } catch {
          return 0; // no privilege at all is fine too
        }
      });
      assert.equal(n, 0, `anon can read ${t}`);
    }
  });
});

// ---------- 2. SQL injection ----------

describe('SQL injection', () => {
  const payloads = [`' or '1'='1`, `'; drop table leads; --`, `1); delete from leads; --`, `"; select pg_sleep(5); --`, `\\x27 union select * from staff --`];

  test('table names in the batch-save function cannot be injected', async () => {
    await as(await claimsFor(OFFICE), async () => {
      for (const t of ['leads; drop table leads', 'pg_catalog.pg_authid', '"leads"', 'audit_log', 'counters']) {
        await assert.rejects(apply([{ t, op: 'insert', row: { name: 'x' } }]), /cannot be changed from the app/);
      }
    });
    assert.ok((await count('select * from leads')) > 0, 'leads table still exists');
  });

  test('column names and key values are quoted, not executed', async () => {
    const before = await count('select * from leads');
    const owner = await claimsFor(OWNER);
    await as(owner, async () => {
      for (const p of payloads) {
        // Injection in the key value: matches nothing, so the update is refused
        await assert.rejects(apply([{ t: 'leads', op: 'update', key: { id: p }, set: { notes: 'pwned' } }]));
        // Injection in a column name: unknown columns are dropped, so nothing is set
        await apply([{ t: 'leads', op: 'update', key: { id: (await one<{ id: string }>('select id from leads limit 1')).id }, set: { [`notes = 'x'; drop table leads; --`]: 1 } }]).catch(() => undefined);
      }
    });
    assert.equal(await count('select * from leads'), before);
    assert.equal(await count(`select * from leads where notes = 'pwned' or notes = 'x'`), 0);
  });

  test('injection in a stored value is stored as text, never run', async () => {
    const owner = await claimsFor(OWNER);
    const id = crypto.randomUUID();
    await as(owner, () => apply([{ t: 'leads', op: 'insert', row: { id, name: `Robert'); drop table leads; --`, phone: '+2348011111111', location: 'x', address: 'x', source: 'Call', property_type: 'Home', stage: 'New' } }]));
    assert.equal((await one<{ name: string }>('select name from leads where id = $1', [id])).name, `Robert'); drop table leads; --`);
  });

  test('link tokens with injection payloads are rejected before reaching the database', async () => {
    for (const p of payloads) {
      rpcCalls.length = 0;
      for (const action of ['view', 'report', 'pay']) {
        const r = await handlePublic({ action, token: p }, null, deps);
        assert.equal(r.status, 404);
      }
      assert.equal(rpcCalls.filter((c) => c !== 'svc_rate_limit').length, 0, 'no database call for a malformed token');
    }
  });

  test('the database rejects injection in a token even if called directly', async () => {
    for (const p of payloads) await assert.rejects(callFn('svc_public_view', { p_token: p }), /not valid or has expired/);
  });

  test('public enquiry fields are stored as text', async () => {
    const token = (await one<{ t: string }>('select enquiry_token as t from firms where id = $1', [firmA])).t;
    const evil = `<script>alert(1)</script>'; drop table leads; --`;
    const r = await handlePublic({ action: 'enquire', firmToken: token, name: evil, phone: '08012345678', location: evil, propertyType: 'Home' }, null, deps);
    assert.equal(r.status, 200);
    assert.ok((await count('select * from leads where name = $1', [evil])) === 1, 'stored verbatim (React escapes it on display)');
  });
});

// ---------- 3. access control ----------

describe('access control', () => {
  test("a firm cannot read another firm's customers", async () => {
    await as(ownerB, async () => {
      assert.equal(await count('select * from leads where firm_id = $1', [firmA]), 0);
      assert.equal(await count('select * from staff where firm_id = $1', [firmA]), 0);
      assert.equal(await count('select * from payments where firm_id = $1', [firmA]), 0);
    });
  });

  test("a firm cannot change another firm's records by guessing ids (IDOR)", async () => {
    const victim = (await one<{ id: string }>('select id from leads where firm_id = $1 limit 1', [firmA])).id;
    await as(ownerB, async () => {
      await assert.rejects(apply([{ t: 'leads', op: 'update', key: { id: victim }, set: { name: 'hijacked' } }]), /no leads row matching/);
      await apply([{ t: 'leads', op: 'delete', key: { id: victim } }]).catch(() => undefined);
    });
    assert.notEqual((await one<{ name: string }>('select name from leads where id = $1', [victim]))?.name, 'hijacked');
    assert.equal(await count('select * from leads where id = $1', [victim]), 1, 'still there after a cross-firm delete');
  });

  test('a new row cannot be planted in another firm (firm_id is always the caller’s)', async () => {
    const id = crypto.randomUUID();
    await as(ownerB, () => apply([{ t: 'leads', op: 'insert', row: { id, firm_id: firmA, name: 'Planted', phone: '+2348011111112', location: 'x', address: 'x', source: 'Call', property_type: 'Home', stage: 'New' } }]));
    assert.equal((await one<{ firm_id: string }>('select firm_id from leads where id = $1', [id])).firm_id, firmB);
  });

  test('a technician cannot promote themselves or change their sign-in identity', async () => {
    const tech = await claimsFor(TECH);
    await as(tech, async () => {
      await assert.rejects(apply([{ t: 'staff', op: 'update', key: { id: tech.staff_id }, set: { role: 'owner' } }]));
      await assert.rejects(apply([{ t: 'staff', op: 'update', key: { id: tech.staff_id }, set: { auth_user_id: crypto.randomUUID() } }]));
    });
    assert.equal((await one<{ role: string }>('select role from staff where id = $1', [tech.staff_id])).role, 'technician');
  });

  test('office staff cannot make themselves owner or read costs', async () => {
    const office = await claimsFor(OFFICE);
    await as(office, async () => {
      await assert.rejects(apply([{ t: 'staff', op: 'update', key: { id: office.staff_id }, set: { role: 'owner' } }]));
      assert.equal(await count('select * from price_item_costs'), 0);
      assert.equal(await count('select * from quote_line_costs'), 0);
    });
  });

  test('nobody can grant their firm a paid subscription by editing it', async () => {
    const owner = await claimsFor(OWNER);
    await as(owner, async () => {
      await assert.rejects(apply([{ t: 'firms', op: 'update', key: { id: firmA }, set: { subscription_status: 'active', paid_until: '2099-01-01' } }]), /subscription changes go through billing/);
    });
  });

  test('the audit log cannot be edited or deleted, even by the owner', async () => {
    const owner = await claimsFor(OWNER);
    await as(owner, async () => {
      await assert.rejects(pg.query(`update audit_log set summary = 'nothing happened'`), /permission denied/);
      await assert.rejects(pg.query(`delete from audit_log`), /permission denied/);
      await assert.rejects(pg.query(`insert into audit_log (firm_id, entity, table_name, entity_id, action, summary) values ($1, 'quote', 'quotes', gen_random_uuid(), 'insert', 'fake')`, [firmA]), /permission denied/);
    });
  });
});

// ---------- 4. public API abuse ----------

describe('public API abuse', () => {
  test('malformed bodies get a 400, never a crash', async () => {
    for (const body of [null, undefined, 42, 'view', [], { action: 42 }, { action: '__proto__' }, { action: 'constructor' }, JSON.parse('{"action":"view","__proto__":{"admin":true}}')]) {
      const r = await handlePublic(body, null, deps);
      assert.ok([400, 404].includes(r.status), `status ${r.status} for ${JSON.stringify(body)}`);
    }
    assert.equal(({} as Record<string, unknown>).admin, undefined, 'no prototype pollution');
  });

  test('oversized and non-JPEG uploads are refused before storage', async () => {
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(600_000);
    const svg = 'data:image/svg+xml;base64,' + btoa('<svg onload="alert(1)"/>');
    const html = 'data:text/html;base64,' + btoa('<script>alert(1)</script>');
    for (const dataUrl of [big, svg, html, 'javascript:alert(1)']) {
      const r = await handlePublic({ action: 'report-photo', token: 'a'.repeat(64), ticketId: crypto.randomUUID(), dataUrl }, null, deps);
      assert.equal(r.status, 400);
    }
  });

  test('payment references must have our exact format', async () => {
    for (const reference of ['', 'sfs_', 'sfs_../../etc/passwd', `sfs_' or 1=1 --`, 'x'.repeat(5000)]) {
      const r = await handlePublic({ action: 'verify', reference }, null, deps);
      assert.equal(r.status, 400);
    }
  });

  test('unexpected errors are hidden from the caller', async () => {
    const broken: Deps = { ...deps, rpc: async () => Promise.reject(new Error('relation "secret_table" does not exist at character 42')) };
    const r = await handlePublic({ action: 'view', token: 'a'.repeat(64) }, null, broken);
    assert.equal(r.status, 500);
    assert.doesNotMatch(JSON.stringify(r.body), /secret_table|relation|character/);
  });

  test('subscription payment needs a signed-in owner', async () => {
    assert.equal((await handlePublic({ action: 'pay-subscription' }, null, deps)).status, 401);
    const office = JSON.stringify(await claimsFor(OFFICE));
    const r = await handlePublic({ action: 'pay-subscription' }, `Bearer ${office}`, deps);
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /Only the owner/);
  });

  test('one client is rate limited per action (429), other clients are not affected', async () => {
    const limited: Deps = { ...deps, rateLimit: (bucket, key, max, seconds) => callFn('svc_rate_limit', { p_bucket: bucket, p_key: key, p_limit: max, p_window_seconds: seconds }) as Promise<boolean> };
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++) statuses.push((await handlePublic({ action: 'view', token: 'b'.repeat(64) }, null, limited, 'attacker-ip')).status);
    assert.ok(statuses.includes(429), 'the attacker is eventually refused');
    assert.equal(statuses.indexOf(429) > 20, true, 'normal use is not refused early');
    const other = await handlePublic({ action: 'view', token: 'b'.repeat(64) }, null, limited, 'customer-ip');
    assert.notEqual(other.status, 429, 'another visitor still gets through');
  });

  test('enquiry spam from one client is cut off long before the firm-wide limit', async () => {
    const limited: Deps = { ...deps, rateLimit: (bucket, key, max, seconds) => callFn('svc_rate_limit', { p_bucket: bucket, p_key: key, p_limit: max, p_window_seconds: seconds }) as Promise<boolean> };
    const token = (await one<{ t: string }>('select enquiry_token as t from firms where id = $1', [firmA])).t;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await handlePublic({ action: 'enquire', firmToken: token, name: `Spam ${i}`, phone: '08012345678', location: 'x', propertyType: 'Home' }, null, limited, 'spammer-ip')).status);
    }
    assert.ok(statuses.filter((s) => s === 429).length >= 5, `statuses: ${statuses.join(',')}`);
  });

  test('the rate-limit function itself is service-only', async () => {
    await as(await claimsFor(OWNER), async () => {
      await assert.rejects(pg.query(`select public.svc_rate_limit('view', 'x', 1, 60)`), /permission denied/);
    });
  });
});

// ---------- 5. webhook forgery ----------

describe('webhook forgery', () => {
  const SECRET = 'sk_test_fake_secret';
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'sfs_' + '0'.repeat(32), amount: 100000, channel: 'card', paid_at: new Date().toISOString() } });

  test('Paystack: missing, wrong or tampered signatures are refused before touching the database', async () => {
    rpcCalls.length = 0;
    assert.equal((await handleWebhook(body, null, SECRET, deps)).status, 401);
    assert.equal((await handleWebhook(body, 'deadbeef', SECRET, deps)).status, 401);
    assert.equal((await handleWebhook(body, await signBody('sk_test_other', body), SECRET, deps)).status, 401);
    const sig = await signBody(SECRET, body);
    assert.equal((await handleWebhook(body.replace('100000', '1'), sig, SECRET, deps)).status, 401, 'amount changed after signing');
    assert.equal(rpcCalls.length, 0);
  });

  test('Bachs: wrong secret and replayed (stale) events are refused', async () => {
    const now = Math.floor(Date.now() / 1000);
    const raw = JSON.stringify({ type: 'collection.succeeded', created_at: new Date().toISOString(), data: { reference: 'sfs_' + '0'.repeat(32), amount: 100000 } });
    assert.equal((await handleBachsWebhook(raw, null, 'whsec_test', deps, now)).status, 400);
    assert.equal((await handleBachsWebhook(raw, await signBachs('whsec_other', raw, now), 'whsec_test', deps, now)).status, 400);
    const old = await signBachs('whsec_test', raw, now - 60 * 60);
    assert.equal((await handleBachsWebhook(raw, old, 'whsec_test', deps, now)).status, 400, 'an hour-old signature is a replay');
  });

  test('a correctly signed event for an unknown payment changes nothing', async () => {
    const before = await count('select * from payments');
    const r = await handleWebhook(body, await signBody(SECRET, body), SECRET, deps);
    assert.equal(r.status, 200);
    assert.equal(await count('select * from payments'), before);
  });
});

// ---------- 6. links rendered from stored data ----------

describe('stored links (cross-site scripting)', () => {
  test('only web, phone, SMS and email links are rendered', () => {
    for (const evil of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd']) {
      assert.equal(safeHref(evil), undefined, evil);
    }
    assert.equal(safeHref('https://app.test/q/abc'), 'https://app.test/q/abc');
    assert.equal(safeHref('tel:+2348031234567'), 'tel:+2348031234567');
  });
});
