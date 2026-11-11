import '../../styles/settings-auth.css';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { TextField } from '../../components/forms';
import { homeFor } from '../../components/Guards';
import { Icon } from '../../components/Icon';
import { Button, Logo } from '../../components/ui';
import { requestCode, verifyCode } from '../../data/auth';

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="auth">
      <div className="card auth__card">
        <Link to="/" className="auth__brand" aria-label="Solar Field Service home">
          <Logo />
          <span aria-hidden="true">Solar Field Service</span>
        </Link>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="t-display">{title}</h1>
          {subtitle && <span className="t-body muted">{subtitle}</span>}
        </div>
        {children}
      </div>
      {footer && <p className="t-small muted auth__foot">{footer}</p>}
    </main>
  );
}

/** Simulated SMS: the code is also sent to the message outbox. */
export function DemoCode({ code }: { code: string }) {
  return (
    <div className="notice notice--warning" role="status">
      <Icon name="message" size={18} />
      <span>
        Demo: SMS isn't connected yet, so here is your code: <strong className="num" style={{ letterSpacing: '0.15em' }}>{code}</strong>
      </span>
    </div>
  );
}

export function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { from, phone: presetPhone } = (location.state as { from?: string; phone?: string } | null) ?? {};
  const [phone, setPhone] = useState(presetPhone ?? '');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [demoCode, setDemoCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setBusy(true);
    const r = await requestCode(phone, 'signin');
    setBusy(false);
    if (r.error) return setError(r.error);
    setError('');
    setDemoCode(r.demoCode ?? '');
    setCodeSent(true);
  };

  const request = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await verifyCode(phone, code, 'signin', demoCode);
    setBusy(false);
    if (r.error || !r.role) return setError(r.error ?? 'Sign-in failed.');
    navigate(from && from !== '/signin' ? from : homeFor(r.role), { replace: true });
  };

  return (
    <AuthCard
      title="Sign in"
      subtitle={codeSent ? `Enter the 6-digit code we sent to ${phone}.` : "We'll text a 6-digit code to your phone."}
      footer={
        <>
          New firm? <Link to="/signup">Start a 14-day free trial</Link>
        </>
      }
    >
      {!codeSent ? (
        <form onSubmit={request} className="stack" style={{ gap: 16 }}>
          <TextField id="phone" label="Phone number" type="tel" inputMode="tel" value={phone} onChange={setPhone} placeholder="0803 123 4567" required />
          {error && (
            <div role="alert" className="notice notice--danger">
              <Icon name="alertCircle" size={18} />
              {error}
            </div>
          )}
          <Button type="submit" size="xl" loading={busy}>
            {busy ? 'Sending code…' : 'Send code'}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack" style={{ gap: 16 }}>
          {demoCode && <DemoCode code={demoCode} />}
          <div className="field">
            <label htmlFor="otp">6-digit code</label>
            <input id="otp" className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          {error && (
            <div role="alert" className="notice notice--danger">
              <Icon name="alertCircle" size={18} />
              {error}
            </div>
          )}
          <Button type="submit" size="xl" loading={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <Button variant="text" onClick={() => void send()} disabled={busy}>
            Send a new code
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
