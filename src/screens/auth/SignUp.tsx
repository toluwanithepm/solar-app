import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { SelectField, TextField } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { sunHoursByState } from '../../data/domain';
import { finishSignUp, requestCode, verifyCode } from '../../data/auth';
import { isBackend } from '../../data/store';
import { compressImage } from '../../lib/photos';
import { AuthCard, DemoCode } from './SignIn';

const states = Object.keys(sunHoursByState);

export function SignUp() {
  const navigate = useNavigate();
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [step, setStep] = useState<'phone' | 'otp' | 'company'>('phone');
  const [phone, setPhone] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [sent, setSent] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [c, setC] = useState({ name: '', logoDataUrl: '', address: '', state: 'Lagos', bankName: '', accountNumber: '', accountName: '' });
  const set = (k: keyof typeof c) => (v: string) => setC((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  const timer = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  const stepNo = step === 'phone' ? 1 : step === 'otp' ? 2 : 3;

  const submitPhone = async (e: FormEvent) => {
    e.preventDefault();
    if (phone.replace(/\D/g, '').length < 10) return setError('Enter a valid Nigerian phone number.');
    const r = await requestCode(phone, 'signup');
    if (r.error) return setError(r.error);
    setError('');
    setSent(r.demoCode ?? '');
    setStep('otp');
  };

  const submitOtp = async (e: FormEvent) => {
    e.preventDefault();
    const r = await verifyCode(phone, code, 'signup', sent);
    if (r.error) return setError(r.error);
    setError('');
    setStep('company');
  };

  const submitCompany = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{10}$/.test(c.accountNumber)) return setError('Account number should be 10 digits (NUBAN).');
    const r = await finishSignUp({ ownerName, phone, company: { ...c, logoDataUrl: c.logoDataUrl || undefined } });
    if (r.error) return setError(r.error);
    navigate('/office', { replace: true });
  };

  return (
    <AuthCard
      title={step === 'company' ? 'Set up your company' : 'Start your free trial'}
      subtitle={
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>Step {stepNo} of 3 · 14 days free</span>
          <span aria-live="off">Set up in {timer}</span>
        </span>
      }
    >
      {step === 'phone' && (
        <form onSubmit={submitPhone} className="stack" style={{ gap: 16 }}>
          <TextField id="owner" label="Your name" value={ownerName} onChange={setOwnerName} required />
          <TextField id="phone" label="Phone number" type="tel" inputMode="tel" value={phone} onChange={setPhone} placeholder="0803 123 4567" required />
          <ErrorLine error={error} />
          <Button type="submit" size="lg">
            Send code
          </Button>
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={submitOtp} className="stack" style={{ gap: 16 }}>
          {sent && <DemoCode code={sent} />}
          <TextField id="otp" label="6-digit code" inputMode="numeric" value={code} onChange={setCode} required />
          <ErrorLine error={error} />
          <Button type="submit" size="lg">
            Verify
          </Button>
        </form>
      )}

      {step === 'company' && (
        <form onSubmit={submitCompany} className="stack" style={{ gap: 16 }}>
          <TextField id="cname" label="Company name" value={c.name} onChange={set('name')} required />
          <div className="field">
            <span className="t-small muted">Logo</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <span className="photo" style={{ width: 56, height: 56, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {c.logoDataUrl ? <img src={c.logoDataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="upload" size={22} color="var(--muted)" />}
              </span>
              <span className="t-body" style={{ color: 'var(--primary)', fontWeight: 500 }}>
                {c.logoDataUrl ? 'Change logo' : 'Upload logo'}
              </span>
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) set('logoDataUrl')((await compressImage(f)).dataUrl);
                }}
              />
            </label>
          </div>
          <TextField id="addr" label="Office address" value={c.address} onChange={set('address')} required />
          <SelectField id="state" label="State" value={c.state} onChange={set('state')} options={states} hint="Used for sun hours when sizing systems" />
          <TextField id="bank" label="Bank" value={c.bankName} onChange={set('bankName')} placeholder="e.g. GTBank" required />
          <TextField id="acct" label="Account number" inputMode="numeric" value={c.accountNumber} onChange={set('accountNumber')} required />
          <TextField id="acctname" label="Account name" value={c.accountName} onChange={set('accountName')} required />
          <ErrorLine error={error} />
          <span className="t-small muted">
            {isBackend
              ? 'Your firm starts on a 14-day free trial with standard checklists and maintenance plans. Add your equipment prices next.'
              : "This starts a new workspace for your firm. The demo's equipment price list is kept so you can edit it with your own prices."}
          </span>
          <Button type="submit" size="lg">
            Finish set-up
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

function ErrorLine({ error }: { error: string }) {
  return error ? (
    <span role="alert" className="t-small danger">
      {error}
    </span>
  ) : null;
}
