import { useState } from 'react';
import { Link } from 'react-router-dom';
import '../../styles/office-ops.css';
import { Dialog, MoneyField, SelectField } from '../../components/forms';
import { useCan } from '../../components/Guards';
import { Icon, type IconName } from '../../components/Icon';
import { moneyTabs, OfficeShell, SubNav } from '../../components/OfficeShell';
import { InfoTip } from '../../components/Guide';
import { PhotoInput, PhotoThumb } from '../../components/PhotoInput';
import { Badge, Button, EmptyState, PageHeader, Segmented } from '../../components/ui';
import { fmtDate, fmtDateTime, invoiceBalance, invoicePaid, invoiceStatus, naira, nairaShort, whatsappLink } from '../../data/domain';
import { recordOfflinePayment, reviewPayment } from '../../data/salesActions';
import { useShareLink } from '../../data/remote/shareLinks';
import { useDb } from '../../data/store';
import type { Invoice, Lead, Photo } from '../../data/types';

type Status = ReturnType<typeof invoiceStatus>;
type Filter = 'Open' | Status | 'All';

/** Paid green, overdue red; anything still waiting on money (due, part paid, awaiting approval) reads as amber. */
export const invoiceTone = (s: Status) => ({ Paid: 'green', 'Part paid': 'amber', Overdue: 'red', Due: 'amber', 'Pending approval': 'amber' })[s] as 'green' | 'amber' | 'red' | 'blue';
/** Distinct icons so the amber states can still be told apart without colour. */
const invoiceIcons: Record<Status, IconName | undefined> = { Paid: undefined, 'Part paid': 'money', Overdue: undefined, Due: 'calendar', 'Pending approval': 'clock' };
const reminderLabel = (step: number) => (step === 0 ? 'due date' : `+${step} days`);

export function Payments() {
  const db = useDb();
  const canRecord = useCan('record.payments');
  const canApprove = useCan('approve.payments');
  const [filter, setFilter] = useState<Filter>('Open');
  const [recording, setRecording] = useState<Invoice | null>(null);
  const [copied, setCopied] = useState('');

  const now = new Date();
  const rows = db.invoices.map((inv) => ({ inv, status: invoiceStatus(db, inv, now), lead: db.leads.find((l) => l.id === inv.leadId), job: db.jobs.find((j) => j.id === inv.jobId) }));
  const shown = rows
    .filter((r) => (filter === 'All' ? true : filter === 'Open' ? r.status !== 'Paid' : r.status === filter))
    .sort((a, b) => a.inv.dueAt.localeCompare(b.inv.dueAt));
  const pending = db.payments.filter((p) => p.status === 'Pending approval');
  const owed = rows.reduce((s, r) => s + invoiceBalance(db, r.inv), 0);
  const overdue = rows.filter((r) => r.status === 'Overdue').reduce((s, r) => s + invoiceBalance(db, r.inv), 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const collected = db.payments.filter((p) => p.status === 'Confirmed' && new Date(p.at) >= monthStart).reduce((s, p) => s + p.amount, 0);
  const viaLinks = db.payments.filter((p) => p.status === 'Confirmed' && new Date(p.at) >= monthStart && ['Card', 'Transfer', 'USSD'].includes(p.method)).reduce((s, p) => s + p.amount, 0);

  const count = (s: Filter) => rows.filter((r) => (s === 'Open' ? r.status !== 'Paid' : s === 'All' ? true : r.status === s)).length;

  return (
    <OfficeShell>
      <PageHeader title="Money" subtitle="Deposits, balances and instalments from accepted quotes" />
      <SubNav items={moneyTabs} />

      <div className="kpi-grid">
        <div className="card kpi">
          <span className="kpi__label">Collected this month</span>
          <span className="kpi__value num">
            {nairaShort(collected)}
          </span>
          <span className="t-caption faint">{collected ? Math.round((viaLinks / collected) * 100) : 0}% through payment links</span>
        </div>
        <div className="card kpi">
          <span className="kpi__label">Owed by customers</span>
          <span className="kpi__value num">
            {nairaShort(owed)}
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi__label">Overdue</span>
          <span className={`kpi__value num${overdue ? ' kpi__value--danger' : ''}`}>
            {nairaShort(overdue)}
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi__label">Waiting for approval</span>
          <span className="kpi__value num">
            {pending.length}
          </span>
          {pending.length > 0 && <span className="t-caption faint">Cash and bank payments to check</span>}
        </div>
      </div>

      {pending.length > 0 && (
        <section aria-labelledby="approve" className="card">
          <div className="card__head">
            <div className="stack" style={{ gap: 2 }}>
              <h2 id="approve" className="t-section">
                Cash and bank payments to approve
              </h2>
              <span className="t-small muted">Recorded outside the app. {canApprove ? 'Check the proof, then approve to update the balance.' : 'The owner approves these.'}</span>
            </div>
            <Badge tone="amber">{pending.length} waiting</Badge>
          </div>
          <div className="ops-card__body">
          {pending.map((p) => {
            const inv = db.invoices.find((i) => i.id === p.invoiceId)!;
            const lead = db.leads.find((l) => l.id === inv.leadId);
            const by = db.users.find((u) => u.id === p.recordedById);
            return (
              <div key={p.id} className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
                {p.proofPhoto ? (
                  <PhotoThumb photo={p.proofPhoto} label="Payment proof" style={{ width: 56, height: 56, borderRadius: 'var(--radius)', flexShrink: 0 }} />
                ) : (
                  <span className="t-caption faint" style={{ width: 56, flexShrink: 0, textAlign: 'center' }}>
                    No proof
                  </span>
                )}
                <span className="row__main" style={{ minWidth: 220 }}>
                  <span>
                    <span className="strong num">{naira(p.amount)}</span> {p.method.toLowerCase()} · {lead?.name}
                  </span>
                  <span className="t-small muted">
                    {inv.number} · {inv.description} · recorded by {by?.name ?? 'staff'}, {fmtDateTime(p.at)}
                  </span>
                </span>
                <span className="term">
                  <Badge tone="amber">Awaiting approval</Badge>
                  <InfoTip term="pendingApproval" />
                </span>
                {canApprove && (
                  <span style={{ display: 'flex', gap: 8 }}>
                    <Button variant="text" size="sm" onClick={() => reviewPayment(p.id, false)}>
                      Reject
                    </Button>
                    <Button size="sm" onClick={() => reviewPayment(p.id, true)}>
                      Approve
                    </Button>
                  </span>
                )}
              </div>
            );
          })}
          </div>
        </section>
      )}

      <div className="ops-filters__scroll">
        <Segmented
          label="Filter invoices"
          value={filter}
          onChange={setFilter}
          options={(['Open', 'Overdue', 'Due', 'Part paid', 'Pending approval', 'Paid', 'All'] as const).map((s) => ({ id: s, name: `${s} (${count(s)})` }))}
        />
      </div>

      <section className="card" aria-label="Invoices">
        {shown.length === 0 ? (
          <EmptyState title="No invoices here">{filter === 'Open' ? 'Every invoice is paid. New invoices are raised when a customer accepts a quote.' : 'Try another filter.'}</EmptyState>
        ) : (
          <div className="table-scroll">
          <table className="table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Customer</th>
                <th scope="col">Milestone</th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col" className="num">
                  Balance
                </th>
                <th scope="col">Due</th>
                <th scope="col">Status</th>
                <th scope="col">Reminders sent</th>
                <th scope="col" className="num">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ inv, status, lead, job }) => {
                const bal = invoiceBalance(db, inv);
                return (
                  <tr key={inv.id}>
                    <td className="strong num" style={{ whiteSpace: 'nowrap' }}>
                      {inv.number}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{lead ? <Link to={`/office/leads/${lead.id}`}>{lead.name}</Link> : '—'}</td>
                    <td>
                      <span className="stack" style={{ gap: 2 }}>
                        <span>{inv.kind}</span>
                        <span className="t-small muted">{job ? `${job.number} · ${job.type}` : inv.description}</span>
                      </span>
                    </td>
                    <td className="num">{naira(inv.amount)}</td>
                    <td className={`num${bal ? ' strong' : ' muted'}`}>
                      {naira(bal)}
                      {bal > 0 && invoicePaid(db, inv.id) > 0 && (
                        <div className="t-caption faint" style={{ fontWeight: 400 }}>
                          {naira(invoicePaid(db, inv.id))} paid
                        </div>
                      )}
                    </td>
                    <td className={status === 'Overdue' ? 'danger' : 'muted'} style={{ whiteSpace: 'nowrap' }}>
                      {fmtDate(inv.dueAt)}
                    </td>
                    <td>
                      <Badge tone={invoiceTone(status)} icon={invoiceIcons[status]}>
                        {status === 'Pending approval' ? 'Awaiting approval' : status}
                      </Badge>
                    </td>
                    <td className="t-small muted">{inv.remindersSent.length ? [...inv.remindersSent].sort((a, b) => a - b).map(reminderLabel).join(', ') : '—'}</td>
                    <td>
                      {bal > 0 && (
                        <span className="ops-actions">
                          <PayLinkButtons inv={inv} lead={lead} balance={bal} copied={copied === inv.id} onCopied={() => setCopied(inv.id)} />
                          {canRecord && (
                            <Button variant="text" size="sm" onClick={() => setRecording(inv)}>
                              Record payment
                            </Button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>
      <span className="t-small faint">Unpaid balances get WhatsApp and SMS reminders automatically on the due date, then 3 and 7 days after.</span>

      {recording && <RecordPaymentDialog invoice={recording} onClose={() => setRecording(null)} />}
    </OfficeShell>
  );
}

/** E9-4: cash or bank payment made outside the app, with a proof photo; the owner approves it. */
function RecordPaymentDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const payments = useDb((d) => d.payments);
  const balance = invoiceBalance({ payments }, invoice);
  const [amount, setAmount] = useState<number>(balance);
  const [method, setMethod] = useState<'Cash' | 'Bank transfer (outside app)'>('Cash');
  const [proof, setProof] = useState<Photo>();
  const value = Math.round(amount);
  const valid = value > 0 && value <= balance && !!proof;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Record payment · ${invoice.number}`}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              recordOfflinePayment(invoice.id, value, method, proof);
              onClose();
            }}
          >
            Submit for approval
          </Button>
        </>
      }
    >
      <span className="t-small muted">
        {invoice.description} · {naira(balance)} outstanding
      </span>
      <MoneyField id="pay-amt" label="Amount" value={amount} onChange={setAmount} required hint={value > balance ? 'More than the balance' : undefined} />
      <SelectField id="pay-method" label="Paid by" value={method} onChange={setMethod} options={['Cash', 'Bank transfer (outside app)'] as const} />
      <div className="stack" style={{ gap: 6 }}>
        <span className="t-small strong">Proof (receipt, transfer slip or teller)</span>
        <div style={{ width: 120 }}>{proof ? <PhotoThumb photo={proof} label="Payment proof" onRemove={() => setProof(undefined)} /> : <PhotoInput kind="proof" label="Add photo" onPhoto={setProof} />}</div>
      </div>
    </Dialog>
  );
}

/** Copy or WhatsApp an invoice's payment link (a token link in backend mode). */
function PayLinkButtons({ inv, lead, balance, copied, onCopied }: { inv: Invoice; lead?: Lead; balance: number; copied: boolean; onCopied: () => void }) {
  const link = useShareLink('invoice', inv.id);
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Copy payment link for ${inv.number}`}
        title="Copy payment link"
        disabled={!link}
        onClick={() => {
          navigator.clipboard?.writeText(link);
          onCopied();
        }}
      >
        <Icon name={copied ? 'check' : 'receipt'} size={18} />
      </button>
      {lead && link && (
        <a
          href={whatsappLink(lead.phone, `Hello ${lead.name}, here is the payment link for ${inv.description} (${naira(balance)}): ${link}`)}
          target="_blank"
          rel="noreferrer"
          className="icon-btn"
          aria-label={`Send payment link for ${inv.number} on WhatsApp`}
          title="Send on WhatsApp"
        >
          <Icon name="whatsapp" size={18} />
        </a>
      )}
    </>
  );
}
