// The customer journey, from enquiry to aftercare, worked out from the records (no extra data to keep in step).
// Every customer screen shows the same six steps and one "next step", so the office always knows what to do next.
import { invoiceStatus } from './domain';
import type { DB, ID, Lead } from './types';

export type JourneyStepId = 'enquiry' | 'survey' | 'quote' | 'deposit' | 'install' | 'aftercare';

export const journeySteps: { id: JourneyStepId; label: string; who: string; what: string }[] = [
  { id: 'enquiry', label: 'Enquiry', who: 'Office', what: 'A customer calls, messages or fills in your enquiry form. Log them as a customer.' },
  { id: 'survey', label: 'Site survey', who: 'Technician', what: "A technician visits, records the appliances and photos, and the app sizes the system." },
  { id: 'quote', label: 'Quote', who: 'Office', what: 'Build up to three options from your price list and send the quote link on WhatsApp.' },
  { id: 'deposit', label: 'Deposit', who: 'Customer', what: 'The customer accepts online and pays the deposit by card, transfer or USSD. That creates the installation job.' },
  { id: 'install', label: 'Installation', who: 'Technician', what: 'Schedule the job. The technician follows the checklist, scans serials and gets a signature.' },
  { id: 'aftercare', label: 'Aftercare', who: 'Office', what: 'Warranties are registered, service visits are reminded, and customers can report faults.' },
];

export type NextStep =
  | { kind: 'book-survey'; label: string; hint: string }
  | { kind: 'link'; label: string; hint: string; to: string }
  | { kind: 'new-quote'; label: string; hint: string; to: string }
  | { kind: 'none'; label: string; hint: string };

export type Journey = {
  /** Index of the step the customer is on now (0–5) */
  current: number;
  /** Steps passed without doing them (e.g. quoted without a site survey) */
  skipped?: JourneyStepId[];
  lost: boolean;
  next: NextStep;
};

export function journeyFor(db: Pick<DB, 'surveys' | 'quotes' | 'jobs' | 'invoices' | 'payments' | 'installations'>, lead: Lead): Journey {
  const surveys = db.surveys.filter((s) => s.leadId === lead.id);
  const quotes = db.quotes.filter((q) => q.leadId === lead.id);
  const jobs = db.jobs.filter((j) => j.leadId === lead.id && j.status !== 'Cancelled');
  const invoices = db.invoices.filter((i) => i.leadId === lead.id);
  const installed = db.installations.some((i) => i.leadId === lead.id);
  const surveyJob = jobs.find((j) => j.type === 'Site survey' && j.status !== 'Done');
  const install = jobs.find((j) => j.type === 'Installation');
  const accepted = quotes.find((q) => q.status === 'Accepted');
  const sent = quotes.find((q) => q.status === 'Sent');
  const draft = quotes.find((q) => q.status === 'Draft');
  const deposit = invoices.find((i) => i.kind === 'Deposit');
  const balance = invoices.find((i) => i.kind === 'Balance');
  const depositPaid = deposit ? invoiceStatus(db, deposit) === 'Paid' : false;
  const surveyed = surveys.some((s) => s.status === 'submitted');
  const skipped: JourneyStepId[] = surveyed ? [] : ['survey'];

  if (lead.stage === 'Lost') return { current: stepIndex(quotes.length ? 'quote' : 'enquiry'), lost: true, next: { kind: 'none', label: 'Marked as lost', hint: 'Change the stage if they come back.' } };

  if (installed || install?.status === 'Done') {
    if (balance && invoiceStatus(db, balance) !== 'Paid')
      return { current: 5, skipped, lost: false, next: { kind: 'link', label: 'Collect the balance', hint: 'The installation is done; the balance is still owed.', to: '/office/payments' } };
    return { current: 5, skipped, lost: false, next: { kind: 'link', label: 'View their system', hint: 'Warranties and service visits are tracked under Aftercare.', to: installedLink(db, lead.id) } };
  }
  // Accepting creates the installation job straight away, so an unpaid deposit is the step to chase first
  if (accepted && deposit && !depositPaid && !installed && install?.status !== 'In progress')
    return { current: 3, skipped, lost: false, next: { kind: 'link', label: 'Chase the deposit', hint: 'Accepted, waiting for the deposit payment.', to: '/office/payments' } };
  if (install) {
    if (install.status === 'Unscheduled') return { current: 4, skipped, lost: false, next: { kind: 'link', label: 'Schedule the installation', hint: 'Pick a day and the technicians on the Jobs board.', to: '/office/schedule' } };
    return { current: 4, skipped, lost: false, next: { kind: 'link', label: 'Open the installation job', hint: install.status === 'In progress' ? 'The team is on site now.' : 'Booked. The technician will check in on the day.', to: `/office/jobs/${install.id}` } };
  }
  if (accepted) return { current: 3, skipped, lost: false, next: { kind: 'link', label: 'Open the accepted quote', hint: 'Accepted. Schedule the installation from the Jobs board.', to: `/office/quotes/${accepted.id}` } };
  if (sent) return { current: 2, skipped, lost: false, next: { kind: 'link', label: 'Follow up on the quote', hint: 'Sent and waiting for the customer to accept.', to: `/office/quotes/${sent.id}` } };
  if (draft) return { current: 2, skipped, lost: false, next: { kind: 'link', label: 'Finish and send the quote', hint: 'A draft is ready to check and send.', to: `/office/quotes/${draft.id}` } };
  if (surveyed || lead.stage === 'Surveyed') {
    const last = surveys.filter((s) => s.status === 'submitted').at(-1);
    return { current: 2, skipped, lost: false, next: { kind: 'new-quote', label: 'Create the quote', hint: 'The survey is in. The quote starts from its sizing.', to: `/office/quotes/new?leadId=${lead.id}${last ? `&surveyId=${last.id}` : ''}` } };
  }
  if (surveyJob) return { current: 1, lost: false, next: { kind: 'link', label: surveyJob.status === 'Unscheduled' ? 'Schedule the site survey' : 'Open the survey visit', hint: surveyJob.status === 'Unscheduled' ? 'Pick a day and a technician.' : 'Booked. The technician fills it in on their phone.', to: surveyJob.status === 'Unscheduled' ? '/office/schedule' : `/office/jobs/${surveyJob.id}` } };
  return { current: 0, lost: false, next: { kind: 'book-survey', label: 'Book a site survey', hint: 'Or skip it and quote straight away if you already know the load.' } };
}

const stepIndex = (id: JourneyStepId) => journeySteps.findIndex((s) => s.id === id);

function installedLink(db: Pick<DB, 'installations'>, leadId: ID) {
  const ins = db.installations.find((i) => i.leadId === leadId);
  return ins ? `/office/installations/${ins.id}` : '/office/installations';
}
