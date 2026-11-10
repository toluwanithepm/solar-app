import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { PhoneScreen } from '../../components/PhoneScreen';
import { usePaymentMethodsNote, usePublicLink, usePublicTarget, usePublicToken } from '../../components/PublicPage';
import { Badge, Button, Logo, Stat } from '../../components/ui';
import { categoryLabel, defaultWarrantyYears, fmtDate, naira, optionTotal, quoteValidUntil, whatsappLink } from '../../data/domain';
import { isExpired } from '../../data/salesActions';
import type { PayResponse } from '../../../supabase/functions/_shared/contract';
import { callPublic } from '../../data/remote/publicApi';
import { isBackend, useDb } from '../../data/store';
import type { Company, ItemCategory, PaymentMethod } from '../../data/types';
import { acceptQuote } from '../../data/workflows';

export function CustomerQuote() {
  const quoteId = usePublicTarget('quoteId');
  const token = usePublicToken();
  const quote = useDb((d) => d.quotes.find((q) => q.id === quoteId));
  const lead = useDb((d) => d.leads.find((l) => l.id === quote?.leadId));
  const company = useDb((d) => d.company);
  const priceItems = useDb((d) => d.priceItems);
  const invoices = useDb((d) => d.invoices);
  const payments = useDb((d) => d.payments);
  const [picked, setPicked] = useState(() => quote?.selectedOptionId ?? quote?.options[Math.min(1, (quote?.options.length ?? 1) - 1)]?.id);
  const [paying, setPaying] = useState(false);
  const balanceLink = usePublicLink('invoice', invoices.find((i) => i.quoteId === quoteId && i.kind === 'Balance')?.id);

  if (!quote || !lead) {
    return (
      <PhoneScreen fixed={false}>
        <BrandHeader company={company} />
        <main style={{ padding: '48px 20px' }} className="stack">
          <h1 className="t-display">Quote not found</h1>
          <p className="t-body muted">This link may be wrong or the quote was withdrawn. Contact {company.name} on {company.phone}.</p>
        </main>
      </PhoneScreen>
    );
  }

  const accepted = quote.status === 'Accepted';
  const expired = isExpired(quote) || quote.status === 'Expired';
  const declined = quote.status === 'Declined';
  const sel = quote.options.find((o) => o.id === (accepted ? quote.selectedOptionId : picked)) ?? quote.options[0];
  const total = optionTotal(sel);
  const deposit = Math.round((total * quote.depositPct) / 100);
  const equipment = sel.lines.filter((l) => l.category !== 'service');
  const warranty = (['panel', 'battery', 'inverter'] as ItemCategory[])
    .map((cat) => {
      const line = sel.lines.find((l) => l.category === cat);
      if (!line) return null;
      const years = priceItems.find((p) => p.id === line.itemId)?.warrantyYears ?? defaultWarrantyYears[cat];
      return [cat === 'battery' ? 'Batteries' : cat === 'panel' ? 'Panels' : categoryLabel[cat], `${years} year${years === 1 ? '' : 's'}`] as const;
    })
    .filter((x) => x !== null);
  const depositInv = invoices.find((i) => i.quoteId === quote.id && i.kind === 'Deposit');
  const depositPay = payments.find((p) => p.invoiceId === depositInv?.id && p.status === 'Confirmed');
  const ask = whatsappLink(company.phone, `Hello ${company.name}, I have a question about quote ${quote.number}.`);

  if (paying && !accepted) {
    return (
      <Gateway
        company={company}
        title={`Deposit for ${quote.number}`}
        amount={deposit}
        onBack={() => setPaying(false)}
        onPaid={(method) => {
          acceptQuote(quote.id, sel.id, method);
          setPaying(false);
        }}
      />
    );
  }

  return (
    <PhoneScreen fixed={false}>
      <BrandHeader company={company} />

      <main style={{ padding: '32px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {quote.status === 'Draft' && (
          <div className="t-small no-print" style={{ padding: '10px 14px', borderRadius: 12, background: '#FDF0D5', color: '#6B4400' }}>
            Preview: this quote is still a draft and hasn't been sent.
          </div>
        )}
        <div className="stack" style={{ padding: '0 4px', gap: 8 }}>
          <span className="t-small muted">
            Quote {quote.number} · {expired ? 'expired' : 'valid until'} {fmtDate(quoteValidUntil(quote))}
          </span>
          <h1 className="t-display">Solar for {lead.name}</h1>
          {accepted && (
            <span>
              <Badge tone="green">Accepted {fmtDate(quote.acceptedAt)}</Badge>
            </span>
          )}
        </div>

        {accepted && (
          <section className="card stack" style={{ padding: 20, gap: 8, background: 'var(--success-tint)', color: 'var(--on-success-tint)' }} aria-live="polite">
            <span className="t-section" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Icon name="checkCircle" size={22} />
              Thank you, your installation is booked in
            </span>
            {depositPay && (
              <span className="t-body">
                Receipt {depositPay.reference}: {naira(depositPay.amount)} by {depositPay.method} on {fmtDate(depositPay.at)}.
              </span>
            )}
            <span className="t-small">{company.name} will call you to agree an installation date. A receipt was sent to you on WhatsApp.</span>
            {balanceLink && (
              <a href={balanceLink} className="t-small" style={{ fontWeight: 500, color: 'inherit', textDecoration: 'underline' }}>
                Pay the balance early
              </a>
            )}
          </section>
        )}

        {(expired || declined) && !accepted && (
          <section className="card stack" style={{ padding: 20, gap: 8 }}>
            <span className="t-section">{declined ? 'This quote was closed' : 'This quote has expired'}</span>
            <span className="t-small muted">Prices may have changed. Ask {company.name} for an updated quote.</span>
          </section>
        )}

        {quote.options.length > 1 && !accepted && (
          <div role="radiogroup" aria-label="System options" style={{ display: 'grid', gridTemplateColumns: `repeat(${quote.options.length}, minmax(0, 1fr))`, gap: 8 }}>
            {quote.options.map((o) => {
              const on = o.id === sel.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPicked(o.id)}
                  className="card"
                  style={{ border: on ? '2px solid var(--primary)' : '2px solid transparent', padding: '12px 10px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 96 }}
                >
                  <span style={{ fontSize: 13, fontWeight: 500, color: on ? 'var(--primary)' : 'var(--muted)' }}>{o.name}</span>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{naira(optionTotal(o))}</span>
                  <span className="t-small muted">{o.backupHours} h backup</span>
                </button>
              );
            })}
          </div>
        )}

        <section className="card stack" style={{ padding: '24px 20px', gap: 20 }} aria-live="polite">
          <div className="stack" style={{ gap: 4 }}>
            <span className="t-small muted">{sel.name}</span>
            <span style={{ fontSize: 36, lineHeight: '44px', fontWeight: 500, letterSpacing: -0.5 }}>{naira(total)}</span>
            <span className="muted" style={{ fontSize: 14, lineHeight: '20px' }}>
              Installed, VAT included
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, paddingTop: 20, borderTop: '1px solid var(--divider)' }}>
            <Stat label="Night backup" value={`${sel.backupHours} hours`} />
            <Stat label="Deposit to start" value={naira(deposit)} />
          </div>
        </section>

        <section aria-labelledby="inc" className="stack" style={{ gap: 8 }}>
          <h2 id="inc" className="t-section" style={{ padding: '0 4px' }}>
            What's included
          </h2>
          <ul className="card card--list" style={{ margin: 0, listStyle: 'none' }}>
            {equipment.map((l) => (
              <li key={l.id} className="row" style={{ gap: 12 }}>
                <Icon name="check" size={20} color="var(--primary)" />
                <span className="row__main">{l.qty > 1 ? `${l.qty} × ${l.description}` : l.description}</span>
              </li>
            ))}
            <li className="row" style={{ gap: 12 }}>
              <Icon name="check" size={20} color="var(--primary)" />
              Installation, testing and handover
            </li>
          </ul>
        </section>

        <section aria-labelledby="war" className="stack" style={{ gap: 8 }}>
          <h2 id="war" className="t-section" style={{ padding: '0 4px' }}>
            Warranty and payment
          </h2>
          <div className="card card--list">
            {warranty.map(([label, value]) => (
              <div key={label} className="row row--between">
                <span>{label}</span>
                <span className="muted">{value}</span>
              </div>
            ))}
            <div className="row row--between">
              <span>Deposit to accept ({quote.depositPct}%)</span>
              <span style={{ fontWeight: 500 }}>{naira(deposit)}</span>
            </div>
            <div className="row row--between">
              <span>Balance at handover</span>
              <span className="muted">{naira(total - deposit)}</span>
            </div>
            <div className="row row--between">
              <span>Valid until</span>
              <span className="muted">{fmtDate(quoteValidUntil(quote))}</span>
            </div>
          </div>
        </section>

        <span className="t-small muted" style={{ padding: '0 4px' }}>
          {company.name} · {company.address} · {company.phone}
        </span>
      </main>

      <div
        className="no-print"
        style={{ position: 'sticky', bottom: 0, marginTop: 'auto', padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--surface)', borderTop: '1px solid var(--divider)' }}
      >
        {!accepted && !expired && !declined &&
          (isBackend ? (
            <PaystackPay
              label={`Accept and pay ${naira(deposit)} securely`}
              disabled={quote.status === 'Draft' || total === 0}
              unavailable={!token ? 'Staff preview: payment opens from the link sent to the customer.' : undefined}
              start={() => callPublic<PayResponse>({ action: 'pay', token: token!, optionId: sel.id })}
            />
          ) : (
            <Button size="xl" disabled={quote.status === 'Draft' || total === 0} onClick={() => setPaying(true)}>
              Accept and pay {naira(deposit)}
            </Button>
          ))}
        <div style={{ display: 'flex', gap: 4 }}>
          <Button variant="text" size="lg" block onClick={() => window.print()}>
            <Icon name="download" size={20} />
            Save as PDF
          </Button>
          <Button variant="text" size="lg" block href={ask}>
            Ask a question
          </Button>
        </div>
      </div>
    </PhoneScreen>
  );
}

export function BrandHeader({ company }: { company: Company }) {
  return (
    <header style={{ height: 64, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', borderBottom: '1px solid var(--divider)', flexShrink: 0 }}>
      {company.logoDataUrl ? <img src={company.logoDataUrl} alt="" style={{ width: 32, height: 32, borderRadius: 10, objectFit: 'cover' }} /> : <Logo small />}
      <span className="t-body" style={{ fontWeight: 500 }}>
        {company.name}
      </span>
    </header>
  );
}

/** Backend mode: one button that sends the customer to the payment provider's page. The server sets the amount. */
export function PaystackPay({ label, start, disabled, unavailable }: { label: string; start: () => Promise<PayResponse>; disabled?: boolean; unavailable?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const methodsNote = usePaymentMethodsNote();
  return (
    <>
      <Button
        size="xl"
        disabled={disabled || busy || !!unavailable}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const { authorizationUrl } = await start();
            window.location.assign(authorizationUrl);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? 'Opening secure payment…' : label}
      </Button>
      <span className="t-small muted" style={{ textAlign: 'center' }}>
        {unavailable ?? methodsNote}
      </span>
      {error && (
        <span role="alert" className="t-small danger" style={{ textAlign: 'center' }}>
          {error}
        </span>
      )}
    </>
  );
}

const methods: { id: PaymentMethod; label: string; note: string }[] = [
  { id: 'Card', label: 'Card', note: 'Visa, Mastercard or Verve' },
  { id: 'Transfer', label: 'Bank transfer', note: 'From any Nigerian bank app' },
  { id: 'USSD', label: 'USSD', note: 'No data needed' },
];

/**
 * Simulated payment gateway step (Paystack/Flutterwave in production).
 * Card details are only ever entered on the gateway's hosted page (NFR-12).
 */
export function Gateway({ company, title, amount, onPaid, onBack }: { company: Company; title: string; amount: number; onPaid: (m: PaymentMethod) => void; onBack: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>('Transfer');
  const [busy, setBusy] = useState(false);
  const ussd = `*737*000*${amount}#`;

  return (
    <PhoneScreen fixed={false}>
      <BrandHeader company={company} />
      <main style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <button type="button" onClick={onBack} className="btn btn--text" style={{ alignSelf: 'flex-start', height: 40, padding: 0 }}>
          <Icon name="back" size={20} />
          Back
        </button>
        <div className="stack" style={{ gap: 4, padding: '0 4px' }}>
          <span className="t-small muted">{title}</span>
          <span style={{ fontSize: 32, lineHeight: '40px', fontWeight: 500 }}>{naira(amount)}</span>
        </div>

        <fieldset className="card" style={{ border: 0, margin: 0, padding: '4px 20px' }}>
          <legend className="t-section" style={{ padding: '16px 0 4px', float: 'left', width: '100%' }}>
            How would you like to pay?
          </legend>
          {methods.map((m) => (
            <label key={m.id} className="row" style={{ cursor: 'pointer', minHeight: 64, padding: '8px 0', clear: 'both' }}>
              <input type="radio" name="method" checked={method === m.id} onChange={() => setMethod(m.id)} style={{ width: 20, height: 20, margin: 0, accentColor: 'var(--primary)' }} />
              <span className="row__main">
                <span>{m.label}</span>
                <span className="t-small muted">{m.note}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <section className="card stack" style={{ padding: 20, gap: 8 }} aria-live="polite">
          {method === 'Card' && <span className="t-body">You'll enter your card details on the payment provider's secure page. {company.name} never sees your card number.</span>}
          {method === 'Transfer' && (
            <>
              <span className="t-small muted">Transfer exactly {naira(amount)} to</span>
              <span className="t-title">{company.accountNumber}</span>
              <span className="t-body">
                {company.bankName} · {company.accountName}
              </span>
            </>
          )}
          {method === 'USSD' && (
            <>
              <span className="t-small muted">Dial on the phone linked to your bank account</span>
              <span className="t-title" style={{ letterSpacing: 1 }}>
                {ussd}
              </span>
            </>
          )}
        </section>

        <div className="t-small" style={{ padding: '10px 14px', borderRadius: 12, background: '#FDF0D5', color: '#6B4400' }}>
          Demo: the payment gateway isn't connected, so payment is confirmed straight away.
        </div>
      </main>
      <div style={{ position: 'sticky', bottom: 0, marginTop: 'auto', padding: '16px 16px 24px', background: 'var(--surface)', borderTop: '1px solid var(--divider)' }}>
        <Button
          size="xl"
          block
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setTimeout(() => onPaid(method), 700);
          }}
        >
          {busy ? 'Confirming payment…' : method === 'Card' ? `Pay ${naira(amount)} by card` : `I've paid ${naira(amount)}`}
        </Button>
      </div>
    </PhoneScreen>
  );
}
