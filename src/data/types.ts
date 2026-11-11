// Domain model for the Solar Installer Field Service Platform (see FRD).

export type ID = string;
export type ISODate = string;

export type Role = 'owner' | 'office' | 'technician' | 'viewer';

export type User = {
  id: ID;
  name: string;
  phone: string;
  role: Role;
  title: string;
  active: boolean;
  /** Set when the owner signed this person out of all phones (backend only) */
  signedOutAt?: string;
};

export type Company = {
  name: string;
  logoDataUrl?: string;
  /** Storage path of the uploaded logo (backend mode) */
  logoPath?: string;
  address: string;
  state: string;
  phone: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  /** Days before a sent quote needs a follow-up (E2-2) */
  followUpDays: number;
  /** Default service interval in months for new installations (E8-1) */
  serviceIntervalMonths: number;
  labourPrice: number;
  transportPrice: number;
  /** Target margin used when pre-filling quotes (E4-1) */
  defaultValidDays: number;
  defaultDepositPct: number;
  subscription: {
    status: 'trial' | 'active' | 'past_due';
    seats: number;
    trialEndsAt: ISODate;
    paidUntil?: ISODate;
  };
  setupCompletedAt?: ISODate;
};

export type ItemCategory = 'panel' | 'battery' | 'inverter' | 'accessory' | 'service';

export type PriceItem = {
  id: ID;
  category: ItemCategory;
  brand: string;
  model: string;
  /** Specs: panel W, battery Ah + V + kWh, inverter kVA */
  watts?: number;
  ah?: number;
  volts?: number;
  kwh?: number;
  kva?: number;
  cost: number;
  price: number;
  warrantyYears: number;
};

export type LeadStage = 'New' | 'Surveyed' | 'Quoted' | 'Won' | 'Lost';
export type LeadSource = 'Call' | 'WhatsApp' | 'Walk-in' | 'Web form' | 'Referral';
export type PropertyType = 'Home' | 'Shop' | 'Office' | 'Clinic' | 'School' | 'Other';

export type Lead = {
  id: ID;
  name: string;
  phone: string;
  location: string;
  address: string;
  state: string;
  source: LeadSource;
  propertyType: PropertyType;
  stage: LeadStage;
  notes?: string;
  /** NDPA 2023: consent to WhatsApp messages (NFR-13) */
  whatsappConsent: boolean;
  createdAt: ISODate;
};

export type GPS = { lat: number; lng: number; accuracy?: number };

export type PhotoKind = 'roof' | 'db' | 'wiring' | 'before' | 'after' | 'fault' | 'proof' | 'other';

export type Photo = {
  id: ID;
  kind: PhotoKind;
  /** Compressed JPEG data URL, ≤ 300 KB (E6-4, NFR-4). Empty for seeded placeholders. */
  dataUrl: string;
  bytes: number;
  /** Storage path once uploaded (backend mode); dataUrl then holds a signed URL */
  storagePath?: string;
  takenAt: ISODate;
  gps?: GPS;
  uploaded: boolean;
};

export type SurveyAppliance = { id: ID; name: string; watts: number; hours: number; qty: number };

export type SystemSize = { kva: number; batteryKwh: number; panels: number; panelWatts: number };

export type Survey = {
  id: ID;
  leadId: ID;
  jobId?: ID;
  technicianId: ID;
  createdAt: ISODate;
  status: 'draft' | 'submitted';
  appliances: SurveyAppliance[];
  state: string;
  sunHours: number;
  backupHours: number;
  peakW: number;
  dailyWh: number;
  recommended: SystemSize;
  /** Technician overrides of the recommendation (E3-2) */
  override?: Partial<SystemSize>;
  photos: Photo[];
  notes?: string;
};

export type QuoteLine = {
  id: ID;
  itemId?: ID;
  category: ItemCategory;
  description: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
};

export type QuoteOption = {
  id: ID;
  name: string;
  backupHours: number;
  lines: QuoteLine[];
};

export type QuoteStatus = 'Draft' | 'Sent' | 'Accepted' | 'Declined' | 'Expired';

export type Quote = {
  id: ID;
  number: string;
  leadId: ID;
  surveyId?: ID;
  createdAt: ISODate;
  status: QuoteStatus;
  validDays: number;
  depositPct: number;
  options: QuoteOption[];
  selectedOptionId?: ID;
  sentAt?: ISODate;
  acceptedAt?: ISODate;
  lastFollowUpAt?: ISODate;
};

export type JobType = 'Installation' | 'Maintenance' | 'Fault repair' | 'Site survey';
export type JobStatus = 'Unscheduled' | 'Scheduled' | 'In progress' | 'Done' | 'Cancelled';

export type ChecklistStep = { id: ID; label: string; hint: string; required: boolean; done: boolean };

export type SerialRecord = {
  id: ID;
  label: string;
  category: ItemCategory;
  itemId?: ID;
  serial: string;
  method: 'scan' | 'manual';
  warrantyYears: number;
};

export type ExtraMaterial = { id: ID; description: string; qty: number; itemId?: ID; flaggedForInvoice: boolean; invoiceId?: ID };

export type Job = {
  id: ID;
  number: string;
  leadId: ID;
  type: JobType;
  status: JobStatus;
  quoteId?: ID;
  installationId?: ID;
  ticketId?: ID;
  /** Scheduled start (local ISO) */
  start?: ISODate;
  durationHours: number;
  assigneeIds: ID[];
  address: string;
  gps?: GPS;
  equipment: { description: string; qty: number; category: ItemCategory; itemId?: ID }[];
  checklist: ChecklistStep[];
  checkIn?: { at: ISODate; gps?: GPS };
  checkOut?: { at: ISODate; gps?: GPS };
  serials: SerialRecord[];
  photos: Photo[];
  signature?: { dataUrl: string; name: string; at: ISODate; storagePath?: string };
  extras: ExtraMaterial[];
  completedAt?: ISODate;
  /** Field data waiting to sync (NFR-1) */
  pendingSync: boolean;
  /** Office edited the job while the phone had unsynced field data (NFR-2) */
  syncConflict?: string;
  /** Maintenance plan the customer chose at handover; the server applies it on completion (backend mode) */
  handoverPlanId?: ID;
  notes?: string;
  updatedAt: ISODate;
};

export type InstalledItem = {
  id: ID;
  label: string;
  category: ItemCategory;
  serial?: string;
  warrantyYears: number;
  warrantyEndsAt: ISODate;
};

export type Installation = {
  id: ID;
  leadId: ID;
  jobId: ID;
  installedAt: ISODate;
  technicianIds: ID[];
  site: string;
  items: InstalledItem[];
  photoIds: ID[];
  serviceIntervalMonths: number;
  nextServiceAt: ISODate;
  lastServiceReminderAt?: ISODate;
  planId?: ID;
  planStartedAt?: ISODate;
  planRenewsAt?: ISODate;
  planVisitsLeft?: number;
  lastRenewalReminderAt?: ISODate;
};

export type MaintenancePlan = { id: ID; name: string; price: number; visitsPerYear: number };

export type TicketStatus = 'Open' | 'Scheduled' | 'Resolved';

export type Ticket = {
  id: ID;
  number: string;
  installationId?: ID;
  leadId: ID;
  description: string;
  channel: 'Link' | 'WhatsApp' | 'Call';
  photos: Photo[];
  createdAt: ISODate;
  status: TicketStatus;
  jobId?: ID;
  updates: { id?: ID; at: ISODate; text: string }[];
};

export type InvoiceKind = 'Deposit' | 'Balance' | 'Instalment' | 'Extras' | 'Maintenance plan' | 'Service';

export type Invoice = {
  id: ID;
  number: string;
  leadId: ID;
  quoteId?: ID;
  jobId?: ID;
  kind: InvoiceKind;
  description: string;
  amount: number;
  issuedAt: ISODate;
  dueAt: ISODate;
  /** Day offsets (0, 3, 7) for which a reminder went out (E9-3) */
  remindersSent: number[];
};

export type PaymentMethod = 'Card' | 'Transfer' | 'USSD' | 'Cash' | 'Bank transfer (outside app)';

export type Payment = {
  id: ID;
  invoiceId: ID;
  amount: number;
  method: PaymentMethod;
  at: ISODate;
  status: 'Confirmed' | 'Pending approval' | 'Rejected';
  reference: string;
  proofPhoto?: Photo;
  recordedById?: ID;
  approvedById?: ID;
};

export type MessageChannel = 'WhatsApp' | 'SMS';

/** Outbox for simulated WhatsApp Business API / SMS sends. */
export type Message = {
  id: ID;
  at: ISODate;
  channel: MessageChannel;
  to: string;
  toName: string;
  text: string;
  link?: string;
  /** What triggered it, e.g. 'quote', 'payment-reminder' */
  topic: string;
};

export type Notification = { id: ID; at: ISODate; text: string; link?: string; read: boolean; forRoles: Role[] };

export type AuditEntity = 'quote' | 'price' | 'payment' | 'invoice';

export type AuditEntry = {
  id: ID;
  at: ISODate;
  userId: ID;
  entity: AuditEntity;
  entityId: ID;
  summary: string;
  before?: unknown;
  after?: unknown;
};

export type ChecklistTemplate = { jobType: JobType; steps: { id: ID; label: string; hint: string; required: boolean }[] };

export type DB = {
  version: number;
  company: Company;
  users: User[];
  priceItems: PriceItem[];
  leads: Lead[];
  surveys: Survey[];
  quotes: Quote[];
  jobs: Job[];
  installations: Installation[];
  plans: MaintenancePlan[];
  tickets: Ticket[];
  invoices: Invoice[];
  payments: Payment[];
  messages: Message[];
  notifications: Notification[];
  audit: AuditEntry[];
  checklistTemplates: ChecklistTemplate[];
  counters: Record<string, number>;
};
