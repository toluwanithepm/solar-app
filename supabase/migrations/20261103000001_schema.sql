-- Core schema for the Solar Installer Field Service Platform.
-- Mirrors src/data/types.ts. Every tenant table carries firm_id, which defaults to the caller's firm
-- from the login token (app.firm_id(), defined in the security migration) and is checked by row-level security.

create schema if not exists app;

-- Placeholder so column defaults can reference it; replaced with the real claim reader in the security migration.
create or replace function app.firm_id() returns uuid language sql stable as $$ select null::uuid $$;

-- ---------- enums (labels match the TypeScript string unions) ----------

create type public.staff_role as enum ('owner', 'office', 'technician', 'viewer');
create type public.item_category as enum ('panel', 'battery', 'inverter', 'accessory', 'service');
create type public.lead_stage as enum ('New', 'Surveyed', 'Quoted', 'Won', 'Lost');
create type public.lead_source as enum ('Call', 'WhatsApp', 'Walk-in', 'Web form', 'Referral');
create type public.property_type as enum ('Home', 'Shop', 'Office', 'Clinic', 'School', 'Other');
create type public.photo_kind as enum ('roof', 'db', 'wiring', 'before', 'after', 'fault', 'proof', 'other');
create type public.quote_status as enum ('Draft', 'Sent', 'Accepted', 'Declined', 'Expired');
create type public.job_type as enum ('Installation', 'Maintenance', 'Fault repair', 'Site survey');
create type public.job_status as enum ('Unscheduled', 'Scheduled', 'In progress', 'Done', 'Cancelled');
create type public.ticket_status as enum ('Open', 'Scheduled', 'Resolved');
create type public.ticket_channel as enum ('Link', 'WhatsApp', 'Call');
create type public.invoice_kind as enum ('Deposit', 'Balance', 'Instalment', 'Extras', 'Maintenance plan', 'Service');
create type public.payment_method as enum ('Card', 'Transfer', 'USSD', 'Cash', 'Bank transfer (outside app)');
create type public.payment_status as enum ('Confirmed', 'Pending approval', 'Rejected');
create type public.message_channel as enum ('WhatsApp', 'SMS');
create type public.message_status as enum ('queued', 'sent', 'failed');
create type public.audit_entity as enum ('quote', 'price', 'payment', 'invoice');
create type public.link_kind as enum ('quote', 'invoice', 'handover', 'fault_report');

-- ---------- firm and people ----------

create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  logo_path text,
  address text not null default '',
  state text not null default 'Lagos',
  phone text not null default '',
  bank_name text not null default '',
  account_number text not null default '',
  account_name text not null default '',
  follow_up_days int not null default 3 check (follow_up_days between 1 and 60),
  service_interval_months int not null default 6 check (service_interval_months between 1 and 24),
  labour_price numeric(14, 2) not null default 0 check (labour_price >= 0),
  transport_price numeric(14, 2) not null default 0 check (transport_price >= 0),
  default_valid_days int not null default 14 check (default_valid_days between 1 and 180),
  default_deposit_pct int not null default 50 check (default_deposit_pct between 0 and 100),
  subscription_status text not null default 'trial' check (subscription_status in ('trial', 'active', 'past_due')),
  subscription_seats int not null default 3 check (subscription_seats >= 1),
  trial_ends_at timestamptz not null default now() + interval '14 days',
  paid_until timestamptz,
  setup_completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  auth_user_id uuid unique,
  name text not null check (length(trim(name)) > 0),
  -- E.164, e.g. +2348031234567. One phone signs in to one firm.
  phone text not null unique check (phone ~ '^\+234[0-9]{10}$'),
  role public.staff_role not null,
  title text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.staff (firm_id);

-- ---------- price list (E1-2); cost is split out so technicians and office staff never receive it (NFR-10) ----------

create table public.price_items (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  category public.item_category not null,
  brand text not null,
  model text not null,
  watts numeric,
  ah numeric,
  volts numeric,
  kwh numeric,
  kva numeric,
  price numeric(14, 2) not null check (price >= 0),
  warranty_years int not null default 0 check (warranty_years between 0 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.price_items (firm_id);

create table public.price_item_costs (
  item_id uuid primary key references public.price_items on delete cascade,
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  cost numeric(14, 2) not null check (cost >= 0)
);

-- ---------- leads and surveys (E2, E3) ----------

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text not null,
  location text not null default '',
  address text not null default '',
  state text not null default 'Lagos',
  source public.lead_source not null,
  property_type public.property_type not null default 'Home',
  stage public.lead_stage not null default 'New',
  notes text,
  -- NDPA 2023 consent to WhatsApp messages (NFR-13)
  whatsapp_consent boolean not null default false,
  created_by uuid references public.staff on delete set null,
  created_at timestamptz not null default now()
);
create index on public.leads (firm_id, stage);

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  lead_id uuid not null references public.leads on delete cascade,
  job_id uuid,
  technician_id uuid not null references public.staff,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  appliances jsonb not null default '[]',
  state text not null,
  sun_hours numeric not null,
  backup_hours numeric not null,
  peak_w numeric not null default 0,
  daily_wh numeric not null default 0,
  recommended jsonb not null,
  override jsonb,
  notes text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index on public.surveys (firm_id, lead_id);

-- ---------- quotes (E4) ----------

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  number text not null,
  lead_id uuid not null references public.leads on delete cascade,
  survey_id uuid references public.surveys on delete set null,
  status public.quote_status not null default 'Draft',
  valid_days int not null default 14 check (valid_days between 1 and 180),
  deposit_pct int not null default 50 check (deposit_pct between 0 and 100),
  selected_option_id uuid,
  sent_at timestamptz,
  accepted_at timestamptz,
  last_follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, number)
);
create index on public.quotes (firm_id, status);

create table public.quote_options (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  quote_id uuid not null references public.quotes on delete cascade,
  position int not null default 0,
  name text not null,
  backup_hours numeric not null default 0
);
create index on public.quote_options (quote_id);

alter table public.quotes
  add constraint quotes_selected_option_fk foreign key (selected_option_id) references public.quote_options on delete set null deferrable initially deferred;

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  option_id uuid not null references public.quote_options on delete cascade,
  position int not null default 0,
  item_id uuid references public.price_items on delete set null,
  category public.item_category not null,
  description text not null,
  qty numeric not null check (qty > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0)
);
create index on public.quote_lines (option_id);

create table public.quote_line_costs (
  line_id uuid primary key references public.quote_lines on delete cascade,
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  unit_cost numeric(14, 2) not null check (unit_cost >= 0)
);

-- ---------- installations, plans and tickets (E7, E8) ----------

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  name text not null,
  price numeric(14, 2) not null check (price >= 0),
  visits_per_year int not null check (visits_per_year between 1 and 12)
);

create table public.installations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  lead_id uuid not null references public.leads on delete cascade,
  job_id uuid not null,
  installed_at timestamptz not null,
  site text not null default '',
  service_interval_months int not null default 6,
  next_service_at timestamptz not null,
  last_service_reminder_at timestamptz,
  plan_id uuid references public.plans on delete set null,
  plan_started_at timestamptz,
  plan_renews_at timestamptz,
  plan_visits_left int,
  last_renewal_reminder_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.installations (firm_id, next_service_at);

create table public.installation_technicians (
  installation_id uuid not null references public.installations on delete cascade,
  staff_id uuid not null references public.staff on delete cascade,
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  primary key (installation_id, staff_id)
);

create table public.installation_items (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  installation_id uuid not null references public.installations on delete cascade,
  label text not null,
  category public.item_category not null,
  serial text,
  warranty_years int not null default 0,
  warranty_ends_at timestamptz not null
);
create index on public.installation_items (installation_id);
create index on public.installation_items (firm_id, warranty_ends_at);
create index on public.installation_items (firm_id, serial);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  number text not null,
  installation_id uuid references public.installations on delete set null,
  lead_id uuid not null references public.leads on delete cascade,
  description text not null,
  channel public.ticket_channel not null,
  status public.ticket_status not null default 'Open',
  job_id uuid,
  created_at timestamptz not null default now(),
  unique (firm_id, number)
);

create table public.ticket_updates (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  ticket_id uuid not null references public.tickets on delete cascade,
  at timestamptz not null default now(),
  text text not null
);

-- ---------- jobs and field data (E5, E6) ----------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  number text not null,
  lead_id uuid not null references public.leads on delete cascade,
  type public.job_type not null,
  status public.job_status not null default 'Unscheduled',
  quote_id uuid references public.quotes on delete set null,
  installation_id uuid references public.installations on delete set null,
  ticket_id uuid references public.tickets on delete set null,
  -- Office-owned scheduling fields
  start_at timestamptz,
  duration_hours numeric not null default 2 check (duration_hours > 0 and duration_hours <= 24),
  address text not null default '',
  lat double precision,
  lng double precision,
  equipment jsonb not null default '[]',
  notes text,
  -- Field-owned fields: written from the technician's phone and never overwritten by the office (NFR-2)
  checklist jsonb not null default '[]',
  check_in_at timestamptz,
  check_in_lat double precision,
  check_in_lng double precision,
  check_out_at timestamptz,
  check_out_lat double precision,
  check_out_lng double precision,
  signature_path text,
  signature_name text,
  signed_at timestamptz,
  completed_at timestamptz,
  sync_conflict text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, number)
);
create index on public.jobs (firm_id, start_at);
create index on public.jobs (firm_id, status);

alter table public.installations add constraint installations_job_fk foreign key (job_id) references public.jobs on delete cascade;
alter table public.tickets add constraint tickets_job_fk foreign key (job_id) references public.jobs on delete set null;
alter table public.surveys add constraint surveys_job_fk foreign key (job_id) references public.jobs on delete set null;

create table public.job_assignees (
  job_id uuid not null references public.jobs on delete cascade,
  staff_id uuid not null references public.staff on delete cascade,
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  primary key (job_id, staff_id)
);
create index on public.job_assignees (staff_id);

create table public.job_serials (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  job_id uuid not null references public.jobs on delete cascade,
  label text not null,
  category public.item_category not null,
  item_id uuid references public.price_items on delete set null,
  serial text not null check (length(trim(serial)) > 0),
  method text not null check (method in ('scan', 'manual')),
  warranty_years int not null default 0,
  created_at timestamptz not null default now(),
  unique (firm_id, serial)
);
create index on public.job_serials (job_id);

create table public.job_extras (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  job_id uuid not null references public.jobs on delete cascade,
  description text not null,
  qty numeric not null check (qty > 0),
  item_id uuid references public.price_items on delete set null,
  flagged_for_invoice boolean not null default true,
  invoice_id uuid
);

-- ---------- money (E9) ----------

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  number text not null,
  lead_id uuid not null references public.leads on delete cascade,
  quote_id uuid references public.quotes on delete set null,
  job_id uuid references public.jobs on delete set null,
  kind public.invoice_kind not null,
  description text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  issued_at timestamptz not null default now(),
  due_at timestamptz not null,
  -- Day offsets (0, 3, 7) for which a reminder went out (E9-3)
  reminders_sent int[] not null default '{}',
  unique (firm_id, number)
);
create index on public.invoices (firm_id, due_at);
create index on public.invoices (job_id);

alter table public.job_extras add constraint job_extras_invoice_fk foreign key (invoice_id) references public.invoices on delete set null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  invoice_id uuid not null references public.invoices on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  method public.payment_method not null,
  at timestamptz not null default now(),
  status public.payment_status not null,
  reference text not null,
  -- Gateway transaction reference; unique so webhook retries are idempotent
  gateway_reference text unique,
  recorded_by uuid references public.staff on delete set null,
  approved_by uuid references public.staff on delete set null,
  created_at timestamptz not null default now(),
  unique (firm_id, reference)
);
create index on public.payments (invoice_id);

-- ---------- photos (E3-3, E6-4, E8-3, E9-4); files live in Storage ----------

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  kind public.photo_kind not null,
  storage_path text,
  bytes int not null default 0 check (bytes <= 307200),
  taken_at timestamptz not null,
  lat double precision,
  lng double precision,
  survey_id uuid references public.surveys on delete cascade,
  job_id uuid references public.jobs on delete cascade,
  ticket_id uuid references public.tickets on delete cascade,
  payment_id uuid references public.payments on delete cascade,
  uploaded_by uuid references public.staff on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(survey_id, job_id, ticket_id, payment_id) = 1)
);
create index on public.photos (job_id);
create index on public.photos (survey_id);

-- ---------- messaging, notifications, audit ----------

-- Outbox for WhatsApp/SMS; a worker sends queued rows (Phase 5)
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  channel public.message_channel not null default 'WhatsApp',
  to_phone text not null,
  to_name text not null default '',
  text text not null,
  link text,
  topic text not null,
  status public.message_status not null default 'queued',
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on public.messages (status, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  text text not null,
  link text,
  for_roles public.staff_role[] not null default '{owner,office}',
  created_at timestamptz not null default now()
);

create table public.notification_reads (
  notification_id uuid not null references public.notifications on delete cascade,
  staff_id uuid not null references public.staff on delete cascade,
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, staff_id)
);

-- E11-3: written only by triggers; nobody can edit or delete
create table public.audit_log (
  id bigint generated always as identity primary key,
  firm_id uuid not null references public.firms on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid references public.staff on delete set null,
  entity public.audit_entity not null,
  table_name text not null,
  entity_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  summary text not null,
  before jsonb,
  after jsonb
);
create index on public.audit_log (firm_id, at desc);

-- ---------- configuration ----------

create table public.checklist_templates (
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  job_type public.job_type not null,
  steps jsonb not null default '[]',
  primary key (firm_id, job_type)
);

create table public.counters (
  firm_id uuid not null references public.firms on delete cascade,
  prefix text not null,
  value bigint not null,
  primary key (firm_id, prefix)
);

-- Unguessable tokens for customer-facing links; replaces raw ids in /q/:id, /pay/:id (Phase 3)
create table public.public_links (
  token text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  firm_id uuid not null default app.firm_id() references public.firms on delete cascade,
  kind public.link_kind not null,
  target_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
create index on public.public_links (firm_id, kind, target_id);

-- ---------- updated_at ----------

create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger touch before update on public.price_items for each row execute function app.touch_updated_at();
create trigger touch before update on public.quotes for each row execute function app.touch_updated_at();
create trigger touch before update on public.jobs for each row execute function app.touch_updated_at();
