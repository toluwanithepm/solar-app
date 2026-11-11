import '../styles/settings-auth.css';
import { Link, useNavigate } from 'react-router-dom';
import { homeFor } from '../components/Guards';
import { Icon, type IconName } from '../components/Icon';
import { Badge, Button, Logo } from '../components/ui';
import { roleLabel } from '../data/domain';
import { createSeed } from '../data/seed';
import { isBackend, resetDemoData, setSession, useDb } from '../data/store';
import { journeySteps } from '../data/journey';
import '../styles/guide.css';

const demoIds = ['u_chidi', 'u_ngozi', 'u_musa', 'u_amaka'];

const landingFaqs: { q: string; a: string }[] = [
  { q: 'Who is it for?', a: 'Solar installation firms with an office team and technicians in the field, from a few installers to around fifty.' },
  { q: 'What does it cost?', a: 'Every firm starts with a 14-day free trial. After that it is ₦7,500 per technician per month; office staff are included.' },
  { q: 'Do my technicians need data or signal?', a: 'No. The technician app works offline: checklists, photos, serial scans and signatures are kept on the phone and sent when the signal returns.' },
  { q: 'How do customers pay?', a: 'Quotes and invoices are sent as links. Customers pay by card, bank transfer or USSD through Paystack, and payments are matched to the invoice automatically.' },
  { q: 'Can I use my own prices and see my margins?', a: 'Yes. You keep your own price list with costs and selling prices. Owners see the margin on every quote; office staff and technicians never see your costs.' },
  { q: 'What happens if a phone is lost or someone leaves?', a: 'The owner can sign that person out of every phone in one step, and the phones delete the saved customer data as soon as they connect.' },
];

const features: { icon: IconName; title: string; text: string }[] = [
  { icon: 'description', title: 'Quotes in 15 minutes', text: 'Size the system on site and send a branded quote before you leave the customer.' },
  { icon: 'camera', title: 'Proof on every job', text: 'Photos, serial numbers and a signed handover from the technician app.' },
  { icon: 'calendar', title: 'Repeat revenue', text: 'Maintenance reminders that turn one-off installs into service plans.' },
  { icon: 'money', title: 'Get paid faster', text: 'Deposits and balances collected by card, transfer or USSD.' },
];

const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');

export function Landing() {
  // In backend mode the demo staff come from supabase/seed.sql and sign in with a code
  const localUsers = useDb((d) => d.users);
  const users = isBackend ? createSeed().users : localUsers;
  const navigate = useNavigate();
  const demo = demoIds.map((id) => users.find((u) => u.id === id)).filter((u) => u !== undefined);

  return (
    <div className="landing">
      <header className="landing__nav">
        <div className="landing__inner">
          <Link to="/" className="landing__brand">
            <Logo />
            Solar Field Service
          </Link>
          <Button variant="text" to="/signin">
            Sign in
          </Button>
          <Button to="/signup" className="landing__nav-signup">
            Start free trial
          </Button>
        </div>
      </header>

      <main>
        <section className="landing__hero">
          <div className="landing__inner">
            <div className="stack" style={{ gap: 24 }}>
              <span className="landing__eyebrow">
                <b>
                  <Icon name="bolt" size={12} />
                </b>
                Built for Nigerian installer firms with 3–50 technicians
              </span>
              <h1 className="landing__h1">Run your solar installation business from one app</h1>
              <p className="landing__lede">Quotes, scheduling, field work, warranties, maintenance and payments, in place of WhatsApp threads, paper job cards and Excel.</p>
              <div className="landing__cta">
                <Button size="xl" to="/signup">
                  Start 14-day free trial
                </Button>
                <Button size="xl" variant="tonal" to="/signin">
                  <Icon name="phone" size={18} />
                  Sign in with your phone
                </Button>
              </div>
              <div className="landing__trust">
                <span>
                  <Icon name="check" size={16} color="var(--success)" />
                  No card needed
                </span>
                <span>
                  <Icon name="check" size={16} color="var(--success)" />
                  Set up in under 5 minutes
                </span>
                <span>
                  <Icon name="check" size={16} color="var(--success)" />
                  Works offline in the field
                </span>
              </div>
            </div>

            <div className="preview__wrap" aria-hidden="true">
              <div className="preview">
                <div className="preview__bar">
                  <i />
                  <i />
                  <i />
                  <span className="preview__url">app / office</span>
                </div>
                <div className="preview__body">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="t-section-lg">Good morning, Chidi</span>
                    <span className="btn btn--primary btn--compact">New quote</span>
                  </div>
                  <div className="preview__kpis">
                    <div className="card preview__kpi">
                      <span className="t-caption muted">Collected this month</span>
                      <span className="preview__kpi-value">₦8.4M</span>
                    </div>
                    <div className="card preview__kpi">
                      <span className="t-caption muted">Quotes sent</span>
                      <span className="preview__kpi-value">23</span>
                    </div>
                    <div className="card preview__kpi">
                      <span className="t-caption muted">Jobs this week</span>
                      <span className="preview__kpi-value">9</span>
                    </div>
                  </div>
                  <div className="card card--list">
                    <div className="row">
                      <div className="row__main">
                        <span className="strong">Bello residence · 5 kVA</span>
                        <span className="t-caption faint">Lekki · Musa A.</span>
                      </div>
                      <Badge tone="blue">In progress</Badge>
                    </div>
                    <div className="row">
                      <div className="row__main">
                        <span className="strong">Okafor pharmacy · 3.5 kVA</span>
                        <span className="t-caption faint">Ikeja · deposit paid</span>
                      </div>
                      <Badge tone="green">Paid</Badge>
                    </div>
                    <div className="row preview__hide-sm">
                      <div className="row__main">
                        <span className="strong">Adeyemi home · service visit</span>
                        <span className="t-caption faint">Yaba · due Friday</span>
                      </div>
                      <Badge tone="amber">Due</Badge>
                    </div>
                  </div>
                </div>
              </div>
              <div className="preview__phone">
                <span className="t-overline">Today</span>
                <span className="t-small strong">Install · Bello residence</span>
                <div className="progress">
                  <div className="progress__bar" style={{ width: '70%' }} />
                </div>
                <span className="t-caption faint">7 of 10 checklist steps</span>
                <span className="btn btn--primary btn--compact">Continue job</span>
              </div>
            </div>
          </div>
        </section>

        <section className="landing__section" aria-labelledby="why">
          <div className="landing__inner">
            <span className="t-overline">Why installers switch</span>
            <h2 id="why" className="landing__h2" style={{ marginTop: 8 }}>
              Everything from site visit to service plan
            </h2>
            <div className="features">
              {features.map((f) => (
                <div key={f.title} className="card feature">
                  <span className="feature__icon" aria-hidden="true">
                    <Icon name={f.icon} size={20} />
                  </span>
                  <h3 className="t-section">{f.title}</h3>
                  <p className="t-small muted" style={{ margin: 0 }}>
                    {f.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="landing__section landing__section--alt" aria-labelledby="how">
          <div className="landing__inner">
            <span className="t-overline">How it works</span>
            <h2 id="how" className="landing__h2" style={{ marginTop: 8 }}>
              From first enquiry to a paid-up, serviced customer
            </h2>
            <ol className="help-journey" style={{ marginTop: 20 }}>
              {journeySteps.map((s, i) => (
                <li key={s.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="help-journey__num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="t-section">{s.label}</span>
                    <span className="badge badge--neutral" style={{ marginLeft: 'auto' }}>
                      {s.who}
                    </span>
                  </div>
                  <span className="t-small muted">{s.what}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing__section" aria-labelledby="faq">
          <div className="landing__inner">
            <span className="t-overline">Questions</span>
            <h2 id="faq" className="landing__h2" style={{ marginTop: 8, marginBottom: 20 }}>
              Frequently asked questions
            </h2>
            <div className="card faq">
              {landingFaqs.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p className="faq__answer" style={{ margin: 0 }}>
                    {f.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="landing__section" aria-labelledby="demo">
          <div className="landing__inner">
            <div className="card card--pad stack" style={{ gap: 16 }}>
              <div className="stack" style={{ gap: 4 }}>
                <h2 id="demo" className="t-section-lg">
                  Try a demo account
                </h2>
                <span className="t-small muted">Sign in as BrightPath Solar's staff to see what each role can do.</span>
              </div>
              <div className="demo-grid">
                {demo.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className="card demo-user"
                    onClick={() => {
                      if (isBackend) return navigate('/signin', { state: { phone: u.phone } });
                      setSession({ userId: u.id });
                      navigate(homeFor(u.role));
                    }}
                  >
                    <span className="demo-user__avatar" aria-hidden="true">
                      {initials(u.name)}
                    </span>
                    <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                      <span className="t-section">{u.name}</span>
                      <span className="t-caption faint">
                        {u.title && u.title !== roleLabel[u.role] ? `${roleLabel[u.role]} · ${u.title}` : roleLabel[u.role]}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={18} color="var(--faint)" />
                  </button>
                ))}
              </div>
              {isBackend && <span className="t-small muted">Demo accounts sign in with code 123456 on a local or test Supabase project.</span>}
              {!isBackend && demo.length < demoIds.length && (
                <span className="t-small muted">
                  Some demo accounts were replaced when a new firm signed up.{' '}
                  <button type="button" className="btn btn--text btn--compact" style={{ padding: 0 }} onClick={resetDemoData}>
                    Restore demo data
                  </button>
                </span>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="landing__foot">
        <div className="landing__inner">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} className="t-small muted">
            <Logo small />
            Solar Field Service
          </span>
          <span className="t-small muted">
            Customer pages: <Link to="/enquire">enquiry form</Link> · <Link to="/q/q_bello">quote and deposit</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
