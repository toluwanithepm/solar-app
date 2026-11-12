# Solar Field Service

**Run a solar installation business from one app.** Quotes, scheduling, technician field work, warranties, maintenance and payments, in place of WhatsApp threads, paper job cards and Excel. Built for Nigerian installer firms with roughly 3–50 technicians.

---

## Why this exists

Solar is how Nigerian homes and small businesses keep the lights on. The country added **803 MW of solar in 2025, up 141% on the year before, and most of it off-grid** ([Ecofin](https://www.ecofinagency.com/news-industry/0402-52577-nigeria-adds-803-mw-of-solar-capacity-in-2025-with-off-grid-systems-dominating)). Most of that capacity is sold, installed and serviced by small and mid-sized installer firms.

Those firms run on WhatsApp, voice notes, paper job cards and Excel, and that costs them money at every step:

| Who | What they're trying to do | What goes wrong today |
|---|---|---|
| **The owner** (e.g. a Lagos firm with 8 technicians) | Win more jobs, get paid in full, grow repeat revenue | Quotes take days, so customers go elsewhere. Balances go unpaid. No idea which customers are due a service. |
| **The office / sales staff** | Turn enquiries into booked jobs quickly | Quotes are rebuilt by hand in Excel. Technicians get double-booked. Leads get lost in chat threads. |
| **The technician** | Know where to go and what to install, and prove the job was done | Instructions arrive as WhatsApp voice notes. Patchy data on a cheap phone. Disputes about what was actually installed. |
| **The end customer** | Know when the team is coming, what they paid for and who to call | No warranty record. Can't reach the installer after handover. |

Put together, this means:

- **Lost sales:** slow quotes and forgotten follow-ups lose customers.
- **Lost cash:** deposits and balances are chased by hand.
- **Lost repeat revenue:** nobody tracks which systems are due a service.
- **Lost trust:** there's no proof of work and no warranty record.

## What the product does

The app follows one customer journey from first contact to aftercare, and every screen shows where a customer is and the next step to take:

1. **Enquiry.** Calls, walk-ins and a shareable web enquiry form all land in one customer list. Nothing is lost in a chat thread.
2. **Site survey.** A technician records the appliances and photos on their phone. The app sizes the inverter, batteries and panels from the load and the local sun hours.
3. **Quote.** The office turns the survey into a branded quote with up to three options (Basic / Recommended / Premium) in minutes, with margin visible to the owner only, and sends it as a WhatsApp link.
4. **Deposit.** The customer accepts on their phone and pays the deposit by card, bank transfer or USSD (Paystack). That creates the installation job.
5. **Installation.** Jobs are dragged onto technicians on a schedule board. Technicians follow a checklist, scan serial numbers, take photos and get a signature. All of it works **offline** and syncs when the signal returns.
6. **Aftercare.** Every system is registered with serial numbers and warranty dates. Service and payment reminders are prepared automatically (sending them by WhatsApp/SMS is Phase 5), maintenance plans bring recurring income, and customers report faults from a link.

### The goals behind it

- A professional quote **within 15 minutes** of a site visit.
- **Photo proof, a serial-number record and a signed handover** on every job.
- **Maintenance reminders on every installation**, turning one-off jobs into repeat revenue.
- **Deposits and balances collected through the app**, so the payment history can later support customer financing.

### How we'll know it's working (first 12 months after launch)

| Metric | Target |
|---|---|
| Paying installer firms | 300 |
| Jobs completed in the app per active firm per month | ≥ 15 |
| Quote-to-job conversion for firms using the quote builder | +20% against their own baseline |
| Installations with a maintenance plan | ≥ 30% |
| Share of firm revenue collected through app payment links | ≥ 40% |
| Monthly logo churn | ≤ 4% |

### Business model

- **Subscription:** a 14-day free trial, then **₦7,500 per technician per month**. Office staff are included. Firms pay in the app through Paystack.
- **Still open:** whether to also take a small share of payments collected (for example 0.5%), and whether a flat firm price works better than per-technician pricing.
- **Later:** distributor partnerships (registering warranties and seeing where stock is installed), and financing built on the payment history.

### Deliberately not in the first version

- Remote monitoring of inverters and batteries.
- Full accounting and payroll.
- Mini-grid and utility-scale project management.
- A native iOS app.

The technician app ships as an installable web app (PWA) for now. An Android wrapper (Capacitor) is in the repo but not in use.

---

## The product, by surface

| Surface | Who uses it | Highlights |
|---|---|---|
| **Office web app** (`/office`) | Owner, office staff, viewer/accountant | Home dashboard and to-do list, customers with journey and next step, quote builder, Jobs board, Aftercare, Money, reports, settings, Help & FAQ, guided tour. Dark mode. |
| **Technician app** (`/tech`) | Technicians | Today's jobs, checklist, serial scanning (built-in barcode reader), photos with GPS, signature handover, site survey and load calculator. Works offline on low-end phones. |
| **Customer pages** (`/q`, `/pay`, `/handover`, `/report`, `/enquire`) | End customers | Quote with options, online payment, handover report, fault reporting, enquiry form. No app or login needed. |

**Roles:**
- Owners see costs and margins.
- Office staff build quotes but never see costs.
- Technicians never receive prices at all.
- These rules are enforced in the database, not just hidden in the screens.

---

## Tech overview

- **Frontend:** React 19, TypeScript, Vite, React Router. Inter font, Lucide icons, its own token-based design system with light and dark themes. Hosted on Vercel.
- **Backend:** Supabase.
  - Postgres with row-level security per firm and role.
  - Phone sign-in by one-time code. A custom access-token hook puts the firm and role into each sign-in token.
  - Storage for photos, signatures and logos.
  - Live updates (Realtime) and scheduled reminders (pg_cron).
- **Edge Functions (Deno):** customer link pages, Paystack and Bachs payment webhooks.
- **Offline:** the technician's data is kept on the phone in IndexedDB, encrypted with AES-GCM. Changes queue in an offline outbox and are sent in one transaction per job. A service worker lets the app open with no signal. Owners can remotely sign a lost phone out and wipe it.

### Repository layout

```
src/
  screens/office|tech|customer   screens for each surface
  components/                    shared UI (shell, navigation, tooltips, tour, loading)
  data/                          store, domain rules, customer journey, glossary
  data/remote/                   Supabase sync, offline outbox, encrypted device copy
  styles/                        design tokens and component styles
supabase/
  migrations/                    schema, security, auth hook, audit, sync, public links, field, remote wipe
  functions/                     public, paystack-webhook, bachs-webhook
  tests/                         database tests (PGlite)
public/                          PWA manifest, icons, service worker
```

### Run it locally

```bash
npm install
```

```bash
npm run dev
```

- **Demo mode:** with no Supabase settings, the app runs on built-in sample data saved in the browser. Pick a demo account on the landing page.
- **Live mode:** to use a real Supabase project, create `.env.local` with:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_PUBLIC_APP_URL=https://<your site>
```

Other commands:

| Command | What it does |
|---|---|
| `npm run build` | Typecheck and production build |
| `npm run test:db` | Database tests: migrations and access rules for each role, run in Postgres-in-WebAssembly |
| `npm run db:seed` | Regenerate `supabase/seed.sql` from the demo data |
| `npx supabase db push --linked` | Apply new migrations to the linked Supabase project |
| `npm run test:security` | Security tests (see below) |
| `npm run security:probe -- --site <url>` | Probe the deployed site and Supabase project from outside (read-only; add `--burst` to check rate limiting) |

### Security testing

`npm run test:security` attacks the real migrations and request handlers, offline. It covers:
- **Database hardening:** row-level security on every table, pinned `search_path` on owner-rights functions, and service-only functions locked away from users.
- **SQL injection:** through the batch-save function, link tokens and the enquiry form.
- **Access control:** reading or changing another firm's data, privilege escalation, planting rows in another firm, subscription tampering, and audit-log tampering.
- **Public API abuse:** malformed input, oversized or disguised uploads, leaked error details, and per-client rate limiting.
- **Webhook forgery:** missing, wrong, tampered and replayed signatures.
- **Unsafe links:** links built from stored data.

`npm run security:probe` runs a similar set of attacks against the live deployment. It also checks the browser security headers (`vercel.json`) and scans the shipped JavaScript for leaked keys.

Defences in place:
- Row-level security for every firm and role.
- Owner-rights functions that only the server can call.
- Per-client rate limits on the public link API, using a hashed IP address and a fixed window (`RATE_LIMITS` in `supabase/functions/_shared/handlers.ts`), on top of the per-firm limits on enquiries and fault reports.
- Signature and freshness checks on payment webhooks.
- Uploads must be real JPEGs of at most 300 KB.
- A strict Content-Security-Policy with no inline scripts, no framing and no plugins.
- Phone sign-in rate limits come from Supabase Auth (Dashboard → Authentication → Rate Limits).

Hosted builds need the same three `VITE_` variables set in Vercel. Without them the site runs in demo mode and shows a "Demo mode" warning. The Edge Functions need these secrets:
- `PAYSTACK_SECRET_KEY`
- `PUBLIC_APP_URL`
- `PAYMENT_PROVIDER` (optional)
- `BACHS_API_KEY` and `BACHS_WEBHOOK_SECRET`, for Bachs

Never put the Supabase `service_role` key or the database password in the frontend or in Vercel.

---

## Status and roadmap

- ✅ **Phase 1:** database, security and phone sign-in
- ✅ **Phase 2:** office app on live data
- ✅ **Phase 3:** customer links and online payments
- ✅ **Phase 4:** offline technician app, server-side job completion, remote wipe. A real-phone test with no signal is still pending.
- ⬜ **Phase 5:** automatic WhatsApp (Meta Cloud API) and SMS messages. Today the app prepares the messages and opens WhatsApp for staff to send.
- ⬜ **Phase 6:** hardening, covering backups, monitoring, rate limits, a security review and load tests.
