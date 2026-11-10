// Office operations: scheduling, service, tickets, plans and register helpers.
import { addMonths, invoiceBalance, naira, publicUrl } from './domain';
import { addAudit, nextNumber, notify, nowIso, sendMessage, uid, update } from './store';
import { checklistFor } from './seed';
import type { DB, ID, Job, MaintenancePlan, Photo, Ticket } from './types';

// ---------- job timing and live status ----------

export const jobStartMs = (j: Job) => (j.start ? new Date(j.start).getTime() : NaN);
export const jobEndMs = (j: Job) => jobStartMs(j) + j.durationHours * 3_600_000;

export type LiveStatus = 'Unscheduled' | 'Scheduled' | 'On site' | 'Late' | 'Done' | 'Cancelled';

export function liveStatus(j: Job, now = Date.now()): LiveStatus {
  if (j.status === 'Cancelled') return 'Cancelled';
  if (j.status === 'Done') return 'Done';
  if (!j.start) return 'Unscheduled';
  if (j.checkIn && !j.checkOut) return 'On site';
  if (!j.checkIn && jobStartMs(j) + 15 * 60_000 < now) return 'Late';
  return 'Scheduled';
}

export const liveStatusColor: Record<LiveStatus, string> = {
  Unscheduled: 'var(--faint)',
  Scheduled: 'var(--faint)',
  'On site': 'var(--primary)',
  Late: 'var(--warning)',
  Done: 'var(--success)',
  Cancelled: 'var(--faint)',
};

export function lateByLabel(j: Job, now = Date.now()) {
  const mins = Math.round((now - jobStartMs(j)) / 60_000);
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min late` : `${mins} min late`;
}

export const startOfDay = (d: Date | string | number) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// ---------- conflicts (E5-1) ----------

const active = (j: Job) => j.start && j.status !== 'Done' && j.status !== 'Cancelled';

/** Pairs of jobs that overlap for the same technician. */
export function findConflicts(jobs: Job[]) {
  const list: { techId: ID; a: Job; b: Job }[] = [];
  const scheduled = jobs.filter(active).sort((x, y) => jobStartMs(x) - jobStartMs(y));
  for (let i = 0; i < scheduled.length; i++) {
    for (let k = i + 1; k < scheduled.length; k++) {
      const a = scheduled[i];
      const b = scheduled[k];
      if (jobStartMs(b) >= jobEndMs(a)) continue;
      for (const t of a.assigneeIds) if (b.assigneeIds.includes(t)) list.push({ techId: t, a, b });
    }
  }
  return list;
}

/** Conflicts a proposed schedule would create, ignoring the job itself. */
export function conflictsForProposal(jobs: Job[], jobId: ID, startIso: string, durationHours: number, assigneeIds: ID[]) {
  const s = new Date(startIso).getTime();
  const e = s + durationHours * 3_600_000;
  return jobs.filter((j) => j.id !== jobId && active(j) && jobStartMs(j) < e && jobEndMs(j) > s && j.assigneeIds.some((t) => assigneeIds.includes(t)));
}

/**
 * Assign or reschedule a job. Field data (photos, serials, signature) is never touched;
 * if the phone still has unsynced changes the job is flagged for office review (NFR-2).
 */
export function scheduleJob(jobId: ID, startIso: string, durationHours: number, assigneeIds: ID[]) {
  update((d) => {
    const j = d.jobs.find((x) => x.id === jobId);
    if (!j) return;
    const moved = j.start !== startIso || j.durationHours !== durationHours || j.assigneeIds.join() !== assigneeIds.join();
    j.start = startIso;
    j.durationHours = durationHours;
    j.assigneeIds = assigneeIds;
    if (j.status === 'Unscheduled') j.status = 'Scheduled';
    if (j.pendingSync && moved) j.syncConflict = `Office changed the schedule while ${j.number} had unsynced field updates. Field data was kept; confirm the new time with the technician.`;
    j.updatedAt = nowIso();
    if (j.ticketId) {
      const t = d.tickets.find((x) => x.id === j.ticketId);
      if (t && t.status === 'Open') t.status = 'Scheduled';
    }
  });
}

export function unscheduleJob(jobId: ID) {
  update((d) => {
    const j = d.jobs.find((x) => x.id === jobId);
    if (!j || j.status === 'Done') return;
    j.start = undefined;
    j.status = 'Unscheduled';
    j.updatedAt = nowIso();
  });
}

// ---------- jobs created by the office ----------

function newJob(d: DB, leadId: ID, type: Job['type'], extra: Partial<Job> = {}): Job {
  const lead = d.leads.find((l) => l.id === leadId)!;
  const job: Job = {
    id: uid('j_'),
    number: nextNumber(d, 'SJ'),
    leadId,
    type,
    status: 'Unscheduled',
    durationHours: type === 'Installation' ? 5 : type === 'Maintenance' ? 1.5 : 2,
    assigneeIds: [],
    address: lead.address,
    equipment: [],
    checklist: checklistFor(type, d.checklistTemplates),
    serials: [],
    photos: [],
    extras: [],
    pendingSync: false,
    updatedAt: nowIso(),
    ...extra,
  };
  d.jobs.push(job);
  return job;
}

/** E8-1: book a maintenance visit for an installation. Returns the new job id. */
export function bookServiceVisit(installationId: ID) {
  let id = '';
  update((d) => {
    const ins = d.installations.find((i) => i.id === installationId)!;
    const existing = d.jobs.find((j) => j.installationId === ins.id && j.type === 'Maintenance' && j.status !== 'Done' && j.status !== 'Cancelled');
    if (existing) {
      id = existing.id;
      return;
    }
    id = newJob(d, ins.leadId, 'Maintenance', {
      installationId: ins.id,
      address: ins.site,
      equipment: ins.items.filter((i) => i.category !== 'panel').map((i) => ({ description: i.label, qty: 1, category: i.category })),
    }).id;
  });
  return id;
}

export const openServiceJob = (d: DB, installationId: ID) => d.jobs.find((j) => j.installationId === installationId && j.type === 'Maintenance' && j.status !== 'Done' && j.status !== 'Cancelled');

// ---------- tickets (E8-3) ----------

export function createTicket(input: { leadId: ID; installationId?: ID; description: string; channel: Ticket['channel']; photos?: Photo[] }) {
  let created: Ticket | undefined;
  update((d) => {
    const lead = d.leads.find((l) => l.id === input.leadId)!;
    const t: Ticket = {
      id: uid('t_'),
      number: nextNumber(d, 'T'),
      leadId: input.leadId,
      installationId: input.installationId,
      description: input.description,
      channel: input.channel,
      photos: input.photos ?? [],
      createdAt: nowIso(),
      status: 'Open',
      updates: [{ at: nowIso(), text: 'Ticket received' }],
    };
    d.tickets.unshift(t);
    created = t;
    notify(d, `New fault report ${t.number} from ${lead.name}: ${t.description}`, '/office/service?tab=tickets');
    sendMessage(d, {
      to: lead.phone,
      toName: lead.name,
      topic: 'ticket',
      text: `We received your fault report ${t.number}. Our team will contact you shortly.`,
      link: input.installationId ? publicUrl(`/report/${input.installationId}`) : undefined,
    });
  });
  return created!;
}

export function addTicketUpdate(ticketId: ID, text: string, status?: Ticket['status']) {
  update((d) => {
    const t = d.tickets.find((x) => x.id === ticketId)!;
    const lead = d.leads.find((l) => l.id === t.leadId)!;
    t.updates.push({ at: nowIso(), text });
    if (status) t.status = status;
    sendMessage(d, { to: lead.phone, toName: lead.name, topic: 'ticket', text: `Update on ${t.number}: ${text}`, link: t.installationId ? publicUrl(`/report/${t.installationId}`) : undefined });
  });
}

/** Create a fault-repair job for a ticket; the office then assigns it on the schedule. */
export function scheduleRepair(ticketId: ID) {
  let jobId = '';
  update((d) => {
    const t = d.tickets.find((x) => x.id === ticketId)!;
    const existing = d.jobs.find((j) => j.ticketId === t.id && j.status !== 'Cancelled');
    if (existing) {
      jobId = existing.id;
      return;
    }
    const ins = d.installations.find((i) => i.id === t.installationId);
    jobId = newJob(d, t.leadId, 'Fault repair', { ticketId: t.id, installationId: t.installationId, address: ins?.site ?? d.leads.find((l) => l.id === t.leadId)!.address, notes: t.description }).id;
    t.status = 'Scheduled';
    t.updates.push({ at: nowIso(), text: 'Repair visit being scheduled' });
    const lead = d.leads.find((l) => l.id === t.leadId)!;
    sendMessage(d, { to: lead.phone, toName: lead.name, topic: 'ticket', text: `Update on ${t.number}: we are scheduling a technician visit.` });
  });
  return jobId;
}

// ---------- maintenance plans (E8-2) ----------

export function savePlan(plan: MaintenancePlan) {
  update((d) => {
    const i = d.plans.findIndex((p) => p.id === plan.id);
    if (i >= 0) d.plans[i] = plan;
    else d.plans.push(plan);
  });
}

export function deletePlan(planId: ID) {
  update((d) => {
    d.plans = d.plans.filter((p) => p.id !== planId);
  });
}

export function sellPlan(installationId: ID, planId: ID) {
  update((d) => {
    const ins = d.installations.find((i) => i.id === installationId)!;
    const plan = d.plans.find((p) => p.id === planId)!;
    const lead = d.leads.find((l) => l.id === ins.leadId)!;
    const now = nowIso();
    ins.planId = plan.id;
    ins.planStartedAt = now;
    ins.planRenewsAt = addMonths(now, 12);
    ins.planVisitsLeft = plan.visitsPerYear;
    ins.lastRenewalReminderAt = undefined;
    ins.serviceIntervalMonths = Math.max(1, Math.round(12 / plan.visitsPerYear));
    const inv = { id: uid('i_'), number: nextNumber(d, 'INV'), leadId: lead.id, kind: 'Maintenance plan' as const, description: `${plan.name} plan · 12 months`, amount: plan.price, issuedAt: now, dueAt: now, remindersSent: [] };
    d.invoices.push(inv);
    addAudit(d, 'invoice', inv.id, `Sold ${plan.name} to ${lead.name}`, undefined, { amount: plan.price });
    sendMessage(d, { to: lead.phone, toName: lead.name, topic: 'plan', text: `Thank you for choosing the ${plan.name} plan (${plan.visitsPerYear} visits a year). Pay ${naira(plan.price)} here:`, link: publicUrl(`/pay/${inv.id}`) });
  });
}

// ---------- extras (E6-6) ----------

export function invoiceExtras(jobId: ID) {
  update((d) => {
    const job = d.jobs.find((j) => j.id === jobId)!;
    const extras = job.extras.filter((x) => !x.invoiceId);
    if (!extras.length) return;
    const amount = extras.reduce((s, x) => s + x.qty * (d.priceItems.find((p) => p.id === x.itemId)?.price ?? 0), 0);
    const inv = {
      id: uid('i_'),
      number: nextNumber(d, 'INV'),
      leadId: job.leadId,
      jobId: job.id,
      kind: 'Extras' as const,
      description: `Extra materials: ${extras.map((x) => `${x.qty} × ${x.description}`).join(', ')}`,
      amount,
      issuedAt: nowIso(),
      dueAt: nowIso(),
      remindersSent: [],
    };
    d.invoices.push(inv);
    extras.forEach((x) => {
      x.invoiceId = inv.id;
      x.flaggedForInvoice = true;
    });
    addAudit(d, 'invoice', inv.id, `Invoiced extras on ${job.number}`, undefined, { amount });
    const lead = d.leads.find((l) => l.id === job.leadId)!;
    sendMessage(d, { to: lead.phone, toName: lead.name, topic: 'payment-link', text: `Invoice ${inv.number} for extra materials: ${naira(amount)}.`, link: publicUrl(`/pay/${inv.id}`) });
  });
}

// ---------- money ----------

export const owedTotal = (d: Pick<DB, 'invoices' | 'payments'>) => d.invoices.reduce((s, i) => s + invoiceBalance(d, i), 0);
