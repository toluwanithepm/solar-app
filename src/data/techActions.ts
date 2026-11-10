// Technician app mutations (E3, E6). All work offline; touchJobFromField queues them for sync.
import { addMonths, defaultWarrantyYears, loadTotals, naira, publicUrl, sizeSystem, sunHoursByState } from './domain';
import { getDb, isBackend, isOnline, nextNumber, notify, nowIso, sendMessage, touchJobFromField, uid, update } from './store';
import { completeJob } from './workflows';
import type { DB, ExtraMaterial, GPS, ID, Job, Lead, Photo, PropertyType, SerialRecord, Survey, SurveyAppliance } from './types';

const findJob = (d: DB, id: ID) => d.jobs.find((j) => j.id === id)!;

function onJob(jobId: ID, fn: (job: Job, d: DB) => void) {
  update((d) => {
    fn(findJob(d, jobId), d);
    touchJobFromField(d, jobId);
  });
}

// ---------- E6-1 check in / out ----------

export function checkIn(jobId: ID, gps?: GPS) {
  onJob(jobId, (job) => {
    job.checkIn = { at: nowIso(), gps };
    if (job.status === 'Scheduled' || job.status === 'Unscheduled') job.status = 'In progress';
  });
}

// ---------- E6-2 checklist ----------

export function toggleStep(jobId: ID, stepId: ID) {
  onJob(jobId, (job) => {
    const s = job.checklist.find((x) => x.id === stepId);
    if (s) s.done = !s.done;
  });
}

// ---------- E6-4 photos ----------

export const addJobPhoto = (jobId: ID, photo: Photo) => onJob(jobId, (job) => job.photos.push(photo));
export const removeJobPhoto = (jobId: ID, photoId: ID) => onJob(jobId, (job) => (job.photos = job.photos.filter((p) => p.id !== photoId)));

// ---------- E6-3 serials ----------

export type SerialSlot = { key: string; label: string; detail: string; category: SerialRecord['category']; itemId?: ID };

/** One slot per installed unit that carries a serial (inverters, batteries, panels). */
export function serialSlots(job: Job): SerialSlot[] {
  const slots: SerialSlot[] = [];
  const order = ['inverter', 'battery', 'panel'] as const;
  for (const cat of order) {
    const lines = job.equipment.filter((e) => e.category === cat);
    const count = lines.reduce((s, l) => s + l.qty, 0);
    let n = 0;
    for (const l of lines) {
      for (let i = 0; i < l.qty; i++) {
        n++;
        const name = cat === 'inverter' ? 'Inverter' : cat === 'battery' ? 'Battery' : 'Panel';
        slots.push({ key: `${cat}-${n}`, label: count > 1 ? `${name} ${n} of ${count}` : name, detail: l.description, category: cat, itemId: l.itemId });
      }
    }
  }
  return slots;
}

export function saveSerial(jobId: ID, slot: { label: string; category: SerialRecord['category']; itemId?: ID }, serial: string, method: SerialRecord['method']) {
  onJob(jobId, (job, d) => {
    const warrantyYears = d.priceItems.find((p) => p.id === slot.itemId)?.warrantyYears ?? defaultWarrantyYears[slot.category];
    const existing = job.serials.find((s) => s.label === slot.label);
    if (existing) Object.assign(existing, { serial, method });
    else job.serials.push({ id: uid('sr_'), label: slot.label, category: slot.category, itemId: slot.itemId, serial, method, warrantyYears });
  });
}

export const removeSerial = (jobId: ID, serialId: ID) => onJob(jobId, (job) => (job.serials = job.serials.filter((s) => s.id !== serialId)));

// ---------- E6-6 extra materials ----------

export function addExtra(jobId: ID, extra: Omit<ExtraMaterial, 'id' | 'flaggedForInvoice'>) {
  onJob(jobId, (job) => job.extras.push({ id: uid('x_'), flaggedForInvoice: true, ...extra }));
}
export const removeExtra = (jobId: ID, extraId: ID) => onJob(jobId, (job) => (job.extras = job.extras.filter((x) => x.id !== extraId)));

// ---------- E6-5 handover ----------

/** What still blocks completion, in plain words. */
export function missingForCompletion(job: Job, signatureName: string, hasSignature: boolean): string[] {
  const missing: string[] = [];
  if (!job.checkIn) missing.push('Check in on site');
  const req = job.checklist.filter((s) => s.required && !s.done).length;
  if (req) missing.push(`${req} required checklist step${req > 1 ? 's' : ''}`);
  if (job.type !== 'Site survey') {
    if (!job.photos.some((p) => p.kind === 'before')) missing.push('At least 1 before photo');
    if (!job.photos.some((p) => p.kind === 'after')) missing.push('At least 1 after photo');
  }
  if (job.type === 'Installation') {
    const left = serialSlots(job).filter((s) => !job.serials.some((r) => r.label === s.label)).length;
    if (left) missing.push(`${left} serial number${left > 1 ? 's' : ''} to scan`);
  }
  if (!hasSignature) missing.push('Customer signature');
  if (!signatureName.trim()) missing.push("Customer's name");
  return missing;
}

/** Sign off, complete the job (handover PDF goes out on WhatsApp), then attach a maintenance plan if the customer chose one (E8-2). */
export function completeWithHandover(jobId: ID, signature: { dataUrl: string; name: string }, gps: GPS | undefined, planId?: ID) {
  update((d) => {
    const job = findJob(d, jobId);
    job.signature = { ...signature, at: nowIso() };
    job.checkOut = { at: nowIso(), gps };
    // Backend mode: the server attaches the plan and raises its invoice when the job syncs
    if (isBackend) job.handoverPlanId = planId;
  });
  completeJob(jobId);
  if (!planId || isBackend) return;
  update((d) => {
    const job = findJob(d, jobId);
    const plan = d.plans.find((p) => p.id === planId);
    const ins = d.installations.find((i) => i.id === job.installationId);
    if (!plan || !ins) return;
    const lead = d.leads.find((l) => l.id === job.leadId)!;
    const now = nowIso();
    const interval = Math.max(1, Math.round(12 / plan.visitsPerYear));
    Object.assign(ins, { planId: plan.id, planStartedAt: now, planRenewsAt: addMonths(now, 12), planVisitsLeft: plan.visitsPerYear, serviceIntervalMonths: interval, nextServiceAt: addMonths(now, interval) });
    const inv = { id: uid('i_'), number: nextNumber(d, 'INV'), leadId: lead.id, jobId, kind: 'Maintenance plan' as const, description: `${plan.name} plan · 12 months`, amount: plan.price, issuedAt: now, dueAt: now, remindersSent: [] };
    d.invoices.push(inv);
    sendMessage(d, { to: lead.phone, toName: lead.name, topic: 'payment-link', text: `Thank you for choosing the ${plan.name} plan (${plan.visitsPerYear} visits a year). Pay ${naira(plan.price)} here:`, link: publicUrl(`/pay/${inv.id}`) });
    notify(d, `${lead.name} signed up for ${plan.name} on handover`, `/office/installations/${ins.id}`);
  });
}

// ---------- E3 site survey ----------

export function startSurvey(technicianId: ID, opts: { leadId?: ID; jobId?: ID }): ID | undefined {
  const db = getDb();
  const job = opts.jobId ? db.jobs.find((j) => j.id === opts.jobId) : undefined;
  const leadId = job?.leadId ?? opts.leadId;
  if (!leadId) return undefined;
  const existing = db.surveys.find((s) => s.status === 'draft' && (job ? s.jobId === job.id : s.leadId === leadId));
  if (existing) return existing.id;
  const lead = db.leads.find((l) => l.id === leadId)!;
  const state = lead.state in sunHoursByState ? lead.state : 'Other';
  const survey: Survey = {
    id: uid('sv_'),
    leadId,
    jobId: job?.id,
    technicianId,
    createdAt: nowIso(),
    status: 'draft',
    appliances: [],
    state,
    sunHours: sunHoursByState[state],
    backupHours: 8,
    peakW: 0,
    dailyWh: 0,
    recommended: sizeSystem(0, 0, sunHoursByState[state], 8),
    photos: [],
  };
  update((d) => {
    d.surveys.push(survey);
    if (job) {
      const j = findJob(d, job.id);
      j.checkIn ??= { at: nowIso() };
      if (j.status === 'Scheduled') j.status = 'In progress';
    }
  });
  return survey.id;
}

export function createQuickLead(input: { name: string; phone: string; address: string; state: string; propertyType: PropertyType; whatsappConsent: boolean }): ID {
  const lead: Lead = { id: uid('l_'), location: input.address.split(',')[0], source: 'Walk-in', stage: 'New', createdAt: nowIso(), ...input };
  update((d) => {
    d.leads.push(lead);
    notify(d, `New lead logged on site: ${lead.name}`, `/office/leads/${lead.id}`);
  });
  return lead.id;
}

/** Edit a draft survey; load totals and the recommendation are recalculated each time (E3-1, E3-2). */
export function editSurvey(surveyId: ID, fn: (s: Survey) => void) {
  update((d) => {
    const s = d.surveys.find((x) => x.id === surveyId)!;
    fn(s);
    const { peakW, dailyWh } = loadTotals(s.appliances);
    s.peakW = peakW;
    s.dailyWh = dailyWh;
    s.recommended = sizeSystem(peakW, dailyWh, s.sunHours, s.backupHours, s.recommended.panelWatts);
  });
}

export function addAppliance(surveyId: ID, a: Omit<SurveyAppliance, 'id'>) {
  editSurvey(surveyId, (s) => {
    const same = s.appliances.find((x) => x.name === a.name && x.watts === a.watts);
    if (same) same.qty += a.qty;
    else s.appliances.push({ id: uid('ap_'), ...a });
  });
}

export function submitSurvey(surveyId: ID) {
  update((d) => {
    const s = d.surveys.find((x) => x.id === surveyId)!;
    const lead = d.leads.find((l) => l.id === s.leadId)!;
    s.status = 'submitted';
    s.photos.forEach((p) => (p.uploaded = p.uploaded || isOnline()));
    // Backend mode: the server moves the lead on, closes the survey job and tells the office
    if (isBackend) return;
    if (lead.stage === 'New') lead.stage = 'Surveyed';
    if (s.jobId) {
      const job = findJob(d, s.jobId);
      job.status = 'Done';
      job.completedAt = nowIso();
      job.checkOut ??= { at: nowIso() };
      job.checklist.forEach((c) => (c.done = true));
      touchJobFromField(d, job.id);
    }
    notify(d, `Site survey for ${lead.name} is ready to quote`, `/office/leads/${lead.id}`);
  });
}

