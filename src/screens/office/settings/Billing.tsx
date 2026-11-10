import '../../../styles/settings-auth.css';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { PayResponse, VerifyResponse } from '../../../../supabase/functions/_shared/contract';
import { Dialog } from '../../../components/forms';
import { Icon } from '../../../components/Icon';
import { Badge, Button, Segmented } from '../../../components/ui';
import { fmtDate, naira } from '../../../data/domain';
import { paySubscription } from '../../../data/settingsActions';
import { callPublic } from '../../../data/remote/publicApi';
import { reload, supabase } from '../../../data/remote/sync';
import { isBackend, useDb } from '../../../data/store';

export const SEAT_PRICE = 7_500;
type Method = 'Card' | 'Transfer' | 'USSD';

export function Billing() {
  const company = useDb((d) => d.company);
  const users = useDb((d) => d.users);
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<Method>('Card');
  const [done, setDone] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Backend mode: back from the payment page with ?reference=… — confirm the payment, then refresh the plan
  useEffect(() => {
    const reference = params.get('reference');
    if (!isBackend || !reference) return;
    navigate('/office/settings/billing', { replace: true });
    setResult({ ok: true, text: 'Checking your payment…' });
    callPublic<VerifyResponse>({ action: 'verify', reference })
      .then(async (v) => {
        await reload();
        setResult(v.status === 'success' ? { ok: true, text: 'Payment received. Your subscription is active.' } : v.status === 'pending' ? { ok: true, text: 'Your payment is still being confirmed. This page will update shortly.' } : { ok: false, text: "That payment didn't go through. You can try again." });
      })
      .catch((e) => setResult({ ok: false, text: (e as Error).message }));
    // Runs once on return from the payment page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payOnline = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { data } = await supabase().auth.getSession();
      const { authorizationUrl } = await callPublic<PayResponse>({ action: 'pay-subscription' }, data.session?.access_token);
      window.location.assign(authorizationUrl);
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
      setBusy(false);
    }
  };
  const sub = company.subscription;
  const techs = users.filter((u) => u.role === 'technician' && u.active).length;
  const seats = Math.max(1, techs);
  const monthly = seats * SEAT_PRICE;
  const trialDays = Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86_400_000);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card plan" aria-labelledby="plan">
        <div className="plan__main">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 id="plan" className="t-section-lg" style={{ flexGrow: 1 }}>
              Your plan
            </h2>
            {sub.status === 'trial' ? <Badge tone="amber">Free trial · {Math.max(0, trialDays)} days left</Badge> : sub.status === 'active' ? <Badge tone="green">Active</Badge> : <Badge tone="red">Payment overdue</Badge>}
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="plan__price">
              <span className="t-figure num">{naira(SEAT_PRICE)}</span>
              <span className="t-body muted">per technician / month</span>
            </span>
            <span className="t-small muted">Billed on active technicians. Office and viewer users are free.</span>
          </div>
          <ul className="plan__list">
            {['Unlimited leads, quotes and jobs', 'Technician app with checklists, photos and sign-off', 'Customer quote, payment and handover pages', 'WhatsApp and SMS reminders'].map((f) => (
              <li key={f}>
                <Icon name="check" size={18} color="var(--success)" />
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className="plan__aside">
          <span className="t-overline">This month</span>
          <div className="plan__line">
            <span className="muted">Technician seats</span>
            <span className="num strong">{seats}</span>
          </div>
          <div className="plan__line">
            <span className="muted">Price per seat</span>
            <span className="num">{naira(SEAT_PRICE)}</span>
          </div>
          <div className="plan__line plan__total">
            <span className="strong">Monthly total</span>
            <span className="num t-section-lg">{naira(monthly)}</span>
          </div>
          <span className="t-small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="calendar" size={16} />
            {sub.status === 'active' && sub.paidUntil ? `Paid until ${fmtDate(sub.paidUntil)}` : `Trial ends ${fmtDate(sub.trialEndsAt)}`}
          </span>
          <span style={{ flexGrow: 1 }} />
          <Button
            size="lg"
            className="plan__cta"
            disabled={busy}
            onClick={() => {
              if (isBackend) return void payOnline();
              setDone(false);
              setPaying(true);
            }}
          >
            {busy ? 'Opening secure payment…' : sub.status === 'active' ? 'Pay next month' : 'Subscribe now'}
          </Button>
          {isBackend && <span className="t-caption faint" style={{ textAlign: 'center' }}>Pay by card or bank transfer on our secure payment page</span>}
        </div>
      </section>
      {result && (
        <div role="status" className={`notice notice--${result.ok ? 'success' : 'danger'}`}>
          <Icon name={result.ok ? 'checkCircle' : 'alertCircle'} size={18} />
          {result.text}
        </div>
      )}
      <p className="t-small muted" style={{ margin: 0 }}>Every plan starts with a 14-day free trial. Add or remove technicians at any time; the next bill uses the new seat count.</p>

      <Dialog
        open={paying}
        onClose={() => setPaying(false)}
        title={done ? 'Payment received' : `Pay ${naira(monthly)}`}
        actions={
          done ? (
            <Button onClick={() => setPaying(false)}>Done</Button>
          ) : (
            <Button
              onClick={() => {
                paySubscription(seats);
                setDone(true);
              }}
            >
              Pay {naira(monthly)}
            </Button>
          )
        }
      >
        {done ? (
          <p className="t-body" style={{ margin: 0 }}>
            Thank you. Your subscription is active until {fmtDate(company.subscription.paidUntil)}. A receipt was sent to {company.phone}.
          </p>
        ) : (
          <>
            <span className="t-small muted">
              {seats} seat{seats === 1 ? '' : 's'} × {naira(SEAT_PRICE)} for one month
            </span>
            <Segmented label="Payment method" fill value={method} onChange={setMethod} options={(['Card', 'Transfer', 'USSD'] as const).map((m) => ({ id: m, name: m }))} />
            <p className="t-body muted" style={{ margin: 0 }}>
              {method === 'Card' && 'You will be taken to the secure payment page to enter your card. We never see or store card details.'}
              {method === 'Transfer' && 'Transfer to the one-time account number shown on the next screen. It confirms automatically.'}
              {method === 'USSD' && 'Dial the code shown on the next screen from the phone linked to your bank account.'}
            </p>
            <span className="t-small muted">Payments are simulated in this version.</span>
          </>
        )}
      </Dialog>
    </div>
  );
}
