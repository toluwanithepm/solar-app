// Sales-side actions: leads, quotes, follow-ups, payments recorded outside the app, firm sign-up.
import { addAudit, getDb, getSession, nextNumber, notify, nowIso, sendMessage, setSession, uid, update } from './store';
import { addDays, effectiveSize, naira, optionTotal, optionsForLoad, publicUrl, quoteValidUntil } from './domain';
import { checklistFor } from './seed';
import type { DB, ID, Lead, LeadStage, Payment, Photo, Quote, QuoteOption } from './types';

export function createLead(input: Omit<Lead, 'id' | 'createdAt' | 'stage'> & { stage?: LeadStage }, notifyStaff = false): ID {
  const id = uid('l_');
  update((d) => {
    d.leads.unshift({ ...input, id, stage: input.stage ?? 'New', createdAt: nowIso() });
    if (notifyStaff) notify(d, `New web enquiry: ${input.name}, ${input.location}`, `/office/leads/${id}`);
  });
  return id;
}

export function setLeadStage(leadId: ID, stage: LeadStage, note?: string) {
  update((d) => {
    const l = d.leads.find((x) => x.id === leadId);
    if (!l) return;
    l.stage = stage;
    if (note) l.notes = l.notes ? `${l.notes}\n${note}` : note;
  });
}

export function bookSurvey(leadId: ID): ID {
  const id = uid('j_');
  update((d) => {
    const l = d.leads.find((x) => x.id === leadId)!;
    d.jobs.push({
      id,
      number: nextNumber(d, 'SJ'),
      leadId,
      type: 'Site survey',
      status: 'Unscheduled',
      durationHours: 2,
      assigneeIds: [],
      address: l.address,
      equipment: [],
      checklist: checklistFor('Site survey', d.checklistTemplates),
      serials: [],
      photos: [],
      extras: [],
      pendingSync: false,
      updatedAt: nowIso(),
    });
  });
  return id;
}

// ---------- quotes ----------

/** E2-2: a sent quote needs a follow-up when followUpDays have passed since it was sent or last chased. */
export function followUpDue(d: Pick<DB, 'company'>, q: Quote, now = Date.now()) {
  if (q.status !== 'Sent') return false;
  const since = new Date(q.lastFollowUpAt ?? q.sentAt ?? q.createdAt).getTime();
  return now - since >= d.company.followUpDays * 86_400_000;
}

export function isExpired(q: Quote, now = Date.now()) {
  return q.status === 'Sent' && new Date(quoteValidUntil(q)).getTime() < now;
}

export function followUpText(d: Pick<DB, 'company'>, q: Quote, lead: Lead) {
  return `Hello ${lead.name}, this is ${d.company.name} following up on your solar quote ${q.number}. Any questions? You can view and accept it here: ${publicUrl(`/q/${q.id}`)}`;
}

export function recordFollowUp(quoteId: ID) {
  update((d) => {
    const q = d.quotes.find((x) => x.id === quoteId)!;
    const lead = d.leads.find((l) => l.id === q.leadId)!;
    q.lastFollowUpAt = nowIso();
    sendMessage(d, { to: lead.phone, toName: lead.name, topic: 'quote-follow-up', text: followUpText(d, q, lead) });
  });
}

/** E4-1: new draft quote, pre-filled from a survey's recommendation and the price list when there is one. */
export function createQuote(leadId: ID, surveyId?: ID): ID {
  const id = uid('q_');
  update((d) => {
    const survey = surveyId ? d.surveys.find((s) => s.id === surveyId) : undefined;
    let options: QuoteOption[];
    if (survey) {
      options = optionsForLoad(d, survey.peakW, survey.dailyWh, survey.sunHours, survey.backupHours, effectiveSize(survey.recommended, survey.override));
    } else {
      options = [{ id: uid('o_'), name: 'Recommended', backupHours: 8, lines: [] }];
    }
    const q: Quote = {
      id,
      number: nextNumber(d, 'Q'),
      leadId,
      surveyId: survey?.id,
      createdAt: nowIso(),
      status: 'Draft',
      validDays: d.company.defaultValidDays,
      depositPct: d.company.defaultDepositPct,
      options,
    };
    d.quotes.push(q);
    addAudit(d, 'quote', id, `Created ${q.number}${survey ? ' from site survey' : ''}`, undefined, { options: options.map((o) => ({ name: o.name, total: optionTotal(o) })) });
  });
  return id;
}

const summarise = (q: Quote) => ({
  depositPct: q.depositPct,
  validDays: q.validDays,
  options: q.options.map((o) => ({ name: o.name, backupHours: o.backupHours, total: optionTotal(o), lines: o.lines.map((l) => `${l.qty} × ${l.description} @ ${naira(l.unitPrice)}`) })),
});

/** Save an edited quote and log before/after values (E11-3). */
export function saveQuote(next: Quote) {
  update((d) => {
    const i = d.quotes.findIndex((q) => q.id === next.id);
    if (i < 0) return;
    const before = summarise(d.quotes[i]);
    const after = summarise(next);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    d.quotes[i] = structuredClone(next);
    addAudit(d, 'quote', next.id, `Edited ${next.number}`, before, after);
  });
}

export function setQuoteStatus(quoteId: ID, status: Quote['status']) {
  update((d) => {
    const q = d.quotes.find((x) => x.id === quoteId)!;
    const before = { status: q.status };
    q.status = status;
    addAudit(d, 'quote', q.id, `${q.number} marked ${status}`, before, { status });
    if (status === 'Declined') {
      const l = d.leads.find((x) => x.id === q.leadId);
      if (l && l.stage === 'Quoted') l.stage = 'Lost';
    }
  });
}

// ---------- payments recorded outside the app (E9-4) ----------

export function recordOfflinePayment(invoiceId: ID, amount: number, method: Payment['method'], proof?: Photo) {
  update((d) => {
    const inv = d.invoices.find((i) => i.id === invoiceId)!;
    const ref = nextNumber(d, 'PAY');
    d.payments.push({ id: uid('pay_'), invoiceId, amount, method, at: nowIso(), status: 'Pending approval', reference: ref, proofPhoto: proof, recordedById: getSession()?.userId });
    addAudit(d, 'payment', inv.id, `Recorded ${method} payment ${naira(amount)} on ${inv.number} (awaiting approval)`, undefined, { amount, method, reference: ref });
    notify(d, `${naira(amount)} ${method.toLowerCase()} payment on ${inv.number} needs approval`, '/office/payments', ['owner']);
  });
}

export function reviewPayment(paymentId: ID, approve: boolean) {
  update((d) => {
    const p = d.payments.find((x) => x.id === paymentId)!;
    const inv = d.invoices.find((i) => i.id === p.invoiceId)!;
    const before = { status: p.status };
    p.status = approve ? 'Confirmed' : 'Rejected';
    p.approvedById = getSession()?.userId;
    addAudit(d, 'payment', inv.id, `${approve ? 'Approved' : 'Rejected'} ${p.method} payment ${naira(p.amount)} on ${inv.number}`, before, { status: p.status });
    if (approve) {
      const lead = d.leads.find((l) => l.id === inv.leadId)!;
      sendMessage(d, { to: lead.phone, toName: lead.name, topic: 'receipt', text: `Receipt ${p.reference}: we received ${naira(p.amount)} by ${p.method} for ${inv.description}. Thank you!` });
    }
  });
}

// ---------- auth ----------

export function sendOtp(phone: string): string {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  update((d) => sendMessage(d, { channel: 'SMS', to: phone, toName: phone, topic: 'otp', text: `Your sign-in code is ${code}. It expires in 10 minutes.` }));
  return code;
}

export const normalisePhone = (p: string) => p.replace(/\D/g, '').replace(/^234/, '0');

export function findUserByPhone(phone: string) {
  const n = normalisePhone(phone);
  return getDb().users.find((u) => u.active && normalisePhone(u.phone) === n);
}

/**
 * E1-1: a new firm signs up. The local store holds one firm, so this starts a fresh workspace:
 * customer, job and money records are cleared; the equipment price list, plans and checklists stay as editable templates.
 */
export function signUpFirm(input: { ownerName: string; phone: string; company: Pick<DB['company'], 'name' | 'logoDataUrl' | 'address' | 'state' | 'bankName' | 'accountNumber' | 'accountName'> }) {
  const ownerId = uid('u_');
  update((d) => {
    d.company = {
      ...d.company,
      ...input.company,
      phone: input.phone,
      subscription: { status: 'trial', seats: 3, trialEndsAt: addDays(nowIso(), 14) },
      setupCompletedAt: nowIso(),
    };
    d.users = [{ id: ownerId, name: input.ownerName, phone: input.phone, role: 'owner', title: 'Owner', active: true }];
    d.leads = [];
    d.surveys = [];
    d.quotes = [];
    d.jobs = [];
    d.installations = [];
    d.tickets = [];
    d.invoices = [];
    d.payments = [];
    d.notifications = [];
    d.audit = [];
  });
  setSession({ userId: ownerId });
}
