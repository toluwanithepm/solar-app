// Live security probe: attacks the deployed site and Supabase project from the outside, as an anonymous attacker.
// Read-only by default: it never creates customers, payments or files.
//
//   npm run security:probe -- --site https://your-site.vercel.app            (Supabase values from .env.local)
//   npm run security:probe -- --site https://your-site.vercel.app --burst    (also checks rate limiting: ~70 requests)
//
// Only run it against a deployment you own.
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const env = Object.fromEntries(
  (existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const SUPABASE = (opt('supabase') ?? process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '';
const SITE = (opt('site') ?? process.env.SITE_URL ?? '').replace(/\/$/, '');
if (!SUPABASE || !ANON) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or keep them in .env.local).');
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const rest = (path, init = {}) =>
  fetch(`${SUPABASE}${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
const fn = (name, body, init = {}) =>
  fetch(`${SUPABASE}/functions/v1/${name}`, {
    method: 'POST',
    ...init,
    headers: { apikey: ANON, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const statusOf = async (p) => {
  const r = await p;
  const text = await r.text();
  // Supabase sits behind a web application firewall: an HTML 403 means the attack was stopped before reaching us
  const firewall = r.status === 403 && (r.headers.get('content-type') ?? '').includes('text/html');
  return { status: r.status, text: firewall ? '' : text, firewall };
};
const refused = (r, ...codes) => codes.includes(r.status) || r.status === 429 || r.firewall;

// ---------- 1. the website ----------
if (SITE) {
  console.log(`\nWebsite: ${SITE}`);
  const r = await fetch(SITE);
  const h = r.headers;
  check('Content-Security-Policy is set', !!h.get('content-security-policy'));
  check('CSP blocks framing (clickjacking)', /frame-ancestors 'none'/.test(h.get('content-security-policy') ?? '') || h.get('x-frame-options') === 'DENY');
  check('CSP blocks plugins and stray scripts', /object-src 'none'/.test(h.get('content-security-policy') ?? '') && !/script-src[^;]*'unsafe-inline'/.test(h.get('content-security-policy') ?? ''));
  check('HTTPS is enforced (HSTS)', !!h.get('strict-transport-security'));
  check('MIME sniffing is off', h.get('x-content-type-options') === 'nosniff');
  check('Referrer policy is set', !!h.get('referrer-policy'));
  check('Camera/location limited to the site (Permissions-Policy)', /camera=\(self\)/.test(h.get('permissions-policy') ?? ''));
  // The built JavaScript must not carry server secrets
  const html = await r.text();
  const js = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  let leaked = false;
  for (const src of js) {
    const code = await (await fetch(SITE + src)).text();
    for (const jwt of code.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []) {
      const role = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role;
      if (role !== 'anon') leaked = true;
    }
    if (/sk_live_|sk_test_[A-Za-z0-9]{20,}|service_role/.test(code)) leaked = true;
  }
  check('No secret keys in the website code (only the public anon key)', !leaked, `${js.length} script(s) scanned`);
}

// ---------- 2. the database API, as an anonymous attacker ----------
console.log(`\nDatabase API: ${SUPABASE}`);
const tables = ['firms', 'staff', 'leads', 'quotes', 'quote_lines', 'quote_line_costs', 'price_items', 'price_item_costs', 'jobs', 'invoices', 'payments', 'photos', 'messages', 'audit_log', 'public_links', 'payment_intents', 'counters'];
for (const t of tables) {
  const { status, text } = await statusOf(rest(`/rest/v1/${t}?select=*&limit=1`));
  const leaked = status === 200 && text.trim() !== '[]';
  check(`Anonymous read of ${t} returns nothing`, !leaked, `HTTP ${status}`);
}
for (const [name, body] of [
  ['apply_changes', { ops: [{ t: 'leads', op: 'insert', row: { name: 'probe' } }] }],
  ['svc_public_view', { p_token: 'a'.repeat(64) }],
  ['svc_record_gateway_payment', { p_reference: 'sfs_' + '0'.repeat(32), p_amount_kobo: 1, p_channel: 'card', p_paid_at: new Date().toISOString() }],
  ['svc_rate_limit', { p_bucket: 'x', p_key: 'x', p_limit: 1, p_window_seconds: 60 }],
  ['create_subscription_intent', {}],
  ['sign_out_staff', { p_staff: '00000000-0000-0000-0000-000000000000' }],
]) {
  const { status } = await statusOf(rest(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) }));
  check(`Anonymous call to ${name} is refused`, status >= 400, `HTTP ${status}`);
}
const inj = await statusOf(rest(`/rest/v1/leads?select=*&name=eq.${encodeURIComponent("x' or '1'='1")}`));
check('SQL injection in a filter returns nothing', !(inj.status === 200 && inj.text.trim() !== '[]'), `HTTP ${inj.status}`);
const internal = await statusOf(rest(`/rest/v1/rpc/rows`, { method: 'POST', body: JSON.stringify({ q: 'select * from staff' }), headers: { 'Content-Profile': 'app', 'Accept-Profile': 'app' } }));
check('Internal schema (app) is not reachable over the API', internal.status >= 400, `HTTP ${internal.status}`);

// ---------- 3. the public link function ----------
console.log('\nPublic link function');
const pub = async (body, init) => statusOf(fn('public', body, init));
check('GET is refused', (await statusOf(fetch(`${SUPABASE}/functions/v1/public`, { headers: { apikey: ANON } }))).status === 405);
check('Unknown action is refused', (await pub({ action: 'drop_tables' })).status === 400);
check('Malformed JSON is refused', (await pub('{"action":')).status === 400);
for (const token of [`' or '1'='1`, '../../../etc/passwd', '<script>alert(1)</script>', 'a'.repeat(64)]) {
  const r = await pub({ action: 'view', token });
  check(`Bad link token is refused (${token.slice(0, 20)})`, refused(r, 404), r.firewall ? 'stopped by the firewall' : `HTTP ${r.status}`);
  check('…without leaking database details', !/relation|syntax|column|pg_|stack/i.test(r.text));
}
const badRef = await pub({ action: 'verify', reference: "sfs_' or 1=1" });
check('Bad payment reference is refused', refused(badRef, 400), badRef.firewall ? 'stopped by the firewall' : `HTTP ${badRef.status}`);
check('Subscription payment needs sign-in', [401, 429].includes((await pub({ action: 'pay-subscription' })).status));
const huge = await pub({ action: 'report-photo', token: 'a'.repeat(64), ticketId: crypto.randomUUID(), dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(700_000) });
check('Oversized upload is refused cleanly', refused(huge, 400, 413), `HTTP ${huge.status}`);
const svg = await pub({ action: 'report-photo', token: 'a'.repeat(64), ticketId: crypto.randomUUID(), dataUrl: 'data:image/svg+xml;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') });
check('SVG/script upload is refused', refused(svg, 400), `HTTP ${svg.status}`);

// ---------- 4. webhooks ----------
console.log('\nPayment webhooks');
const fake = JSON.stringify({ event: 'charge.success', data: { reference: 'sfs_' + '0'.repeat(32), amount: 100, channel: 'card' } });
for (const [name, header] of [
  ['paystack-webhook', { 'x-paystack-signature': 'deadbeef' }],
  ['paystack-webhook', {}],
  ['bachs-webhook', { 'x-bachs-signature-v2': 't=1,v1=deadbeef' }],
]) {
  const r = await statusOf(fetch(`${SUPABASE}/functions/v1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...header }, body: fake }));
  check(`Forged ${name} call is refused`, refused(r, 400, 401, 404), r.status === 404 ? 'not deployed' : `HTTP ${r.status}`);
}

// ---------- 5. rate limiting (opt-in) ----------
if (flag('burst')) {
  console.log('\nRate limiting (70 link views with a made-up token; creates no data)');
  let first429 = 0;
  for (let i = 1; i <= 70 && !first429; i++) if ((await pub({ action: 'view', token: 'c'.repeat(64) })).status === 429) first429 = i;
  check('A burst from one client is cut off with 429', first429 > 0, first429 ? `after ${first429} requests` : 'never limited');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
