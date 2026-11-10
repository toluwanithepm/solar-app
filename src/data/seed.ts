// Demo data for one installer firm in Lagos. Dates are relative to today so the demo always looks current.
import type { ChecklistTemplate, DB, Installation, Invoice, Job, JobType, Lead, Payment, PriceItem, Quote, Survey, User } from './types';
import { addDays, addMonths, defaultWarrantyYears, linesForSize, loadTotals, optionsForLoad, sizeSystem, sunHoursByState } from './domain';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
/** Local time today (or offset days) at h:mm */
const at = (dayOffset: number, h: number, m = 0) => {
  const d = startOfToday();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export const checklistTemplates: ChecklistTemplate[] = [
  {
    jobType: 'Installation',
    steps: [
      { id: 's1', label: 'Isolate mains and generator', hint: 'Required', required: true },
      { id: 's2', label: 'Mount panels on roof', hint: 'Required · photo of rails', required: true },
      { id: 's3', label: 'Install inverter and batteries', hint: 'Required', required: true },
      { id: 's4', label: 'DC and AC wiring', hint: 'Required · breakers and surge protection', required: true },
      { id: 's5', label: 'Earthing and bonding', hint: 'Required · record earth resistance', required: true },
      { id: 's6', label: 'Configure inverter', hint: 'Battery type and charge limits', required: false },
      { id: 's7', label: 'Test switchover', hint: 'Required · mains off, load stays on', required: true },
      { id: 's8', label: 'Walk customer through the system', hint: 'Optional', required: false },
    ],
  },
  {
    jobType: 'Maintenance',
    steps: [
      { id: 'm1', label: 'Clean panels', hint: 'Required', required: true },
      { id: 'm2', label: 'Check battery voltage and health', hint: 'Required · note readings', required: true },
      { id: 'm3', label: 'Tighten terminals and check cables', hint: 'Required', required: true },
      { id: 'm4', label: 'Update inverter firmware', hint: 'If available', required: false },
      { id: 'm5', label: 'Test switchover', hint: 'Required', required: true },
    ],
  },
  {
    jobType: 'Fault repair',
    steps: [
      { id: 'f1', label: 'Diagnose fault', hint: 'Required · record error codes', required: true },
      { id: 'f2', label: 'Repair or replace part', hint: 'Required · scan any new serial', required: true },
      { id: 'f3', label: 'Test system under load', hint: 'Required', required: true },
    ],
  },
  {
    jobType: 'Site survey',
    steps: [
      { id: 'v1', label: 'Record appliances and hours', hint: 'Required · in the load calculator', required: true },
      { id: 'v2', label: 'Photograph roof, DB board and wiring', hint: 'Required', required: true },
      { id: 'v3', label: 'Agree inverter and battery location', hint: 'Optional', required: false },
    ],
  },
];

export const checklistFor = (type: JobType, templates = checklistTemplates) =>
  (templates.find((t) => t.jobType === type)?.steps ?? []).map((s) => ({ ...s, done: false }));

const users: User[] = [
  { id: 'u_chidi', name: 'Chidi Nwosu', phone: '08031234567', role: 'owner', title: 'Owner', active: true },
  { id: 'u_ngozi', name: 'Ngozi Eze', phone: '08029876543', role: 'office', title: 'Sales and scheduling', active: true },
  { id: 'u_musa', name: 'Musa Ibrahim', phone: '08061112233', role: 'technician', title: 'Lead technician', active: true },
  { id: 'u_kelechi', name: 'Kelechi Obi', phone: '08062223344', role: 'technician', title: 'Installer', active: true },
  { id: 'u_ifeanyi', name: 'Ifeanyi Eze', phone: '08063334455', role: 'technician', title: 'Service technician', active: true },
  { id: 'u_femi', name: 'Femi Ade', phone: '08064445566', role: 'technician', title: 'Installer · Team B', active: true },
  { id: 'u_sola', name: 'Sola Bakare', phone: '08065556677', role: 'technician', title: 'Installer · Team B', active: true },
  { id: 'u_amaka', name: 'Amaka Udo', phone: '08097778899', role: 'viewer', title: 'Accountant', active: true },
];

const priceItems: PriceItem[] = [
  { id: 'p_inv3', category: 'inverter', brand: 'Felicity', model: 'IVEM3024', kva: 3, cost: 520_000, price: 650_000, warrantyYears: 2 },
  { id: 'p_inv5', category: 'inverter', brand: 'Growatt', model: 'SPF 5000 ES', kva: 5, cost: 760_000, price: 950_000, warrantyYears: 2 },
  { id: 'p_inv75', category: 'inverter', brand: 'Deye', model: 'SUN-8K-SG', kva: 7.5, cost: 1_350_000, price: 1_650_000, warrantyYears: 5 },
  { id: 'p_inv10', category: 'inverter', brand: 'Deye', model: 'SUN-10K-SG', kva: 10, cost: 1_800_000, price: 2_200_000, warrantyYears: 5 },
  { id: 'p_bat5', category: 'battery', brand: 'Felicity', model: 'LPBF24200', ah: 200, volts: 24, kwh: 5, cost: 690_000, price: 850_000, warrantyYears: 5 },
  { id: 'p_bat10', category: 'battery', brand: 'Pylontech', model: 'US5000 ×2', ah: 200, volts: 48, kwh: 10, cost: 1_380_000, price: 1_650_000, warrantyYears: 5 },
  { id: 'p_pan450', category: 'panel', brand: 'Jinko', model: 'Tiger Neo 450', watts: 450, cost: 68_000, price: 82_000, warrantyYears: 10 },
  { id: 'p_pan550', category: 'panel', brand: 'Longi', model: 'Hi-MO 5 550', watts: 550, cost: 78_000, price: 95_000, warrantyYears: 10 },
  { id: 'p_bos', category: 'accessory', brand: 'Generic', model: 'Mounting, cabling and surge protection kit', cost: 85_000, price: 120_000, warrantyYears: 1 },
];

const company: DB['company'] = {
  name: 'BrightPath Solar',
  address: '22 Adeola Odeku Street, Victoria Island, Lagos',
  state: 'Lagos',
  phone: '08031234567',
  bankName: 'GTBank',
  accountNumber: '0123456789',
  accountName: 'BrightPath Solar Ltd',
  followUpDays: 3,
  serviceIntervalMonths: 6,
  labourPrice: 80_000,
  transportPrice: 30_000,
  defaultValidDays: 14,
  defaultDepositPct: 50,
  subscription: { status: 'trial', seats: 5, trialEndsAt: addDays(new Date(), 9) },
  setupCompletedAt: addDays(new Date(), -5),
};

export function createSeed(): DB {
  const db: DB = {
    version: 1,
    company,
    users,
    priceItems,
    leads: [],
    surveys: [],
    quotes: [],
    jobs: [],
    installations: [],
    plans: [
      { id: 'plan_basic', name: 'Basic care', price: 60_000, visitsPerYear: 2 },
      { id: 'plan_plus', name: 'Care plus', price: 110_000, visitsPerYear: 4 },
    ],
    tickets: [],
    invoices: [],
    payments: [],
    messages: [],
    notifications: [],
    audit: [],
    checklistTemplates,
    counters: { Q: 2320, SJ: 1050, INV: 3100, T: 210, PAY: 5000 },
  };

  let seq = 0;
  const id = (p: string) => `${p}${++seq}`;
  const num = (p: string) => `${p}-${(db.counters[p] = (db.counters[p] ?? 1000) + 1)}`;

  const lead = (l: Partial<Lead> & Pick<Lead, 'name' | 'phone' | 'location' | 'stage'>): Lead => {
    const full: Lead = {
      id: id('l_'),
      address: l.location,
      state: 'Lagos',
      source: 'Call',
      propertyType: 'Home',
      whatsappConsent: true,
      createdAt: addDays(new Date(), -10),
      ...l,
    };
    db.leads.push(full);
    return full;
  };

  const job = (j: Partial<Job> & Pick<Job, 'leadId' | 'type' | 'status'>): Job => {
    const l = db.leads.find((x) => x.id === j.leadId)!;
    const full: Job = {
      id: id('j_'),
      number: num('SJ'),
      durationHours: 2,
      assigneeIds: [],
      address: l.address,
      equipment: [],
      checklist: checklistFor(j.type),
      serials: [],
      photos: [],
      extras: [],
      pendingSync: false,
      updatedAt: new Date().toISOString(),
      ...j,
    };
    db.jobs.push(full);
    return full;
  };

  const invoice = (inv: Omit<Invoice, 'id' | 'number' | 'remindersSent'> & { remindersSent?: number[] }): Invoice => {
    const full: Invoice = { id: id('i_'), number: num('INV'), remindersSent: [], ...inv };
    db.invoices.push(full);
    return full;
  };

  const pay = (p: Omit<Payment, 'id' | 'reference' | 'status'> & { status?: Payment['status'] }) => {
    db.payments.push({ id: id('pay_'), reference: num('PAY'), status: 'Confirmed', ...p });
  };

  const installation = (leadId: string, jobId: string, installedAt: string, techs: string[], kva: number, kwh: number, panels: number, extra: Partial<Installation> = {}) => {
    const l = db.leads.find((x) => x.id === leadId)!;
    const inv = priceItems.find((p) => p.category === 'inverter' && p.kva === kva) ?? priceItems[0];
    const bat = kwh >= 10 ? priceItems.find((p) => p.id === 'p_bat10')! : priceItems.find((p) => p.id === 'p_bat5')!;
    const pan = priceItems.find((p) => p.id === 'p_pan550')!;
    const item = (label: string, p: PriceItem, serial: string) => ({
      id: id('ii_'),
      label,
      category: p.category,
      serial,
      warrantyYears: p.warrantyYears,
      warrantyEndsAt: addMonths(installedAt, p.warrantyYears * 12),
    });
    const ins: Installation = {
      id: id('ins_'),
      leadId,
      jobId,
      installedAt,
      technicianIds: techs,
      site: l.address,
      items: [
        item(`${inv.brand} ${inv.model} ${inv.kva} kVA inverter`, inv, `${inv.model.slice(0, 4).toUpperCase()}-${1000 + seq}`),
        item(`${bat.brand} ${bat.model} battery`, bat, `BAT-${7000 + seq}`),
        ...Array.from({ length: panels }, (_, k) => item(`${pan.brand} 550 W panel ${k + 1}`, pan, `LG550-${30000 + seq * 10 + k}`)),
      ],
      photoIds: [],
      serviceIntervalMonths: 6,
      nextServiceAt: addMonths(installedAt, 6),
      ...extra,
    };
    db.installations.push(ins);
    return ins;
  };

  // ---- Today's installation: Adaeze (won, deposit paid) ----
  const adaeze = lead({ name: 'Adaeze Okafor', phone: '08051230001', location: 'Lekki Phase 1', address: '14 Admiralty Way, Lekki Phase 1, Lagos', stage: 'Won', source: 'WhatsApp', createdAt: addDays(new Date(), -21) });
  const adaezeSize = { kva: 5, batteryKwh: 10, panels: 8, panelWatts: 550 };
  const adaezeLines = linesForSize(db, adaezeSize);
  const adaezeQuote: Quote = {
    id: id('q_'),
    number: num('Q'),
    leadId: adaeze.id,
    createdAt: addDays(new Date(), -18),
    status: 'Accepted',
    validDays: 14,
    depositPct: 50,
    options: [{ id: 'o_a1', name: 'Recommended', backupHours: 10, lines: adaezeLines }],
    selectedOptionId: 'o_a1',
    sentAt: addDays(new Date(), -18),
    acceptedAt: addDays(new Date(), -15),
  };
  db.quotes.push(adaezeQuote);
  const adaezeTotal = adaezeLines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const adaezeJob = job({
    leadId: adaeze.id,
    type: 'Installation',
    status: 'Scheduled',
    quoteId: adaezeQuote.id,
    start: at(0, 9),
    durationHours: 5,
    assigneeIds: ['u_musa', 'u_kelechi'],
    gps: { lat: 6.4474, lng: 3.4723 },
    equipment: adaezeLines.filter((l) => l.category !== 'service').map((l) => ({ description: l.description, qty: l.qty, category: l.category, itemId: l.itemId })),
  });
  const adaezeDep = invoice({ leadId: adaeze.id, quoteId: adaezeQuote.id, jobId: adaezeJob.id, kind: 'Deposit', description: 'Deposit (50%)', amount: adaezeTotal / 2, issuedAt: addDays(new Date(), -15), dueAt: addDays(new Date(), -15) });
  pay({ invoiceId: adaezeDep.id, amount: adaezeDep.amount, method: 'Transfer', at: addDays(new Date(), -15) });
  invoice({ leadId: adaeze.id, quoteId: adaezeQuote.id, jobId: adaezeJob.id, kind: 'Balance', description: 'Balance at handover (50%)', amount: adaezeTotal / 2, issuedAt: addDays(new Date(), -15), dueAt: at(0, 14) });

  // ---- Bello Pharmacy: surveyed this morning, quote in draft ----
  const bello = lead({ name: 'Bello Pharmacy', phone: '08051230002', location: 'Allen Avenue, Ikeja', address: '41 Allen Avenue, Ikeja, Lagos', stage: 'Surveyed', propertyType: 'Shop', source: 'Walk-in', createdAt: addDays(new Date(), -4) });
  const belloAppliances = [
    { id: 'a1', name: 'LED bulbs', watts: 10, hours: 6, qty: 12 },
    { id: 'a2', name: 'Standing fan', watts: 70, hours: 10, qty: 4 },
    { id: 'a3', name: 'Television', watts: 120, hours: 6, qty: 2 },
    { id: 'a4', name: 'Drug fridge', watts: 150, hours: 12, qty: 1 },
    { id: 'a5', name: 'Laptop', watts: 65, hours: 8, qty: 2 },
    { id: 'a6', name: 'Water pump (1 hp)', watts: 750, hours: 1, qty: 1 },
  ];
  const belloLoad = loadTotals(belloAppliances);
  const belloSurvey: Survey = {
    id: id('sv_'),
    leadId: bello.id,
    technicianId: 'u_musa',
    createdAt: at(0, 8, 10),
    status: 'submitted',
    appliances: belloAppliances,
    state: 'Lagos',
    sunHours: sunHoursByState.Lagos,
    backupHours: 11,
    ...belloLoad,
    recommended: sizeSystem(belloLoad.peakW, belloLoad.dailyWh, sunHoursByState.Lagos, 11),
    photos: [
      { id: id('ph_'), kind: 'roof', dataUrl: '', bytes: 0, takenAt: at(0, 8, 20), gps: { lat: 6.6018, lng: 3.3515 }, uploaded: true },
      { id: id('ph_'), kind: 'db', dataUrl: '', bytes: 0, takenAt: at(0, 8, 24), gps: { lat: 6.6018, lng: 3.3515 }, uploaded: true },
    ],
  };
  db.surveys.push(belloSurvey);
  db.quotes.push({
    id: 'q_bello',
    number: 'Q-2318',
    leadId: bello.id,
    surveyId: belloSurvey.id,
    createdAt: at(0, 8, 40),
    status: 'Draft',
    validDays: 14,
    depositPct: 50,
    options: optionsForLoad(db, belloLoad.peakW, belloLoad.dailyWh, belloSurvey.sunHours, belloSurvey.backupHours),
  });

  // ---- Emeka Stores: quote sent 5 days ago, needs follow-up (E2-2) ----
  const emeka = lead({ name: 'Emeka Stores', phone: '08051230003', location: 'Ojota', address: '7 Ikorodu Road, Ojota, Lagos', stage: 'Quoted', propertyType: 'Shop', createdAt: addDays(new Date(), -9) });
  db.quotes.push({
    id: id('q_'),
    number: num('Q'),
    leadId: emeka.id,
    createdAt: addDays(new Date(), -5),
    status: 'Sent',
    validDays: 14,
    depositPct: 50,
    options: optionsForLoad(db, 1400, 9000, 4.5, 8),
    sentAt: addDays(new Date(), -5),
  });
  const kemi = lead({ name: 'Kemi Adebayo', phone: '08051230011', location: 'Yaba', address: '3 Herbert Macaulay Way, Yaba, Lagos', stage: 'Quoted', createdAt: addDays(new Date(), -6), source: 'Referral' });
  db.quotes.push({
    id: id('q_'),
    number: num('Q'),
    leadId: kemi.id,
    createdAt: addDays(new Date(), -1),
    status: 'Sent',
    validDays: 14,
    depositPct: 50,
    options: optionsForLoad(db, 900, 6000, 4.5, 8),
    sentAt: addDays(new Date(), -1),
  });

  // ---- New enquiries ----
  const lekki = lead({ name: 'Lekki Gardens Estate', phone: '08051230004', location: 'Lekki', address: 'Lekki Gardens Phase 2, Lagos', stage: 'New', propertyType: 'Office', createdAt: addDays(new Date(), -2) });
  lead({ name: "Funke's Salon", phone: '08051230005', location: 'Surulere', address: '12 Adeniran Ogunsanya, Surulere, Lagos', stage: 'New', propertyType: 'Shop', source: 'Web form', createdAt: addDays(new Date(), 0) });
  lead({ name: 'Zainab Bello', phone: '08051230006', location: 'Gbagada', address: 'Gbagada Phase 1, Lagos', stage: 'Lost', notes: 'Went with a cheaper installer', createdAt: addDays(new Date(), -30) });

  job({ leadId: lekki.id, type: 'Site survey', status: 'Scheduled', start: at(0, 15), durationHours: 2, assigneeIds: ['u_kelechi'] });

  // ---- Past installations ----
  const tunde = lead({ name: 'Tunde Adeyemi', phone: '08051230007', location: 'Surulere', address: '18 Bode Thomas Street, Surulere, Lagos', stage: 'Won', createdAt: addMonths(new Date(), -7) });
  const tundeDone = job({ leadId: tunde.id, type: 'Installation', status: 'Done', start: addDays(addMonths(new Date(), -6), 3), completedAt: addDays(addMonths(new Date(), -6), 3), durationHours: 5, assigneeIds: ['u_musa'] });
  const tundeIns = installation(tunde.id, tundeDone.id, tundeDone.completedAt!, ['u_musa'], 3, 5, 6, {
    nextServiceAt: at(0, 15),
    planId: 'plan_basic',
    planStartedAt: tundeDone.completedAt,
    planRenewsAt: addMonths(tundeDone.completedAt!, 12),
    planVisitsLeft: 2,
  });
  tundeDone.installationId = tundeIns.id;
  job({ leadId: tunde.id, type: 'Maintenance', status: 'Scheduled', installationId: tundeIns.id, start: at(0, 15), durationHours: 1.5, assigneeIds: ['u_musa'] });
  const tundeBal = invoice({ leadId: tunde.id, jobId: tundeDone.id, kind: 'Balance', description: 'Balance at handover', amount: 450_000, issuedAt: addDays(new Date(), -12), dueAt: addDays(new Date(), -8), remindersSent: [0, 3] });
  pay({ invoiceId: tundeBal.id, amount: 150_000, method: 'Cash', at: addDays(new Date(), -2), status: 'Pending approval', recordedById: 'u_ngozi' });

  const grace = lead({ name: 'Grace Clinic', phone: '08051230008', location: 'Ikeja GRA', address: '5 Isaac John Street, Ikeja GRA, Lagos', stage: 'Won', propertyType: 'Clinic', createdAt: addMonths(new Date(), -25) });
  const graceDone = job({ leadId: grace.id, type: 'Installation', status: 'Done', start: addDays(addMonths(new Date(), -24), 40), completedAt: addDays(addMonths(new Date(), -24), 40), durationHours: 6, assigneeIds: ['u_musa', 'u_ifeanyi'] });
  const graceIns = installation(grace.id, graceDone.id, graceDone.completedAt!, ['u_musa', 'u_ifeanyi'], 5, 10, 8, { nextServiceAt: addDays(new Date(), 40) });
  graceDone.installationId = graceIns.id;
  const graceTicket = { id: id('t_'), number: num('T'), installationId: graceIns.id, leadId: grace.id, description: 'Inverter beeping and shutting off at night', channel: 'WhatsApp' as const, photos: [], createdAt: addDays(new Date(), -1), status: 'Resolved' as const, updates: [{ at: addDays(new Date(), -1), text: 'Ticket received' }, { at: at(0, 7, 30), text: 'Technician assigned: Ifeanyi' }, { at: at(0, 11, 48), text: 'Fixed: loose battery terminal tightened' }] };
  db.tickets.push(graceTicket);
  job({
    leadId: grace.id,
    type: 'Fault repair',
    status: 'Done',
    installationId: graceIns.id,
    ticketId: graceTicket.id,
    start: at(0, 10, 30),
    durationHours: 1.5,
    assigneeIds: ['u_ifeanyi'],
    checkIn: { at: at(0, 10, 38) },
    checkOut: { at: at(0, 11, 48) },
    completedAt: at(0, 11, 48),
    checklist: checklistFor('Fault repair').map((s) => ({ ...s, done: true })),
  });

  const hope = lead({ name: 'Hope Schools', phone: '08051230009', location: 'Ikorodu', address: 'Hope Schools, Ikorodu, Lagos', stage: 'Won', propertyType: 'School', createdAt: addMonths(new Date(), -10) });
  const hopeDone = job({ leadId: hope.id, type: 'Installation', status: 'Done', start: addMonths(new Date(), -9), completedAt: addMonths(new Date(), -9), durationHours: 6, assigneeIds: ['u_femi', 'u_sola'] });
  const hopeIns = installation(hope.id, hopeDone.id, hopeDone.completedAt!, ['u_femi', 'u_sola'], 7.5, 10, 12, { nextServiceAt: addDays(new Date(), 5) });
  hopeDone.installationId = hopeIns.id;
  db.tickets.push({ id: id('t_'), number: num('T'), installationId: hopeIns.id, leadId: hope.id, description: 'No inverter output since yesterday morning', channel: 'Link', photos: [], createdAt: addDays(new Date(), -1.1), status: 'Open', updates: [{ at: addDays(new Date(), -1.1), text: 'Ticket received' }] });

  const prime = lead({ name: 'Prime Bakery', phone: '08051230010', location: 'Ogba', address: '9 Ogba Road, Ogba, Lagos', stage: 'Won', propertyType: 'Shop', createdAt: addMonths(new Date(), -13) });
  const primeDone = job({ leadId: prime.id, type: 'Installation', status: 'Done', start: addMonths(new Date(), -12), completedAt: addMonths(new Date(), -12), durationHours: 6, assigneeIds: ['u_ifeanyi'] });
  const primeIns = installation(prime.id, primeDone.id, primeDone.completedAt!, ['u_ifeanyi'], 7.5, 10, 10, { nextServiceAt: at(0, 13) });
  primeDone.installationId = primeIns.id;
  job({ leadId: prime.id, type: 'Maintenance', status: 'Scheduled', installationId: primeIns.id, start: at(0, 13), durationHours: 2, assigneeIds: ['u_ifeanyi'] });

  // ---- Team B install, running late ----
  const oak = lead({ name: 'Oak Court Estate', phone: '08051230012', location: 'Ikoyi', address: 'Oak Court, Bourdillon Road, Ikoyi, Lagos', stage: 'Won', propertyType: 'Office', createdAt: addDays(new Date(), -25) });
  const oakLines = linesForSize(db, { kva: 10, batteryKwh: 20, panels: 16, panelWatts: 550 });
  const oakTotal = oakLines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const oakQuote: Quote = { id: id('q_'), number: num('Q'), leadId: oak.id, createdAt: addDays(new Date(), -20), status: 'Accepted', validDays: 14, depositPct: 50, options: [{ id: 'o_oak', name: 'Recommended', backupHours: 12, lines: oakLines }], selectedOptionId: 'o_oak', sentAt: addDays(new Date(), -20), acceptedAt: addDays(new Date(), -17) };
  db.quotes.push(oakQuote);
  const oakJob = job({ leadId: oak.id, type: 'Installation', status: 'Scheduled', quoteId: oakQuote.id, start: at(0, 13), durationHours: 5, assigneeIds: ['u_femi', 'u_sola'], equipment: oakLines.filter((l) => l.category !== 'service').map((l) => ({ description: l.description, qty: l.qty, category: l.category, itemId: l.itemId })) });
  const oakDep = invoice({ leadId: oak.id, quoteId: oakQuote.id, jobId: oakJob.id, kind: 'Deposit', description: 'Deposit (50%)', amount: oakTotal / 2, issuedAt: addDays(new Date(), -17), dueAt: addDays(new Date(), -17) });
  pay({ invoiceId: oakDep.id, amount: oakDep.amount, method: 'Card', at: addDays(new Date(), -17) });
  invoice({ leadId: oak.id, quoteId: oakQuote.id, jobId: oakJob.id, kind: 'Balance', description: 'Balance at handover (50%)', amount: oakTotal / 2, issuedAt: addDays(new Date(), -17), dueAt: at(0, 18) });

  // ---- Unassigned work ----
  const chinedu = lead({ name: 'Chinedu Eze', phone: '08051230013', location: 'Magodo', address: '22 CMD Road, Magodo, Lagos', stage: 'Won', createdAt: addDays(new Date(), -12) });
  const chLines = linesForSize(db, { kva: 5, batteryKwh: 10, panels: 8, panelWatts: 550 });
  const chQuote: Quote = { id: id('q_'), number: num('Q'), leadId: chinedu.id, createdAt: addDays(new Date(), -8), status: 'Accepted', validDays: 14, depositPct: 50, options: [{ id: 'o_ch', name: 'Recommended', backupHours: 10, lines: chLines }], selectedOptionId: 'o_ch', sentAt: addDays(new Date(), -8), acceptedAt: addDays(new Date(), -1) };
  db.quotes.push(chQuote);
  const chJob = job({ leadId: chinedu.id, type: 'Installation', status: 'Unscheduled', quoteId: chQuote.id, durationHours: 5, equipment: chLines.filter((l) => l.category !== 'service').map((l) => ({ description: l.description, qty: l.qty, category: l.category, itemId: l.itemId })) });
  const chTotal = chLines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const chDep = invoice({ leadId: chinedu.id, quoteId: chQuote.id, jobId: chJob.id, kind: 'Deposit', description: 'Deposit (50%)', amount: chTotal / 2, issuedAt: addDays(new Date(), -1), dueAt: addDays(new Date(), -1) });
  pay({ invoiceId: chDep.id, amount: chDep.amount, method: 'USSD', at: addDays(new Date(), -1) });
  invoice({ leadId: chinedu.id, quoteId: chQuote.id, jobId: chJob.id, kind: 'Balance', description: 'Balance at handover (50%)', amount: chTotal / 2, issuedAt: addDays(new Date(), -1), dueAt: addDays(new Date(), 7) });

  const mama = lead({ name: 'Mama Put Kitchen', phone: '08051230014', location: 'Ojodu', address: '4 Ojodu Berger Road, Lagos', stage: 'Won', propertyType: 'Shop', createdAt: addMonths(new Date(), -8) });
  const mamaDone = job({ leadId: mama.id, type: 'Installation', status: 'Done', start: addMonths(new Date(), -6), completedAt: addDays(addMonths(new Date(), -6), 2), durationHours: 4, assigneeIds: ['u_kelechi'] });
  const mamaIns = installation(mama.id, mamaDone.id, mamaDone.completedAt!, ['u_kelechi'], 3, 5, 4, { nextServiceAt: addDays(new Date(), 2) });
  mamaDone.installationId = mamaIns.id;
  job({ leadId: mama.id, type: 'Maintenance', status: 'Unscheduled', installationId: mamaIns.id, durationHours: 1.5 });

  // ---- History for reports: completed jobs and payments over the last 10 weeks ----
  const pastNames = ['Ola Stores', 'Ibukun Okeke', 'Ikoyi Dental', 'Sade Johnson', 'Yaba Tech Hub', 'Bisi Ajayi', 'Royal Pharmacy', 'Uche Nnaji', 'Green Lounge', 'Femi Kuti Jr', 'Ade Motors', 'Rita Okon'];
  const techRot = ['u_musa', 'u_kelechi', 'u_ifeanyi', 'u_femi'];
  pastNames.forEach((name, i) => {
    const doneAt = at(-(4 + i * 6), 15);
    const l = lead({ name, phone: `0805124${String(1000 + i)}`, location: 'Lagos', address: `${10 + i} Awolowo Road, Lagos`, stage: 'Won', createdAt: addDays(doneAt, -20) });
    const kva = [3, 5, 5, 7.5][i % 4];
    const j = job({ leadId: l.id, type: 'Installation', status: 'Done', start: at(-(4 + i * 6), 9), checkIn: { at: at(-(4 + i * 6), 9, 10) }, checkOut: { at: doneAt }, completedAt: doneAt, durationHours: 6, assigneeIds: [techRot[i % 4]] });
    const ins = installation(l.id, j.id, doneAt, [techRot[i % 4]], kva, kva >= 5 ? 10 : 5, kva * 2);
    j.installationId = ins.id;
    const total = kva * 600_000;
    const dep = invoice({ leadId: l.id, jobId: j.id, kind: 'Deposit', description: 'Deposit (50%)', amount: total / 2, issuedAt: addDays(doneAt, -10), dueAt: addDays(doneAt, -10) });
    pay({ invoiceId: dep.id, amount: total / 2, method: (['Card', 'Transfer', 'USSD'] as const)[i % 3], at: addDays(doneAt, -10) });
    const bal = invoice({ leadId: l.id, jobId: j.id, kind: 'Balance', description: 'Balance at handover (50%)', amount: total / 2, issuedAt: doneAt, dueAt: doneAt, remindersSent: [0] });
    if (i !== 1 && i !== 4) pay({ invoiceId: bal.id, amount: total / 2, method: 'Transfer', at: addDays(doneAt, 1) });
  });

  // One maintenance plan payment
  const planInv = invoice({ leadId: tunde.id, kind: 'Maintenance plan', description: 'Basic care plan · 12 months', amount: 60_000, issuedAt: tundeDone.completedAt!, dueAt: tundeDone.completedAt! });
  pay({ invoiceId: planInv.id, amount: 60_000, method: 'Transfer', at: tundeDone.completedAt! });

  db.notifications.push({ id: 'n_web', at: addDays(new Date(), 0), text: "New web enquiry: Funke's Salon, Surulere", link: '/office/leads', read: false, forRoles: ['owner', 'office'] });

  for (const ins of db.installations) {
    for (const it of ins.items) it.warrantyYears ||= defaultWarrantyYears[it.category];
  }
  // Grace Clinic's inverter warranty runs out within 90 days (E7-2)
  graceIns.items[0].warrantyEndsAt = addDays(new Date(), 37);

  return db;
}

/** An empty workspace, used in backend mode until the firm's data has loaded. */
export function createEmpty(): DB {
  const seed = createSeed();
  return {
    ...seed,
    company: { ...seed.company, name: '', address: '', phone: '', bankName: '', accountNumber: '', accountName: '', setupCompletedAt: undefined },
    users: [],
    priceItems: [],
    leads: [],
    surveys: [],
    quotes: [],
    jobs: [],
    installations: [],
    plans: [],
    tickets: [],
    invoices: [],
    payments: [],
    messages: [],
    notifications: [],
    audit: [],
    counters: {},
  };
}
