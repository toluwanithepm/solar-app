// Cross-surface business workflows. Each runs inside one update() so related records change together.
import { addAudit, getDb, isBackend, isOnline, nextNumber, notify, nowIso, sendMessage, uid, update } from './store';
import { addDays, addMonths, invoiceBalance, naira, optionTotal, publicUrl, selectedOption } from './domain';
import { checklistFor } from './seed';
import type { DB, ID, Invoice, PaymentMethod } from './types';

function findLead(d: DB, id: ID) {
  const l = d.leads.find((x) => x.id === id);
  if (!l) throw new Error(`Lead ${id} not found`);
  return l;
}

/** E4-3: mark a quote sent and send the branded link to the customer on WhatsApp. */
export function sendQuote(quoteId: ID) {
  update((d) => {
    const q = d.quotes.find((x) => x.id === quoteId)!;
    const lead = findLead(d, q.leadId);
    const before = { status: q.status };
    q.status = 'Sent';
    q.sentAt = nowIso();
    if (lead.stage === 'New' || lead.stage === 'Surveyed') lead.stage = 'Quoted';
    sendMessage(d, {
      to: lead.phone,
      toName: lead.name,
      topic: 'quote',
      text: `Hello ${lead.name}, here is your solar quote ${q.number} from ${d.company.name}. It is valid for ${q.validDays} days.`,
      link: publicUrl(`/q/${q.id}`),
    });
    addAudit(d, 'quote', q.id, `Sent ${q.number} to customer`, before, { status: q.status });
  });
}

/**
 * E4-4: customer accepts a quote option and pays the deposit from the link.
 * Lead → Won, an unscheduled job is created, and the payment schedule becomes invoices (E9-1).
 */
export function acceptQuote(quoteId: ID, optionId: ID, method: PaymentMethod) {
  let depositInvoiceId = '';
  update((d) => {
    const q = d.quotes.find((x) => x.id === quoteId)!;
    const lead = findLead(d, q.leadId);
    q.selectedOptionId = optionId;
    q.status = 'Accepted';
    q.acceptedAt = nowIso();
    lead.stage = 'Won';
    const option = selectedOption(q);
    const total = optionTotal(option);
    const deposit = Math.round((total * q.depositPct) / 100);

    const jobId = uid('j_');
    d.jobs.push({
      id: jobId,
      number: nextNumber(d, 'SJ'),
      leadId: lead.id,
      type: 'Installation',
      status: 'Unscheduled',
      quoteId: q.id,
      durationHours: 5,
      assigneeIds: [],
      address: lead.address,
      equipment: option.lines.filter((l) => l.category !== 'service').map((l) => ({ description: l.description, qty: l.qty, category: l.category, itemId: l.itemId })),
      checklist: checklistFor('Installation', d.checklistTemplates),
      serials: [],
      photos: [],
      extras: [],
      pendingSync: false,
      updatedAt: nowIso(),
    });

    const dep: Invoice = { id: uid('i_'), number: nextNumber(d, 'INV'), leadId: lead.id, quoteId: q.id, jobId, kind: 'Deposit', description: `Deposit (${q.depositPct}%)`, amount: deposit, issuedAt: nowIso(), dueAt: nowIso(), remindersSent: [0] };
    const bal: Invoice = { id: uid('i_'), number: nextNumber(d, 'INV'), leadId: lead.id, quoteId: q.id, jobId, kind: 'Balance', description: `Balance at handover (${100 - q.depositPct}%)`, amount: total - deposit, issuedAt: nowIso(), dueAt: addDays(nowIso(), 14), remindersSent: [] };
    d.invoices.push(dep, bal);
    depositInvoiceId = dep.id;
    recordGatewayPayment(d, dep, deposit, method);
    addAudit(d, 'quote', q.id, `${lead.name} accepted ${q.number} (${option.name})`, { status: 'Sent' }, { status: 'Accepted', option: option.name, total });
    notify(d, `${lead.name} accepted quote ${q.number} and paid the ${naira(deposit)} deposit`, '/office/schedule');
  });
  return depositInvoiceId;
}

/** Payment confirmed by the (simulated) gateway: record it and send a receipt (E9-2). */
function recordGatewayPayment(d: DB, inv: Invoice, amount: number, method: PaymentMethod) {
  const lead = findLead(d, inv.leadId);
  const ref = nextNumber(d, 'PAY');
  d.payments.push({ id: uid('pay_'), invoiceId: inv.id, amount, method, at: nowIso(), status: 'Confirmed', reference: ref });
  addAudit(d, 'payment', inv.id, `${method} payment ${naira(amount)} for ${inv.number}`, undefined, { amount, method, reference: ref });
  sendMessage(d, { to: lead.phone, toName: lead.name, topic: 'receipt', text: `Receipt ${ref}: we received ${naira(amount)} by ${method} for ${inv.description}. Thank you!`, link: publicUrl(`/pay/${inv.id}`) });
}

/** E9-2: customer pays (part of) an invoice from its link. */
export function payInvoice(invoiceId: ID, amount: number, method: PaymentMethod) {
  update((d) => {
    const inv = d.invoices.find((i) => i.id === invoiceId)!;
    const pay = Math.min(amount, invoiceBalance(d, inv));
    if (pay <= 0) return;
    recordGatewayPayment(d, inv, pay, method);
    notify(d, `${findLead(d, inv.leadId).name} paid ${naira(pay)} on ${inv.number}`, '/office/payments');
  });
}

/**
 * E6-5 + E7-1 + E8-1 + E9-1: technician completes a job.
 * Installation jobs create the installation record with serials and warranty end dates,
 * schedule the first service visit, and send the handover PDF and balance link on WhatsApp.
 * In backend mode the phone only marks the job done; the database does the rest when the change syncs
 * (supabase/migrations/*_field.sql), so it can't be skipped or tampered with.
 */
export function completeJob(jobId: ID) {
  if (isBackend) {
    update((d) => {
      const job = d.jobs.find((j) => j.id === jobId)!;
      const done = nowIso();
      job.status = 'Done';
      job.completedAt = done;
      job.checkOut ??= { at: done };
      job.updatedAt = done;
    });
    return;
  }
  update((d) => {
    const job = d.jobs.find((j) => j.id === jobId)!;
    const lead = findLead(d, job.leadId);
    const done = nowIso();
    job.status = 'Done';
    job.completedAt = done;
    job.checkOut ??= { at: done };
    job.updatedAt = done;
    job.pendingSync = !isOnline();

    if (job.type === 'Installation' && !job.installationId) {
      const insId = uid('ins_');
      d.installations.push({
        id: insId,
        leadId: lead.id,
        jobId: job.id,
        installedAt: done,
        technicianIds: job.assigneeIds,
        site: job.address,
        items: job.serials.map((s) => ({ id: uid('ii_'), label: s.label, category: s.category, serial: s.serial, warrantyYears: s.warrantyYears, warrantyEndsAt: addMonths(done, s.warrantyYears * 12) })),
        photoIds: job.photos.map((p) => p.id),
        serviceIntervalMonths: d.company.serviceIntervalMonths,
        nextServiceAt: addMonths(done, d.company.serviceIntervalMonths),
      });
      job.installationId = insId;
    }

    if (job.installationId && job.type !== 'Installation') {
      const ins = d.installations.find((i) => i.id === job.installationId);
      if (ins && job.type === 'Maintenance') {
        ins.nextServiceAt = addMonths(done, ins.serviceIntervalMonths);
        if (ins.planVisitsLeft) ins.planVisitsLeft -= 1;
      }
    }

    if (job.ticketId) {
      const t = d.tickets.find((x) => x.id === job.ticketId);
      if (t) {
        t.status = 'Resolved';
        t.updates.push({ at: done, text: 'Job completed and signed off' });
        sendMessage(d, { to: lead.phone, toName: lead.name, topic: 'ticket', text: `Your fault report ${t.number} is resolved. Thank you for your patience.` });
      }
    }

    // E6-6: extras flagged for invoicing become one invoice
    const extras = job.extras.filter((x) => x.flaggedForInvoice && !x.invoiceId);
    if (extras.length) {
      const amount = extras.reduce((s, x) => s + x.qty * (d.priceItems.find((p) => p.id === x.itemId)?.price ?? 0), 0);
      const inv: Invoice = { id: uid('i_'), number: nextNumber(d, 'INV'), leadId: lead.id, jobId: job.id, kind: 'Extras', description: `Extra materials: ${extras.map((x) => `${x.qty} × ${x.description}`).join(', ')}`, amount, issuedAt: done, dueAt: done, remindersSent: [] };
      if (amount > 0) {
        d.invoices.push(inv);
        extras.forEach((x) => (x.invoiceId = inv.id));
      }
      notify(d, `${extras.length} extra item(s) used on ${job.number} need invoicing review`, `/office/jobs/${job.id}`);
    }

    // Balance becomes due at handover
    const balance = d.invoices.find((i) => i.jobId === job.id && i.kind === 'Balance');
    if (balance && invoiceBalance(d, balance) > 0) balance.dueAt = done;

    sendMessage(d, {
      to: lead.phone,
      toName: lead.name,
      topic: 'handover',
      text: `Your ${job.type.toLowerCase()} by ${d.company.name} is complete. Your handover report and warranty details are here.`,
      link: publicUrl(`/handover/${job.id}`),
    });
    if (balance && invoiceBalance(d, balance) > 0) {
      sendMessage(d, { to: lead.phone, toName: lead.name, topic: 'payment-link', text: `Balance of ${naira(invoiceBalance(d, balance))} is now due. Pay by card, transfer or USSD.`, link: publicUrl(`/pay/${balance.id}`) });
    }
    notify(d, `${job.number} for ${lead.name} completed`, `/office/jobs/${job.id}`);
  });
}

// ---------- automations (run on app start and daily) ----------

/**
 * Idempotent background rules standing in for server cron jobs:
 * E9-3 unpaid balance reminders at due, +3, +7 days; E8-1 service reminders 7 days before;
 * E8-2 plan renewal reminders 30 days before.
 */
export function runAutomations(now = new Date()) {
  const db = getDb();
  const due = db.invoices.some((inv) => reminderStepDue(db, inv, now) !== null) || db.installations.some((i) => serviceReminderDue(i, now) || renewalDue(i, now));
  if (!due) return;
  update((d) => {
    for (const inv of d.invoices) {
      const step = reminderStepDue(d, inv, now);
      if (step === null) continue;
      const lead = findLead(d, inv.leadId);
      const bal = invoiceBalance(d, inv);
      const text = step === 0 ? `${inv.description} of ${naira(bal)} is due today.` : `Reminder: ${inv.description} of ${naira(bal)} is ${step} days overdue.`;
      for (const channel of ['WhatsApp', 'SMS'] as const) {
        sendMessage(d, { channel, to: lead.phone, toName: lead.name, topic: 'payment-reminder', text: `${text} Pay here:`, link: publicUrl(`/pay/${inv.id}`) });
      }
      inv.remindersSent.push(step);
    }
    for (const ins of d.installations) {
      const lead = findLead(d, ins.leadId);
      if (serviceReminderDue(ins, now)) {
        sendMessage(d, { to: lead.phone, toName: lead.name, topic: 'service-reminder', text: `Your solar system is due for a service visit around ${new Date(ins.nextServiceAt).toLocaleDateString('en-GB')}. We will call to book a time.` });
        notify(d, `${lead.name} is due for a service visit in 7 days or less`, '/office/service');
        ins.lastServiceReminderAt = now.toISOString();
      }
      if (renewalDue(ins, now)) {
        const plan = d.plans.find((p) => p.id === ins.planId);
        sendMessage(d, { to: lead.phone, toName: lead.name, topic: 'plan-renewal', text: `Your ${plan?.name ?? 'maintenance'} plan renews on ${new Date(ins.planRenewsAt!).toLocaleDateString('en-GB')}.` });
        ins.lastRenewalReminderAt = now.toISOString();
      }
    }
  });
}

function reminderStepDue(db: Pick<DB, 'payments'>, inv: Invoice, now: Date): number | null {
  if (invoiceBalance(db, inv) === 0) return null;
  const overdueDays = Math.floor((now.getTime() - new Date(inv.dueAt).getTime()) / 86_400_000);
  for (const step of [7, 3, 0]) {
    if (overdueDays >= step) return inv.remindersSent.includes(step) ? null : step;
  }
  return null;
}

function serviceReminderDue(ins: DB['installations'][number], now: Date) {
  const daysTo = (new Date(ins.nextServiceAt).getTime() - now.getTime()) / 86_400_000;
  if (daysTo > 7 || daysTo < -1) return false;
  return !ins.lastServiceReminderAt || new Date(ins.lastServiceReminderAt) < addDaysDate(ins.nextServiceAt, -8);
}

function renewalDue(ins: DB['installations'][number], now: Date) {
  if (!ins.planRenewsAt) return false;
  const daysTo = (new Date(ins.planRenewsAt).getTime() - now.getTime()) / 86_400_000;
  return daysTo <= 30 && daysTo >= 0 && !ins.lastRenewalReminderAt;
}

const addDaysDate = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000);
