import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { TextField } from '../../components/forms';
import { homeFor } from '../../components/Guards';
import { Button, Logo } from '../../components/ui';
import { requestCode, verifyCode } from '../../data/auth';

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 16px' }}>
      <div className="card stack" style={{ width: '100%', maxWidth: 420, padding: 28, gap: 20 }}>
        <Link to="/" aria-label="Home" style={{ alignSelf: 'flex-start' }}>
          <Logo />
        </Link>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="t-display">{title}</h1>
          {subtitle && <span className="t-body muted">{subtitle}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Simulated SMS: the code is also sent to the message outbox. */
export function DemoCode({ code }: { code: string }) {
  return (
    <div className="t-small" style={{ padding: '10px 14px', borderRadius: 12, background: '#FDF0D5', color: '#6B4400' }}>
      Demo: SMS isn't connected yet, so here is your code: <strong style={{ letterSpacing: 2 }}>{code}</strong>
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
    <AuthCard title="Sign in" subtitle="We'll text a 6-digit code to your phone.">
      {!codeSent ? (
        <form onSubmit={request} className="stack" style={{ gap: 16 }}>
          <TextField id="phone" label="Phone number" type="tel" inputMode="tel" value={phone} onChange={setPhone} placeholder="0803 123 4567" required />
          {error && (
            <span role="alert" className="t-small danger">
              {error}
            </span>
          )}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </Button>
          <span className="t-small muted">
            New firm? <Link to="/signup">Start a free trial</Link>
          </span>
        </form>
      ) : (
        <form onSubmit={verify} className="stack" style={{ gap: 16 }}>
          {demoCode && <DemoCode code={demoCode} />}
          <TextField id="otp" label="6-digit code" inputMode="numeric" value={code} onChange={setCode} required />
          {error && (
            <span role="alert" className="t-small danger">
              {error}
            </span>
          )}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Checking…' : 'Sign in'}
          </Button>
          <Button variant="text" onClick={() => void send()} disabled={busy}>
            Send a new code
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
