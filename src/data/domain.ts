// Pure business rules shared by every surface: sizing, quote maths, permissions, formatting.
import { publicAppUrl } from './remote/config';
import type { DB, ID, Invoice, ItemCategory, PriceItem, Quote, QuoteLine, QuoteOption, Role, SurveyAppliance, SystemSize } from './types';

// ---------- formatting ----------

export const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
export const nairaShort = (n: number) => (n >= 1_000_000 ? `₦${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `₦${Math.round(n / 1000)}k` : naira(n));

export const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : '—');
export const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDateTime = (iso?: string) => (iso ? `${fmtDate(iso)}, ${fmtTime(iso)}` : '—');

export const DAY = 86_400_000;
export const addDays = (iso: string | Date, days: number) => new Date(new Date(iso).getTime() + days * DAY).toISOString();
export const addMonths = (iso: string | Date, months: number) => {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
};
export const daysBetween = (a: string | Date, b: string | Date) => Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DAY);
export const isSameDay = (a: string | Date, b: string | Date) => new Date(a).toDateString() === new Date(b).toDateString();

/** wa.me link for one-tap WhatsApp (E2-2). Nigerian numbers: 0803… → 234803… */
export function whatsappLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, '').replace(/^0/, '234');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function mapsLink(address: string, gps?: { lat: number; lng: number }) {
  const q = gps ? `${gps.lat},${gps.lng}` : address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

/** Absolute URL for a customer-facing link (quote, payment, fault report). */
export const publicUrl = (path: string) => `${publicAppUrl()}${path}`;

// ---------- permissions (E11-1, NFR-10) ----------

export type Permission =
  | 'office.access'
  | 'tech.access'
  | 'view.costs'
  | 'edit.prices'
  | 'edit.quotes'
  | 'edit.leads'
  | 'edit.schedule'
  | 'approve.payments'
  | 'record.payments'
  | 'manage.staff'
  | 'manage.billing'
  | 'manage.settings'
  | 'view.audit';

const rolePerms: Record<Role, Permission[]> = {
  owner: ['office.access', 'tech.access', 'view.costs', 'edit.prices', 'edit.quotes', 'edit.leads', 'edit.schedule', 'approve.payments', 'record.payments', 'manage.staff', 'manage.billing', 'manage.settings', 'view.audit'],
  office: ['office.access', 'edit.quotes', 'edit.leads', 'edit.schedule', 'record.payments'],
  technician: ['tech.access'],
  viewer: ['office.access'],
};

export const can = (role: Role | undefined, perm: Permission) => !!role && rolePerms[role].includes(perm);

export const roleLabel: Record<Role, string> = { owner: 'Owner', office: 'Office', technician: 'Technician', viewer: 'Viewer' };

// ---------- load calculation and sizing (E3-1, E3-2) ----------

export const appliancePresets: { name: string; watts: number; hours: number }[] = [
  { name: 'LED bulbs', watts: 10, hours: 6 },
  { name: 'Ceiling fan', watts: 75, hours: 10 },
  { name: 'Standing fan', watts: 70, hours: 10 },
  { name: 'Television', watts: 120, hours: 6 },
  { name: 'Decoder', watts: 25, hours: 6 },
  { name: 'Fridge', watts: 150, hours: 12 },
  { name: 'Deep freezer', watts: 200, hours: 14 },
  { name: 'Drug fridge', watts: 150, hours: 12 },
  { name: 'Laptop', watts: 65, hours: 8 },
  { name: 'Desktop computer', watts: 200, hours: 8 },
  { name: 'Wi-Fi router', watts: 15, hours: 24 },
  { name: 'Water pump (1 hp)', watts: 750, hours: 1 },
  { name: 'Air conditioner (1 hp)', watts: 900, hours: 6 },
  { name: 'Microwave', watts: 1000, hours: 0.5 },
  { name: 'Pressing iron', watts: 1000, hours: 0.5 },
  { name: 'POS terminal', watts: 10, hours: 10 },
  { name: 'CCTV (4 cameras)', watts: 40, hours: 24 },
];

/** Average peak sun hours by state. Placeholder values until NASA POWER / PVGIS is wired in. */
export const sunHoursByState: Record<string, number> = {
  Lagos: 4.5,
  Ogun: 4.7,
  Oyo: 5.0,
  FCT: 5.5,
  Rivers: 4.2,
  Enugu: 4.8,
  Kaduna: 5.8,
  Kano: 6.0,
  Other: 5.0,
};

export const inverterSizes = [1.5, 3, 5, 7.5, 10, 15];

export function loadTotals(appliances: SurveyAppliance[]) {
  let peakW = 0;
  let dailyWh = 0;
  for (const a of appliances) {
    peakW += a.watts * a.qty;
    dailyWh += a.watts * a.qty * a.hours;
  }
  return { peakW, dailyWh };
}

/**
 * Recommended system from the load:
 * inverter with 25% headroom over peak; battery covers the average load for the backup hours at 80% depth of discharge,
 * rounded up to 5 kWh; panels cover the daily energy at the site's sun hours with 75% system efficiency.
 */
export function sizeSystem(peakW: number, dailyWh: number, sunHours: number, backupHours: number, panelWatts = 550): SystemSize {
  const kva = inverterSizes.find((s) => s >= (peakW * 1.25) / 1000) ?? inverterSizes[inverterSizes.length - 1];
  const avgW = dailyWh / 24;
  const batteryKwh = Math.max(5, Math.ceil((avgW * backupHours) / 0.8 / 5000) * 5);
  const panels = Math.max(1, Math.ceil(dailyWh / (sunHours * 0.75) / panelWatts));
  return { kva, batteryKwh, panels, panelWatts };
}

export const effectiveSize = (rec: SystemSize, override?: Partial<SystemSize>): SystemSize => ({ ...rec, ...override });

export const describeSize = (s: SystemSize) => `${s.kva} kVA inverter · ${s.batteryKwh} kWh battery · ${s.panels} × ${s.panelWatts} W panels`;

// ---------- quotes (E4-1, E4-2, E4-5) ----------

export const lineTotal = (l: QuoteLine) => l.qty * l.unitPrice;
export const optionTotal = (o: QuoteOption) => o.lines.reduce((s, l) => s + lineTotal(l), 0);
export const optionCost = (o: QuoteOption) => o.lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
export const optionMarginPct = (o: QuoteOption) => {
  const t = optionTotal(o);
  return t ? ((t - optionCost(o)) / t) * 100 : 0;
};
export const selectedOption = (q: Quote) => q.options.find((o) => o.id === q.selectedOptionId) ?? q.options[Math.min(1, q.options.length - 1)];
export const quoteValidUntil = (q: Quote) => addDays(q.sentAt ?? q.createdAt, q.validDays);

const lineId = () => crypto.randomUUID();

export function lineFromItem(item: PriceItem, qty: number): QuoteLine {
  return { id: lineId(), itemId: item.id, category: item.category, description: itemLabel(item), qty, unitPrice: item.price, unitCost: item.cost };
}

export function itemLabel(i: PriceItem) {
  const spec =
    i.category === 'panel' ? `${i.watts} W panel` : i.category === 'battery' ? `${i.kwh} kWh battery` : i.category === 'inverter' ? `${i.kva} kVA inverter` : '';
  return [i.brand, i.model, spec && `· ${spec}`].filter(Boolean).join(' ');
}

const cheapest = (items: PriceItem[]) => [...items].sort((a, b) => a.price - b.price)[0];

/** Pre-fill quote lines for a system size from the price list, plus labour and transport. */
export function linesForSize(db: Pick<DB, 'priceItems' | 'company'>, size: SystemSize): QuoteLine[] {
  const items = db.priceItems;
  const lines: QuoteLine[] = [];
  const inverters = items.filter((i) => i.category === 'inverter' && (i.kva ?? 0) >= size.kva);
  const inverter = cheapest(inverters.length ? inverters : items.filter((i) => i.category === 'inverter'));
  if (inverter) lines.push(lineFromItem(inverter, 1));

  // Cheapest battery combination that covers the capacity; ties go to less spare capacity
  const batteryOptions = items
    .filter((i) => i.category === 'battery' && i.kwh)
    .map((b) => {
      const qty = Math.max(1, Math.ceil(size.batteryKwh / b.kwh!));
      return { b, qty, total: qty * b.price, spare: qty * b.kwh! - size.batteryKwh };
    })
    .sort((x, y) => x.total - y.total || x.spare - y.spare);
  if (batteryOptions[0]) lines.push(lineFromItem(batteryOptions[0].b, batteryOptions[0].qty));

  const panelsList = items.filter((i) => i.category === 'panel');
  const panel = panelsList.find((p) => p.watts === size.panelWatts) ?? cheapest(panelsList);
  if (panel) lines.push(lineFromItem(panel, Math.max(1, Math.ceil((size.panels * size.panelWatts) / (panel.watts ?? size.panelWatts)))));

  const bos = items.find((i) => i.category === 'accessory');
  if (bos) lines.push(lineFromItem(bos, 1));

  lines.push({ id: lineId(), category: 'service', description: 'Installation labour', qty: 1, unitPrice: db.company.labourPrice, unitCost: Math.round(db.company.labourPrice * 0.6) });
  lines.push({ id: lineId(), category: 'service', description: 'Transport', qty: 1, unitPrice: db.company.transportPrice, unitCost: db.company.transportPrice });
  return lines;
}

/** Basic / Recommended / Premium options from one load: half, same and 1.5× the backup hours. */
export function optionsForLoad(db: Pick<DB, 'priceItems' | 'company'>, peakW: number, dailyWh: number, sunHours: number, backupHours: number, base?: SystemSize): QuoteOption[] {
  const tiers: [string, number][] = [
    ['Basic', 0.5],
    ['Recommended', 1],
    ['Premium', 1.5],
  ];
  const avgW = dailyWh / 24;
  let prev: SystemSize | undefined;
  return tiers.map(([name, f], i) => {
    let size = sizeSystem(peakW, dailyWh, sunHours, Math.max(2, Math.round(backupHours * f)));
    if (i === 1 && base) size = base;
    // Small loads round every tier to the same battery; step each tier up so the options really differ
    else if (prev && size.batteryKwh <= prev.batteryKwh) size = { ...size, batteryKwh: prev.batteryKwh + 5 };
    if (i === 2) size = { ...size, kva: inverterSizes.find((s) => s > size.kva) ?? size.kva };
    prev = size;
    // Quote the backup the battery really gives at 80% depth of discharge
    const hours = avgW ? Math.min(48, Math.floor((size.batteryKwh * 1000 * 0.8) / avgW)) : backupHours;
    return { id: crypto.randomUUID(), name, backupHours: hours, lines: linesForSize(db, size) };
  });
}

// ---------- invoices and payments (E9) ----------

export function invoicePaid(db: Pick<DB, 'payments'>, invoiceId: ID) {
  return db.payments.filter((p) => p.invoiceId === invoiceId && p.status === 'Confirmed').reduce((s, p) => s + p.amount, 0);
}
export const invoiceBalance = (db: Pick<DB, 'payments'>, inv: Invoice) => Math.max(0, inv.amount - invoicePaid(db, inv.id));
export function invoiceStatus(db: Pick<DB, 'payments'>, inv: Invoice, now = new Date()): 'Paid' | 'Part paid' | 'Overdue' | 'Due' | 'Pending approval' {
  const bal = invoiceBalance(db, inv);
  if (bal === 0) return 'Paid';
  if (db.payments.some((p) => p.invoiceId === inv.id && p.status === 'Pending approval')) return 'Pending approval';
  if (new Date(inv.dueAt) < now) return 'Overdue';
  return bal < inv.amount ? 'Part paid' : 'Due';
}

/** Totals across all invoices for a customer (lead). */
export function leadMoney(db: Pick<DB, 'invoices' | 'payments'>, leadId: ID) {
  const invs = db.invoices.filter((i) => i.leadId === leadId);
  const billed = invs.reduce((s, i) => s + i.amount, 0);
  const paid = invs.reduce((s, i) => s + invoicePaid(db, i.id), 0);
  return { billed, paid, owed: billed - paid };
}

export const categoryLabel: Record<ItemCategory, string> = { panel: 'Panel', battery: 'Battery', inverter: 'Inverter', accessory: 'Accessory', service: 'Service' };

export const defaultWarrantyYears: Record<ItemCategory, number> = { panel: 10, battery: 5, inverter: 2, accessory: 1, service: 0 };
