import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { PhoneScreen } from '../../components/PhoneScreen';
import { usePublicTarget, usePublicToken } from '../../components/PublicPage';
import { Badge, Button } from '../../components/ui';
import { fmtDate, fmtDateTime, invoiceBalance, invoicePaid, invoiceStatus, naira, whatsappLink } from '../../data/domain';
import type { PayResponse } from '../../../supabase/functions/_shared/contract';
import { callPublic } from '../../data/remote/publicApi';
import { isBackend, useDb } from '../../data/store';
import { payInvoice } from '../../data/workflows';
import { BrandHeader, Gateway, PaystackPay } from './CustomerQuote';

/** E9-2: customer pays an invoice (deposit, balance, extras, plan) from a link. */
export function PayInvoice() {
  const invoiceId = usePublicTarget('invoiceId');
  const token = usePublicToken();
  const db = useDb();
  const inv = db.invoices.find((i) => i.id === invoiceId);
  const lead = db.leads.find((l) => l.id === inv?.leadId);
  const [paying, setPaying] = useState(false);
  const company = db.company;

  if (!inv || !lead) {
    return (
      <PhoneScreen fixed={false}>
        <BrandHeader company={company} />
        <main style={{ padding: '48px 20px' }} className="stack">
          <h1 className="t-display">Payment link not found</h1>
          <p className="t-body muted">
            Contact {company.name} on {company.phone}.
          </p>
        </main>
      </PhoneScreen>
    );
  }

  const balance = invoiceBalance(db, inv);
  const status = invoiceStatus(db, inv);
  const confirmed = db.payments.filter((p) => p.invoiceId === inv.id && p.status === 'Confirmed').sort((a, b) => b.at.localeCompare(a.at));
  const last = confirmed[0];

  if (paying && balance > 0) {
    return (
      <Gateway
        company={company}
        title={`${inv.description} · ${inv.number}`}
        amount={balance}
        onBack={() => setPaying(false)}
        onPaid={(method) => {
          payInvoice(inv.id, balance, method);
          setPaying(false);
        }}
      />
    );
  }

  return (
    <PhoneScreen fixed={false}>
      <BrandHeader company={company} />
      <main style={{ padding: '32px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="stack" style={{ padding: '0 4px', gap: 8 }}>
          <span className="t-small muted">
            Invoice {inv.number} · {lead.name}
          </span>
          <h1 className="t-display">{inv.description}</h1>
          <span>
            <Badge tone={status === 'Paid' ? 'green' : status === 'Overdue' ? 'red' : 'blue'}>{status === 'Due' ? `Due ${fmtDate(inv.dueAt)}` : status}</Badge>
          </span>
        </div>

        {balance === 0 ? (
          <section className="card stack" style={{ padding: 20, gap: 8, background: 'var(--success-tint)', color: 'var(--on-success-tint)' }} aria-live="polite">
            <span className="t-section" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Icon name="checkCircle" size={22} />
              Paid in full. Thank you!
            </span>
            {last && (
              <span className="t-body">
                Receipt {last.reference}: {naira(last.amount)} by {last.method}, {fmtDateTime(last.at)}. A copy was sent to you on WhatsApp.
              </span>
            )}
          </section>
        ) : (
          <section className="card stack" style={{ padding: '24px 20px', gap: 4 }}>
            <span className="t-small muted">Amount due</span>
            <span style={{ fontSize: 36, lineHeight: '44px', fontWeight: 500, letterSpacing: -0.5 }}>{naira(balance)}</span>
            {invoicePaid(db, inv.id) > 0 && <span className="t-small muted">{naira(invoicePaid(db, inv.id))} of {naira(inv.amount)} already paid</span>}
          </section>
        )}

        {confirmed.length > 0 && (
          <section aria-labelledby="hist" className="stack" style={{ gap: 8 }}>
            <h2 id="hist" className="t-section" style={{ padding: '0 4px' }}>
              Payments received
            </h2>
            <div className="card card--list">
              {confirmed.map((p) => (
                <div key={p.id} className="row row--between">
                  <span className="row__main">
                    <span>{naira(p.amount)}</span>
                    <span className="t-small muted">
                      {p.method} · {fmtDate(p.at)} · {p.reference}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <span className="t-small muted" style={{ padding: '0 4px' }}>
          {company.name} · {company.address} · {company.phone}
        </span>
      </main>

      <div style={{ position: 'sticky', bottom: 0, marginTop: 'auto', padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--surface)', borderTop: '1px solid var(--divider)' }}>
        {balance > 0 &&
          (isBackend ? (
            <PaystackPay
              label={`Pay ${naira(balance)} securely`}
              unavailable={!token ? 'Staff preview: payment opens from the link sent to the customer.' : undefined}
              start={() => callPublic<PayResponse>({ action: 'pay', token: token! })}
            />
          ) : (
            <Button size="xl" onClick={() => setPaying(true)}>
              Pay {naira(balance)}
            </Button>
          ))}
        <Button variant="text" size="lg" href={whatsappLink(company.phone, `Hello ${company.name}, I have a question about invoice ${inv.number}.`)}>
          Ask a question
        </Button>
      </div>
    </PhoneScreen>
  );
}
