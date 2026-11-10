// Maps between database rows (supabase/migrations) and the app's DB shape (src/data/types.ts).
// fromRemote() builds the app snapshot from table rows; flatten() turns a snapshot back into rows so changes can be diffed.
import type {
  AuditEntry,
  Company,
  DB,
  Installation,
  Invoice,
  Job,
  Lead,
  Message,
  Notification,
  Payment,
  Photo,
  PriceItem,
  Quote,
  Role,
  Survey,
  Ticket,
  User,
} from '../types';

export type Row = Record<string, unknown>;
export type RawTables = Record<string, Row[]>;
export type Ctx = { firmId: string; staffId: string; role: Role };

/** Tables in foreign-key order: inserts and updates run in this order, deletes in reverse. */
export const TABLES = [
  'firms',
  'staff',
  'price_items',
  'price_item_costs',
  'plans',
  'checklist_templates',
  'leads',
  'surveys',
  'quotes',
  'quote_options',
  'quote_lines',
  'quote_line_costs',
  'jobs',
  'job_assignees',
  'installations',
  'installation_items',
  'installation_technicians',
  'tickets',
  'ticket_updates',
  'job_serials',
  'invoices',
  'job_extras',
  'payments',
  'photos',
  'messages',
  'notifications',
  'notification_reads',
] as const;
export type Table = (typeof TABLES)[number];

/** Tables read on load but never written by the app (audit is trigger-only). */
export const READ_ONLY_TABLES = ['audit_log'] as const;

export const KEYS: Partial<Record<Table, string[]>> = {
  price_item_costs: ['item_id'],
  quote_line_costs: ['line_id'],
  checklist_templates: ['job_type'],
  job_assignees: ['job_id', 'staff_id'],
  installation_technicians: ['installation_id', 'staff_id'],
  notification_reads: ['notification_id', 'staff_id'],
};
export const keyCols = (t: Table) => KEYS[t] ?? ['id'];
export const keyOf = (t: Table, r: Row) => keyCols(t).map((k) => String(r[k])).join('|');

/** Only the owner can read or write cost tables (E4-5, NFR-10). */
const OWNER_ONLY: Table[] = ['price_item_costs', 'quote_line_costs'];

// ---------- small helpers ----------

/** 0803 123 4567 → +2348031234567 (database format) */
export const toE164 = (p: string) => {
  const d = p.replace(/\D/g, '');
  if (/^234\d{10}$/.test(d)) return `+${d}`;
  if (/^0\d{10}$/.test(d)) return `+234${d.slice(1)}`;
  if (/^\d{10}$/.test(d)) return `+234${d}`;
  return p;
};
/** +2348031234567 → 08031234567 (how the app shows and validates numbers) */
export const fromE164 = (p: string) => (/^\+234\d{10}$/.test(p) ? `0${p.slice(4)}` : p);

const n = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
const nz = <T>(v: T | undefined) => (v === undefined ? null : v);

/** Deterministic UUID-shaped id from a string, for child rows the app stores without ids. */
export function stableUuid(input: string) {
  const h = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < input.length; i++) {
      const ch = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  };
  const x = h(1) + h(2);
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-a${x.slice(17, 20)}-${x.slice(20, 32)}`;
}

const by = <T extends Row>(rows: T[] | undefined, col: string) => {
  const m = new Map<string, T[]>();
  for (const r of rows ?? []) {
    const k = String(r[col]);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
};
const byPosition = (a: Row, b: Row) => Number(a.position ?? 0) - Number(b.position ?? 0);

// ---------- rows → app snapshot ----------

/**
 * Build the app's DB from table rows visible to the signed-in user.
 * `fileUrl` turns a storage path into a viewable URL (signed or public).
 */
export function fromRemote(raw: RawTables, ctx: Ctx, fileUrl: (bucket: string, path: string) => string = () => ''): DB {
  const t = (name: string) => raw[name] ?? [];
  const costs = new Map(t('price_item_costs').map((r) => [String(r.item_id), Number(r.cost)]));
  const lineCosts = new Map(t('quote_line_costs').map((r) => [String(r.line_id), Number(r.unit_cost)]));
  const photosBy = (col: string) => by(t('photos').filter((p) => p[col]), col);
  const surveyPhotos = photosBy('survey_id');
  const jobPhotos = photosBy('job_id');
  const ticketPhotos = photosBy('ticket_id');
  const paymentPhotos = photosBy('payment_id');
  const options = by(t('quote_options'), 'quote_id');
  const lines = by(t('quote_lines'), 'option_id');
  const assignees = by(t('job_assignees'), 'job_id');
  const serials = by(t('job_serials'), 'job_id');
  const extras = by(t('job_extras'), 'job_id');
  const items = by(t('installation_items'), 'installation_id');
  const insTechs = by(t('installation_technicians'), 'installation_id');
  const updates = by(t('ticket_updates'), 'ticket_id');
  const reads = new Set(t('notification_reads').filter((r) => r.staff_id === ctx.staffId).map((r) => String(r.notification_id)));

  const photo = (r: Row): Photo => ({
    id: String(r.id),
    kind: r.kind as Photo['kind'],
    storagePath: s(r.storage_path),
    dataUrl: r.storage_path ? fileUrl('photos', String(r.storage_path)) : '',
    bytes: Number(r.bytes ?? 0),
    takenAt: String(r.taken_at),
    gps: r.lat != null && r.lng != null ? { lat: Number(r.lat), lng: Number(r.lng) } : undefined,
    uploaded: true,
  });

  const f = t('firms')[0] ?? {};
  const company: Company = {
    name: String(f.name ?? ''),
    logoPath: s(f.logo_path),
    logoDataUrl: f.logo_path ? fileUrl('logos', String(f.logo_path)) : undefined,
    address: String(f.address ?? ''),
    state: String(f.state ?? 'Lagos'),
    phone: fromE164(String(f.phone ?? '')),
    bankName: String(f.bank_name ?? ''),
    accountNumber: String(f.account_number ?? ''),
    accountName: String(f.account_name ?? ''),
    followUpDays: Number(f.follow_up_days ?? 3),
    serviceIntervalMonths: Number(f.service_interval_months ?? 6),
    labourPrice: Number(f.labour_price ?? 0),
    transportPrice: Number(f.transport_price ?? 0),
    defaultValidDays: Number(f.default_valid_days ?? 14),
    defaultDepositPct: Number(f.default_deposit_pct ?? 50),
    subscription: {
      status: (f.subscription_status as Company['subscription']['status']) ?? 'trial',
      seats: Number(f.subscription_seats ?? 1),
      trialEndsAt: String(f.trial_ends_at ?? new Date().toISOString()),
      paidUntil: s(f.paid_until),
    },
    setupCompletedAt: s(f.setup_completed_at),
  };

  const users: User[] = t('staff').map((r) => ({
    id: String(r.id),
    name: String(r.name),
    phone: fromE164(String(r.phone)),
    role: r.role as Role,
    title: String(r.title ?? ''),
    active: Boolean(r.active),
  }));

  const priceItems: PriceItem[] = t('price_items').map((r) => ({
    id: String(r.id),
    category: r.category as PriceItem['category'],
    brand: String(r.brand),
    model: String(r.model),
    watts: n(r.watts),
    ah: n(r.ah),
    volts: n(r.volts),
    kwh: n(r.kwh),
    kva: n(r.kva),
    cost: costs.get(String(r.id)) ?? 0,
    price: Number(r.price),
    warrantyYears: Number(r.warranty_years ?? 0),
  }));

  const leads: Lead[] = t('leads').map((r) => ({
    id: String(r.id),
    name: String(r.name),
    phone: fromE164(String(r.phone)),
    location: String(r.location ?? ''),
    address: String(r.address ?? ''),
    state: String(r.state ?? 'Lagos'),
    source: r.source as Lead['source'],
    propertyType: r.property_type as Lead['propertyType'],
    stage: r.stage as Lead['stage'],
    notes: s(r.notes),
    whatsappConsent: Boolean(r.whatsapp_consent),
    createdAt: String(r.created_at),
  }));

  const surveys: Survey[] = t('surveys').map((r) => ({
    id: String(r.id),
    leadId: String(r.lead_id),
    jobId: s(r.job_id),
    technicianId: String(r.technician_id),
    createdAt: String(r.created_at),
    status: r.status as Survey['status'],
    appliances: ((r.appliances as Survey['appliances']) ?? []).map((a, i) => ({ ...a, id: a.id ?? `a${i}` })),
    state: String(r.state),
    sunHours: Number(r.sun_hours),
    backupHours: Number(r.backup_hours),
    peakW: Number(r.peak_w),
    dailyWh: Number(r.daily_wh),
    recommended: r.recommended as Survey['recommended'],
    override: (r.override as Survey['override']) ?? undefined,
    photos: (surveyPhotos.get(String(r.id)) ?? []).map(photo),
    notes: s(r.notes),
  }));

  const quotes: Quote[] = t('quotes').map((r) => ({
    id: String(r.id),
    number: String(r.number),
    leadId: String(r.lead_id),
    surveyId: s(r.survey_id),
    createdAt: String(r.created_at),
    status: r.status as Quote['status'],
    validDays: Number(r.valid_days),
    depositPct: Number(r.deposit_pct),
    selectedOptionId: s(r.selected_option_id),
    sentAt: s(r.sent_at),
    acceptedAt: s(r.accepted_at),
    lastFollowUpAt: s(r.last_follow_up_at),
    options: (options.get(String(r.id)) ?? []).sort(byPosition).map((o) => ({
      id: String(o.id),
      name: String(o.name),
      backupHours: Number(o.backup_hours),
      lines: (lines.get(String(o.id)) ?? []).sort(byPosition).map((l) => ({
        id: String(l.id),
        itemId: s(l.item_id),
        category: l.category as PriceItem['category'],
        description: String(l.description),
        qty: Number(l.qty),
        unitPrice: Number(l.unit_price),
        unitCost: lineCosts.get(String(l.id)) ?? 0,
      })),
    })),
  }));

  const gps = (lat: unknown, lng: unknown) => (lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : undefined);
  const jobs: Job[] = t('jobs').map((r) => ({
    id: String(r.id),
    number: String(r.number),
    leadId: String(r.lead_id),
    type: r.type as Job['type'],
    status: r.status as Job['status'],
    quoteId: s(r.quote_id),
    installationId: s(r.installation_id),
    ticketId: s(r.ticket_id),
    start: s(r.start_at),
    durationHours: Number(r.duration_hours),
    assigneeIds: (assignees.get(String(r.id)) ?? []).map((a) => String(a.staff_id)),
    address: String(r.address ?? ''),
    gps: gps(r.lat, r.lng),
    equipment: (r.equipment as Job['equipment']) ?? [],
    checklist: (r.checklist as Job['checklist']) ?? [],
    checkIn: r.check_in_at ? { at: String(r.check_in_at), gps: gps(r.check_in_lat, r.check_in_lng) } : undefined,
    checkOut: r.check_out_at ? { at: String(r.check_out_at), gps: gps(r.check_out_lat, r.check_out_lng) } : undefined,
    serials: (serials.get(String(r.id)) ?? []).map((x) => ({
      id: String(x.id),
      label: String(x.label),
      category: x.category as PriceItem['category'],
      itemId: s(x.item_id),
      serial: String(x.serial),
      method: x.method as 'scan' | 'manual',
      warrantyYears: Number(x.warranty_years ?? 0),
    })),
    photos: (jobPhotos.get(String(r.id)) ?? []).map(photo),
    signature: r.signature_name
      ? {
          name: String(r.signature_name),
          at: String(r.signed_at ?? r.completed_at ?? ''),
          storagePath: s(r.signature_path),
          dataUrl: r.signature_path ? fileUrl('signatures', String(r.signature_path)) : '',
        }
      : undefined,
    extras: (extras.get(String(r.id)) ?? []).map((x) => ({
      id: String(x.id),
      description: String(x.description),
      qty: Number(x.qty),
      itemId: s(x.item_id),
      flaggedForInvoice: Boolean(x.flagged_for_invoice),
      invoiceId: s(x.invoice_id),
    })),
    completedAt: s(r.completed_at),
    pendingSync: false,
    syncConflict: s(r.sync_conflict),
    handoverPlanId: s(r.handover_plan_id),
    notes: s(r.notes),
    updatedAt: String(r.updated_at ?? r.created_at),
  }));

  const installations: Installation[] = t('installations').map((r) => ({
    id: String(r.id),
    leadId: String(r.lead_id),
    jobId: String(r.job_id),
    installedAt: String(r.installed_at),
    technicianIds: (insTechs.get(String(r.id)) ?? []).map((x) => String(x.staff_id)),
    site: String(r.site ?? ''),
    items: (items.get(String(r.id)) ?? []).map((x) => ({
      id: String(x.id),
      label: String(x.label),
      category: x.category as PriceItem['category'],
      serial: s(x.serial),
      warrantyYears: Number(x.warranty_years ?? 0),
      warrantyEndsAt: String(x.warranty_ends_at),
    })),
    photoIds: (jobPhotos.get(String(r.job_id)) ?? []).map((p) => String(p.id)),
    serviceIntervalMonths: Number(r.service_interval_months),
    nextServiceAt: String(r.next_service_at),
    lastServiceReminderAt: s(r.last_service_reminder_at),
    planId: s(r.plan_id),
    planStartedAt: s(r.plan_started_at),
    planRenewsAt: s(r.plan_renews_at),
    planVisitsLeft: n(r.plan_visits_left),
    lastRenewalReminderAt: s(r.last_renewal_reminder_at),
  }));

  const tickets: Ticket[] = t('tickets').map((r) => ({
    id: String(r.id),
    number: String(r.number),
    installationId: s(r.installation_id),
    leadId: String(r.lead_id),
    description: String(r.description),
    channel: r.channel as Ticket['channel'],
    photos: (ticketPhotos.get(String(r.id)) ?? []).map(photo),
    createdAt: String(r.created_at),
    status: r.status as Ticket['status'],
    jobId: s(r.job_id),
    updates: (updates.get(String(r.id)) ?? [])
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .map((u) => ({ id: String(u.id), at: String(u.at), text: String(u.text) })),
  }));

  const invoices: Invoice[] = t('invoices').map((r) => ({
    id: String(r.id),
    number: String(r.number),
    leadId: String(r.lead_id),
    quoteId: s(r.quote_id),
    jobId: s(r.job_id),
    kind: r.kind as Invoice['kind'],
    description: String(r.description),
    amount: Number(r.amount),
    issuedAt: String(r.issued_at),
    dueAt: String(r.due_at),
    remindersSent: ((r.reminders_sent as number[]) ?? []).map(Number),
  }));

  const payments: Payment[] = t('payments').map((r) => ({
    id: String(r.id),
    invoiceId: String(r.invoice_id),
    amount: Number(r.amount),
    method: r.method as Payment['method'],
    at: String(r.at),
    status: r.status as Payment['status'],
    reference: String(r.reference),
    proofPhoto: (paymentPhotos.get(String(r.id)) ?? []).map(photo)[0],
    recordedById: s(r.recorded_by),
    approvedById: s(r.approved_by),
  }));

  const messages: Message[] = t('messages').map((r) => ({
    id: String(r.id),
    at: String(r.created_at),
    channel: r.channel as Message['channel'],
    to: fromE164(String(r.to_phone)),
    toName: String(r.to_name ?? ''),
    text: String(r.text),
    link: s(r.link),
    topic: String(r.topic),
  }));

  const notifications: Notification[] = t('notifications').map((r) => ({
    id: String(r.id),
    at: String(r.created_at),
    text: String(r.text),
    link: s(r.link),
    read: reads.has(String(r.id)),
    forRoles: (r.for_roles as Role[]) ?? [],
  }));

  const audit: AuditEntry[] = t('audit_log').map((r) => ({
    id: String(r.id),
    at: String(r.at),
    userId: s(r.actor_id) ?? 'system',
    entity: r.entity as AuditEntry['entity'],
    entityId: String(r.entity_id),
    summary: String(r.summary),
    before: r.before ?? undefined,
    after: r.after ?? undefined,
  }));

  const newestFirst = <T extends { at: string }>(xs: T[]) => xs.sort((a, b) => b.at.localeCompare(a.at));

  return {
    version: 1,
    company,
    users,
    priceItems,
    leads,
    surveys,
    quotes,
    jobs,
    installations,
    plans: t('plans').map((r) => ({ id: String(r.id), name: String(r.name), price: Number(r.price), visitsPerYear: Number(r.visits_per_year) })),
    tickets,
    invoices,
    payments,
    messages: newestFirst(messages),
    notifications: newestFirst(notifications),
    audit: newestFirst(audit),
    checklistTemplates: t('checklist_templates').map((r) => ({ jobType: r.job_type as Job['type'], steps: (r.steps as never) ?? [] })),
    counters: {},
  };
}

// ---------- app snapshot → rows ----------

export type Flat = Map<Table, Map<string, Row>>;

/**
 * Rows the snapshot implies, per table, keyed by primary key. Server-owned columns (firm_id, numbers,
 * references, who-recorded/approved, subscription) are left out so the database sets them.
 */
export function flatten(db: DB, ctx: Ctx): Flat {
  const out: Flat = new Map(TABLES.map((t) => [t, new Map<string, Row>()]));
  const put = (t: Table, r: Row) => {
    if (OWNER_ONLY.includes(t) && ctx.role !== 'owner') return;
    out.get(t)!.set(keyOf(t, r), r);
  };
  const photoRow = (p: Photo, parent: Row) =>
    put('photos', {
      id: p.id,
      kind: p.kind,
      storage_path: nz(p.storagePath),
      bytes: p.bytes,
      taken_at: p.takenAt,
      lat: nz(p.gps?.lat),
      lng: nz(p.gps?.lng),
      survey_id: null,
      job_id: null,
      ticket_id: null,
      payment_id: null,
      ...parent,
    });

  const c = db.company;
  put('firms', {
    id: ctx.firmId,
    name: c.name,
    logo_path: nz(c.logoPath),
    address: c.address,
    state: c.state,
    phone: toE164(c.phone),
    bank_name: c.bankName,
    account_number: c.accountNumber,
    account_name: c.accountName,
    follow_up_days: c.followUpDays,
    service_interval_months: c.serviceIntervalMonths,
    labour_price: c.labourPrice,
    transport_price: c.transportPrice,
    default_valid_days: c.defaultValidDays,
    default_deposit_pct: c.defaultDepositPct,
    setup_completed_at: nz(c.setupCompletedAt),
  });

  for (const u of db.users) put('staff', { id: u.id, name: u.name, phone: toE164(u.phone), role: u.role, title: u.title, active: u.active });

  for (const p of db.priceItems) {
    put('price_items', {
      id: p.id,
      category: p.category,
      brand: p.brand,
      model: p.model,
      watts: nz(p.watts),
      ah: nz(p.ah),
      volts: nz(p.volts),
      kwh: nz(p.kwh),
      kva: nz(p.kva),
      price: p.price,
      warranty_years: p.warrantyYears,
    });
    put('price_item_costs', { item_id: p.id, cost: p.cost });
  }
  for (const p of db.plans) put('plans', { id: p.id, name: p.name, price: p.price, visits_per_year: p.visitsPerYear });
  for (const t of db.checklistTemplates) put('checklist_templates', { job_type: t.jobType, steps: t.steps });

  for (const l of db.leads) {
    put('leads', {
      id: l.id,
      name: l.name,
      phone: toE164(l.phone),
      location: l.location,
      address: l.address,
      state: l.state,
      source: l.source,
      property_type: l.propertyType,
      stage: l.stage,
      notes: nz(l.notes),
      whatsapp_consent: l.whatsappConsent,
      created_at: l.createdAt,
    });
  }

  for (const sv of db.surveys) {
    put('surveys', {
      id: sv.id,
      lead_id: sv.leadId,
      job_id: nz(sv.jobId),
      technician_id: sv.technicianId,
      status: sv.status,
      appliances: sv.appliances,
      state: sv.state,
      sun_hours: sv.sunHours,
      backup_hours: sv.backupHours,
      peak_w: sv.peakW,
      daily_wh: sv.dailyWh,
      recommended: sv.recommended,
      override: nz(sv.override),
      notes: nz(sv.notes),
      created_at: sv.createdAt,
    });
    for (const p of sv.photos) photoRow(p, { survey_id: sv.id });
  }

  for (const q of db.quotes) {
    put('quotes', {
      id: q.id,
      lead_id: q.leadId,
      survey_id: nz(q.surveyId),
      status: q.status,
      valid_days: q.validDays,
      deposit_pct: q.depositPct,
      selected_option_id: nz(q.selectedOptionId),
      sent_at: nz(q.sentAt),
      accepted_at: nz(q.acceptedAt),
      last_follow_up_at: nz(q.lastFollowUpAt),
      created_at: q.createdAt,
    });
    q.options.forEach((o, i) => {
      put('quote_options', { id: o.id, quote_id: q.id, position: i, name: o.name, backup_hours: o.backupHours });
      o.lines.forEach((l, j) => {
        put('quote_lines', { id: l.id, option_id: o.id, position: j, item_id: nz(l.itemId), category: l.category, description: l.description, qty: l.qty, unit_price: l.unitPrice });
        put('quote_line_costs', { line_id: l.id, unit_cost: l.unitCost });
      });
    });
  }

  for (const j of db.jobs) {
    put('jobs', {
      id: j.id,
      lead_id: j.leadId,
      type: j.type,
      status: j.status,
      quote_id: nz(j.quoteId),
      installation_id: nz(j.installationId),
      ticket_id: nz(j.ticketId),
      start_at: nz(j.start),
      duration_hours: j.durationHours,
      address: j.address,
      lat: nz(j.gps?.lat),
      lng: nz(j.gps?.lng),
      equipment: j.equipment,
      notes: nz(j.notes),
      checklist: j.checklist,
      check_in_at: nz(j.checkIn?.at),
      check_in_lat: nz(j.checkIn?.gps?.lat),
      check_in_lng: nz(j.checkIn?.gps?.lng),
      check_out_at: nz(j.checkOut?.at),
      check_out_lat: nz(j.checkOut?.gps?.lat),
      check_out_lng: nz(j.checkOut?.gps?.lng),
      signature_path: nz(j.signature?.storagePath),
      signature_name: nz(j.signature?.name),
      signed_at: nz(j.signature?.at),
      completed_at: nz(j.completedAt),
      sync_conflict: nz(j.syncConflict),
      handover_plan_id: nz(j.handoverPlanId),
    });
    for (const a of j.assigneeIds) put('job_assignees', { job_id: j.id, staff_id: a });
    for (const x of j.serials) put('job_serials', { id: x.id, job_id: j.id, label: x.label, category: x.category, item_id: nz(x.itemId), serial: x.serial, method: x.method, warranty_years: x.warrantyYears });
    for (const x of j.extras) put('job_extras', { id: x.id, job_id: j.id, description: x.description, qty: x.qty, item_id: nz(x.itemId), flagged_for_invoice: x.flaggedForInvoice, invoice_id: nz(x.invoiceId) });
    for (const p of j.photos) photoRow(p, { job_id: j.id });
  }

  for (const i of db.installations) {
    put('installations', {
      id: i.id,
      lead_id: i.leadId,
      job_id: i.jobId,
      installed_at: i.installedAt,
      site: i.site,
      service_interval_months: i.serviceIntervalMonths,
      next_service_at: i.nextServiceAt,
      last_service_reminder_at: nz(i.lastServiceReminderAt),
      plan_id: nz(i.planId),
      plan_started_at: nz(i.planStartedAt),
      plan_renews_at: nz(i.planRenewsAt),
      plan_visits_left: nz(i.planVisitsLeft),
      last_renewal_reminder_at: nz(i.lastRenewalReminderAt),
    });
    for (const x of i.items) put('installation_items', { id: x.id, installation_id: i.id, label: x.label, category: x.category, serial: nz(x.serial), warranty_years: x.warrantyYears, warranty_ends_at: x.warrantyEndsAt });
    for (const s of i.technicianIds) put('installation_technicians', { installation_id: i.id, staff_id: s });
  }

  for (const t of db.tickets) {
    put('tickets', { id: t.id, installation_id: nz(t.installationId), lead_id: t.leadId, description: t.description, channel: t.channel, status: t.status, job_id: nz(t.jobId), created_at: t.createdAt });
    for (const u of t.updates) put('ticket_updates', { id: u.id ?? stableUuid(`${t.id}|${u.at}|${u.text}`), ticket_id: t.id, at: u.at, text: u.text });
    for (const p of t.photos) photoRow(p, { ticket_id: t.id });
  }

  for (const i of db.invoices) {
    put('invoices', {
      id: i.id,
      lead_id: i.leadId,
      quote_id: nz(i.quoteId),
      job_id: nz(i.jobId),
      kind: i.kind,
      description: i.description,
      amount: i.amount,
      issued_at: i.issuedAt,
      due_at: i.dueAt,
      reminders_sent: i.remindersSent,
    });
  }
  for (const p of db.payments) {
    put('payments', { id: p.id, invoice_id: p.invoiceId, amount: p.amount, method: p.method, at: p.at, status: p.status });
    if (p.proofPhoto) photoRow(p.proofPhoto, { payment_id: p.id });
  }

  for (const m of db.messages) {
    put('messages', { id: m.id, channel: m.channel, to_phone: toE164(m.to), to_name: m.toName, text: m.text, link: nz(m.link), topic: m.topic, created_at: m.at });
  }
  for (const nt of db.notifications) {
    put('notifications', { id: nt.id, text: nt.text, link: nz(nt.link), for_roles: nt.forRoles, created_at: nt.at });
    if (nt.read && nt.forRoles.includes(ctx.role)) put('notification_reads', { notification_id: nt.id, staff_id: ctx.staffId });
  }
  return out;
}

// ---------- diff → apply_changes ops ----------

export type Op = { t: Table; op: 'insert'; row: Row } | { t: Table; op: 'update'; key: Row; set: Row } | { t: Table; op: 'delete'; key: Row };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Row changes between two flattened snapshots, ordered so foreign keys hold. Updates carry changed columns only. */
export function diff(prev: Flat, next: Flat): Op[] {
  const upserts: Op[] = [];
  const deletes: Op[] = [];
  for (const t of TABLES) {
    const a = prev.get(t)!;
    const b = next.get(t)!;
    const pick = (r: Row) => Object.fromEntries(keyCols(t).map((k) => [k, r[k]]));
    for (const [k, row] of b) {
      const old = a.get(k);
      if (!old) {
        upserts.push({ t, op: 'insert', row });
        continue;
      }
      const set: Row = {};
      for (const col of Object.keys(row)) if (!same(row[col], old[col])) set[col] = row[col];
      if (Object.keys(set).length) upserts.push({ t, op: 'update', key: pick(row), set });
    }
    for (const [k, row] of a) if (!b.has(k)) deletes.push({ t, op: 'delete', key: pick(row) });
  }
  // Children before parents when deleting (deletes are idempotent, so cascaded rows are fine)
  return [...upserts, ...deletes.reverse()];
}

// ---------- offline queue: units of work ----------

const JOB_CHILDREN: Table[] = ['job_assignees', 'job_serials', 'job_extras'];

/**
 * Split a batch into units that succeed or fail on their own: one per job (with its serials, extras and photos),
 * one per survey (with its photos), and one for everything else, which goes first because jobs and surveys can depend
 * on it (a lead logged on site). After days offline, one refused job then can't sink the rest of the technician's work.
 */
export function groupOps(ops: Op[], prev: Flat, next: Flat): { unit: string; ops: Op[] }[] {
  const unitOf = (op: Op): string => {
    const row = op.op === 'insert' ? op.row : (next.get(op.t)?.get(keyOf(op.t, op.key)) ?? prev.get(op.t)?.get(keyOf(op.t, op.key)) ?? op.key);
    if (op.t === 'jobs') return `job:${row.id}`;
    if (JOB_CHILDREN.includes(op.t)) return `job:${row.job_id}`;
    if (op.t === 'surveys') return `survey:${row.id}`;
    if (op.t === 'photos') return row.job_id ? `job:${row.job_id}` : row.survey_id ? `survey:${row.survey_id}` : 'other';
    return 'other';
  };
  const groups = new Map<string, Op[]>([['other', []]]);
  for (const op of ops) {
    const u = unitOf(op);
    groups.set(u, [...(groups.get(u) ?? []), op]);
  }
  return [...groups].filter(([, g]) => g.length).map(([unit, g]) => ({ unit, ops: g }));
}

/** The baseline after some ops were accepted by the server (others may still be waiting). */
export function applyOps(flat: Flat, ops: Op[]): Flat {
  const out: Flat = new Map([...flat].map(([t, rows]) => [t, new Map(rows)]));
  for (const op of ops) {
    const rows = out.get(op.t)!;
    if (op.op === 'insert') rows.set(keyOf(op.t, op.row), op.row);
    else if (op.op === 'delete') rows.delete(keyOf(op.t, op.key));
    else {
      const k = keyOf(op.t, op.key);
      rows.set(k, { ...(rows.get(k) ?? op.key), ...op.set });
    }
  }
  return out;
}
