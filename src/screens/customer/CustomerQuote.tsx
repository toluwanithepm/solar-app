import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { PhoneScreen } from '../../components/PhoneScreen';
import { usePaymentMethodsNote, usePublicLink, usePublicTarget, usePublicToken } from '../../components/PublicPage';
import { Badge, Button, Logo, Stat } from '../../components/ui';
import { InfoTip, Term } from '../../components/Guide';
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
        <main className="c-main">
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
  // The middle option is pre-selected and shown as the installer's recommendation
  const named = quote.options.findIndex((o) => /recommend/i.test(o.name));
  const recommendedIdx = named >= 0 ? named : quote.options.length > 1 ? Math.min(1, quote.options.length - 1) : -1;
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

      <main className="c-main">
        {quote.status === 'Draft' && (
          <div className="notice notice--warning no-print">
            <Icon name="alertCircle" size={20} />
            Preview: this quote is still a draft and hasn't been sent.
          </div>
        )}
        <div className="p-intro">
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
          <section className="c-ok" aria-live="polite">
            <span className="t-section-lg c-ok__title">
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
              <a href={balanceLink} className="t-small strong" style={{ color: 'inherit', textDecoration: 'underline' }}>
                Pay the balance early
              </a>
            )}
          </section>
        )}

        {(expired || declined) && !accepted && (
          <section className="notice notice--warning">
            <Icon name="clock" size={20} style={{ marginTop: 1 }} />
            <span className="stack" style={{ gap: 2 }}>
              <span className="t-section" style={{ color: 'inherit' }}>
                {declined ? 'This quote was closed' : 'This quote has expired'}
              </span>
              <span className="t-small">Prices may have changed. Ask {company.name} for an updated quote.</span>
            </span>
          </section>
        )}

        {quote.options.length > 1 && !accepted && (
          <section aria-labelledby="opts" className="p-section">
            <h2 id="opts" className="t-section-lg p-section__head">
              Choose your system
            </h2>
            <div role="radiogroup" aria-labelledby="opts" className="option-grid" style={{ gridTemplateColumns: `repeat(${quote.options.length}, minmax(0, 1fr))` }}>
              {quote.options.map((o, i) => {
                const on = o.id === sel.id;
                const rec = i === recommendedIdx;
                const nameIsBadge = rec && /^recommended$/i.test(o.name.trim());
                return (
                  <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => setPicked(o.id)} className={`card option${rec ? ' option--recommended' : ''}`}>
                    <span className="option__radio" aria-hidden="true" />
                    {rec && (
                      <span className="badge badge--blue option__badge">
                        Recommended
                      </span>
                    )}
                    {!nameIsBadge && <span className="option__name">{o.name}</span>}
                    <span className="option__price num">{naira(optionTotal(o))}</span>
                    <span className="t-small muted">{o.backupHours} h backup</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section className="card card--pad stack" style={{ gap: 16 }} aria-live="polite">
          <div className="stack" style={{ gap: 2 }}>
            <span className="p-overline">{sel.name} · total</span>
            <span className="c-total num">{naira(total)}</span>
            <span className="t-small muted">Installed, VAT included</span>
          </div>
          <div className="p-grid-2" style={{ gap: 16, paddingTop: 16, borderTop: '1px solid var(--divider)' }}>
            <Stat label={<Term term="backup">Night backup</Term>} value={`${sel.backupHours} hours`} />
            <Stat
              label={
                <span className="term">
                  Deposit to start
                  <InfoTip label="the deposit" text="You pay this when you accept, to book your installation. The rest is due as shown under Warranty and payment." />
                </span>
              }
              value={naira(deposit)} />
          </div>
        </section>

        <section aria-labelledby="inc" className="p-section">
          <h2 id="inc" className="t-section-lg p-section__head">
            What's included
          </h2>
          <ul className="card card--list" style={{ margin: 0, listStyle: 'none' }}>
            {equipment.map((l) => (
              <li key={l.id} className="row" style={{ gap: 12 }}>
                <Icon name="check" size={20} color="var(--success)" />
                <span className="row__main">{l.qty > 1 ? `${l.qty} × ${l.description}` : l.description}</span>
              </li>
            ))}
            <li className="row" style={{ gap: 12 }}>
              <Icon name="check" size={20} color="var(--success)" />
              Installation, testing and handover
            </li>
          </ul>
        </section>

        <section aria-labelledby="war" className="p-section">
          <h2 id="war" className="t-section-lg p-section__head">
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
              <span className="strong num">{naira(deposit)}</span>
            </div>
            <div className="row row--between">
              <span>Balance at handover</span>
              <span className="num">{naira(total - deposit)}</span>
            </div>
            <div className="row row--between">
              <span>Valid until</span>
              <span className="muted">{fmtDate(quoteValidUntil(quote))}</span>
            </div>
          </div>
        </section>

        <span className="t-small faint p-footer-note">
          {company.name} · {company.address} · {company.phone}
        </span>
      </main>

      <div className="no-print c-cta">
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
          <Button variant="text" size="md" block onClick={() => window.print()}>
            <Icon name="download" size={20} />
            Save as PDF
          </Button>
          <Button variant="text" size="md" block href={ask}>
            <Icon name="whatsapp" size={20} />
            Ask a question
          </Button>
        </div>
      </div>
    </PhoneScreen>
  );
}

export function BrandHeader({ company }: { company: Company }) {
  return (
    <header className="brand-head">
      {company.logoDataUrl ? <img src={company.logoDataUrl} alt="" className="brand-head__logo" /> : <Logo />}
      <span className="brand-head__name">{company.name}</span>
      {company.phone && (
        <a href={`tel:${company.phone}`} className="btn btn--text btn--md no-print" style={{ marginLeft: 'auto' }} aria-label={`Call ${company.name}`}>
          <Icon name="phone" size={18} />
          Call
        </a>
      )}
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
        disabled={disabled || !!unavailable}
        loading={busy}
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
        {!busy && <Icon name="shield" size={20} />}
        {busy ? 'Opening secure payment…' : label}
      </Button>
      <span className="t-small muted c-cta__note">{unavailable ?? methodsNote}</span>
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
      <main className="c-main" style={{ paddingTop: 12 }}>
        <button type="button" onClick={onBack} className="btn btn--text btn--md" style={{ alignSelf: 'flex-start', marginLeft: -8 }}>
          <Icon name="back" size={20} />
          Back
        </button>
        <div className="p-intro" style={{ gap: 2 }}>
          <span className="t-small muted">{title}</span>
          <span className="c-total c-total--md num">{naira(amount)}</span>
        </div>

        <fieldset className="card card--list" style={{ margin: 0 }}>
          <legend className="t-section-lg" style={{ padding: '16px 0 4px', float: 'left', width: '100%' }}>
            How would you like to pay?
          </legend>
          {methods.map((m) => (
            <label key={m.id} className="choice" style={{ clear: 'both', minHeight: 64 }}>
              <input type="radio" name="method" checked={method === m.id} onChange={() => setMethod(m.id)} />
              <span className="row__main">
                <span>{m.label}</span>
                <span className="t-small muted">{m.note}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <section className="card card--pad stack" style={{ gap: 6 }} aria-live="polite">
          {method === 'Card' && <span className="t-body">You'll enter your card details on the payment provider's secure page. {company.name} never sees your card number.</span>}
          {method === 'Transfer' && (
            <>
              <span className="t-small muted">Transfer exactly {naira(amount)} to</span>
              <span className="t-display num" style={{ letterSpacing: '0.02em' }}>
                {company.accountNumber}
              </span>
              <span className="t-body">
                {company.bankName} · {company.accountName}
              </span>
            </>
          )}
          {method === 'USSD' && (
            <>
              <span className="t-small muted">Dial on the phone linked to your bank account</span>
              <span className="t-display" style={{ letterSpacing: '0.04em' }}>
                {ussd}
              </span>
            </>
          )}
        </section>

        <div className="notice notice--info">
          <Icon name="alertCircle" size={20} />
          Demo: the payment gateway isn't connected, so payment is confirmed straight away.
        </div>
      </main>
      <div className="c-cta">
        <Button
          size="xl"
          block
          loading={busy}
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
