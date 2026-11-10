// Settings mutations (company, price list, staff, checklists, subscription).
// Kept out of the screens so the backend swap only has to replace this file.
import { addMonths } from './domain';
import { addAudit, nowIso, update } from './store';
import type { ChecklistTemplate, Company, ID, JobType, PriceItem, User } from './types';

export function saveCompany(c: Company) {
  update((d) => {
    d.company = { ...c, subscription: d.company.subscription, setupCompletedAt: d.company.setupCompletedAt ?? nowIso() };
  });
}

export function savePriceItem(item: PriceItem) {
  update((d) => {
    const idx = d.priceItems.findIndex((p) => p.id === item.id);
    const before = idx >= 0 ? d.priceItems[idx] : undefined;
    if (idx >= 0) d.priceItems[idx] = item;
    else d.priceItems.push(item);
    addAudit(d, 'price', item.id, `${before ? 'Edited' : 'Added'} ${item.brand} ${item.model}`, before, item);
  });
}

export function importPriceItems(items: PriceItem[]) {
  update((d) => {
    for (const it of items) {
      d.priceItems.push(it);
      addAudit(d, 'price', it.id, `Imported ${it.brand} ${it.model} from CSV`, undefined, it);
    }
  });
}

export function deletePriceItem(item: PriceItem) {
  update((d) => {
    d.priceItems = d.priceItems.filter((p) => p.id !== item.id);
    addAudit(d, 'price', item.id, `Deleted ${item.brand} ${item.model}`, item, undefined);
  });
}

export function saveStaff(user: User) {
  update((d) => {
    const i = d.users.findIndex((x) => x.id === user.id);
    if (i >= 0) d.users[i] = user;
    else d.users.push(user);
  });
}

export function saveChecklistTemplate(jobType: JobType, steps: ChecklistTemplate['steps']) {
  update((d) => {
    const t = d.checklistTemplates.find((x) => x.jobType === jobType);
    if (t) t.steps = steps;
    else d.checklistTemplates.push({ jobType, steps });
  });
}

/** E11-2: simulated subscription payment for one month of the given seats. */
export function paySubscription(seats: number) {
  update((d) => {
    const s = d.company.subscription;
    const from = s.paidUntil && new Date(s.paidUntil) > new Date() ? s.paidUntil : nowIso();
    d.company.subscription = { ...s, status: 'active', seats, paidUntil: addMonths(from, 1) };
  });
}

export function resolveSyncConflict(jobId: ID) {
  update((d) => {
    const j = d.jobs.find((x) => x.id === jobId);
    if (j) j.syncConflict = undefined;
  });
}
