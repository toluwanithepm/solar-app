import { Link, useNavigate } from 'react-router-dom';
import { homeFor } from '../components/Guards';
import { Icon } from '../components/Icon';
import { Button, Logo } from '../components/ui';
import { roleLabel } from '../data/domain';
import { createSeed } from '../data/seed';
import { isBackend, resetDemoData, setSession, useDb } from '../data/store';

const demoIds = ['u_chidi', 'u_ngozi', 'u_musa', 'u_amaka'];

const features = [
  'Quotes sent within 15 minutes of a site visit',
  'Photo proof, serial numbers and signed handover on every job',
  'Maintenance reminders that turn one-off jobs into repeat revenue',
  'Deposits and balances collected by card, transfer or USSD',
];

export function Landing() {
  // In backend mode the demo staff come from supabase/seed.sql and sign in with a code
  const localUsers = useDb((d) => d.users);
  const users = isBackend ? createSeed().users : localUsers;
  const navigate = useNavigate();
  const demo = demoIds.map((id) => users.find((u) => u.id === id)).filter((u) => u !== undefined);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '40px 16px 64px', display: 'flex', flexDirection: 'column', gap: 40 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Logo />
        <span className="t-section" style={{ flexGrow: 1 }}>
          Solar Field Service
        </span>
        <Button variant="text" to="/signin">
          Sign in
        </Button>
        <Button to="/signup">Start free trial</Button>
      </header>

      <section className="stack" style={{ gap: 16, maxWidth: 680 }}>
        <h1 style={{ fontSize: 40, lineHeight: '48px', fontWeight: 500, letterSpacing: -0.5 }}>Run your solar installation business from one app</h1>
        <p className="t-body muted" style={{ margin: 0, fontSize: 17, lineHeight: '26px' }}>
          Quotes, scheduling, field work, warranties, maintenance and payments, in place of WhatsApp threads, paper job cards and Excel. Built for Nigerian installer firms with 3–50 technicians.
        </p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {features.map((f) => (
            <li key={f} style={{ display: 'flex', gap: 12, alignItems: 'center' }} className="t-body">
              <Icon name="check" size={20} color="var(--primary)" />
              {f}
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 8 }}>
          <Button size="lg" to="/signup">
            Start 14-day free trial
          </Button>
          <Button size="lg" variant="tonal" to="/signin">
            Sign in with your phone
          </Button>
        </div>
      </section>

      <section aria-labelledby="demo" className="card stack" style={{ padding: 24, gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="demo" className="t-section-lg">
            Try a demo account
          </h2>
          <span className="t-small muted">Sign in as BrightPath Solar's staff to see what each role can do.</span>
        </div>
        <div className="grid-auto">
          {demo.map((u) => (
            <button
              key={u.id}
              type="button"
              className="card"
              style={{ border: '1px solid var(--border)', boxShadow: 'none', padding: 16, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4 }}
              onClick={() => {
                if (isBackend) return navigate('/signin', { state: { phone: u.phone } });
                setSession({ userId: u.id });
                navigate(homeFor(u.role));
              }}
            >
              <span className="t-overline">{roleLabel[u.role]}</span>
              <span className="t-section">{u.name}</span>
              <span className="t-small muted">{u.title}</span>
            </button>
          ))}
        </div>
        {isBackend && <span className="t-small muted">Demo accounts sign in with code 123456 on a local or test Supabase project.</span>}
        {!isBackend && demo.length < demoIds.length && (
          <span className="t-small muted">
            Some demo accounts were replaced when a new firm signed up.{' '}
            <button type="button" className="btn btn--text" style={{ height: 32, fontSize: 13, padding: 0 }} onClick={resetDemoData}>
              Restore demo data
            </button>
          </span>
        )}
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <h2 className="t-section">Customer pages</h2>
        <span className="t-small muted">
          What customers see from WhatsApp links: <Link to="/enquire">enquiry form</Link> · <Link to="/q/q_bello">quote and deposit</Link>
        </span>
      </section>
    </div>
  );
}
