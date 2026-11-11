// Help: how the whole journey works, common questions and what the terms mean.
// Written for an office manager on their first day, not for engineers.
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { OfficeShell } from '../../components/OfficeShell';
import { startTour } from '../../components/Guide';
import { Button, PageHeader } from '../../components/ui';
import { glossary } from '../../data/glossary';
import { journeySteps } from '../../data/journey';
import '../../styles/guide.css';

const where: Record<string, { to: string; label: string }> = {
  enquiry: { to: '/office/leads', label: 'Customers' },
  survey: { to: '/office/schedule', label: 'Jobs' },
  quote: { to: '/office/quotes', label: 'Quotes' },
  deposit: { to: '/office/payments', label: 'Money' },
  install: { to: '/office/schedule', label: 'Jobs' },
  aftercare: { to: '/office/service', label: 'Aftercare' },
};

export const faqs: { q: string; a: string }[] = [
  {
    q: 'What should I do first?',
    a: 'Check your company and bank details, then your price list (your costs and selling prices), then add your technicians under Settings → Staff. The getting-started list on Home tracks this for you.',
  },
  {
    q: 'How does a new customer get into the app?',
    a: 'Three ways: press "Log enquiry" on Customers when someone calls or walks in, share your enquiry form link on WhatsApp or social media, or let a technician add one while on a site survey.',
  },
  {
    q: 'Do I need a site survey before quoting?',
    a: 'No, but it helps. The survey records the appliances and the app suggests the inverter, battery and panels. If you already know the load, open the customer and press "New quote".',
  },
  {
    q: 'How does the customer accept and pay?',
    a: 'Send the quote link on WhatsApp. The customer opens it on their phone, picks an option and pays the deposit by card, bank transfer or USSD. The payment shows up under Money on its own, and an installation job is created for you to schedule.',
  },
  {
    q: 'A customer paid cash or by bank transfer to our account. What do I do?',
    a: 'Open Money, find the invoice and press "Record payment". Payments recorded by staff wait for the owner to approve them, so cash is always checked.',
  },
  {
    q: 'How do technicians get their jobs?',
    a: 'Drag the job onto a technician and a day on the Jobs board. It appears on their phone straight away. They check in, work through the checklist, scan serial numbers, take photos and get the customer to sign.',
  },
  {
    q: 'What if a technician has no signal?',
    a: 'The phone app keeps working. Their changes are stored on the phone and sent when the signal returns. The status line on their phone says how many changes are waiting.',
  },
  {
    q: 'What happens after the installation?',
    a: 'The system is registered with its serial numbers and warranty dates under Aftercare. The customer gets a handover report with a link to report faults, and service reminders go out before each visit is due.',
  },
  {
    q: 'Who can see costs and profit margins?',
    a: 'Only owners. Office staff can build and send quotes but never see your costs, and technicians never see prices at all.',
  },
  {
    q: 'A phone was lost or a technician left. How do I protect our data?',
    a: 'Open Settings → Staff, choose the person and press "Sign out of all phones". Their phones delete the saved customer and job data as soon as they connect. Deactivate them too if they have left.',
  },
  {
    q: 'Does the app send WhatsApp messages and reminders by itself?',
    a: 'Not yet. Today the WhatsApp buttons open WhatsApp with the message and link ready for you to send, and reminders are listed under Settings → Messages. Automatic sending by WhatsApp and SMS is coming. Only customers who agreed to WhatsApp will get WhatsApp messages.',
  },
];

export function Help() {
  return (
    <OfficeShell>
      <PageHeader
        title="Help"
        subtitle="How the app works, from first enquiry to aftercare"
        actions={
          <Button variant="tonal" onClick={startTour}>
            <Icon name="help" size={18} />
            Take the tour again
          </Button>
        }
      />

      <section aria-labelledby="how" className="stack" style={{ gap: 12 }}>
        <h2 id="how" className="t-section-lg">
          The customer journey in six steps
        </h2>
        <ol className="help-journey">
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
              <Link to={where[s.id].to} className="t-small strong" style={{ marginTop: 'auto' }}>
                Go to {where[s.id].label} →
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="card" aria-labelledby="faq">
        <div className="card__head">
          <h2 id="faq" className="t-section-lg">
            Common questions
          </h2>
        </div>
        <div className="faq">
          {faqs.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p className="faq__answer" style={{ margin: 0 }}>
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="card card--pad" aria-labelledby="terms">
        <h2 id="terms" className="t-section-lg" style={{ marginBottom: 8 }}>
          What the terms mean
        </h2>
        <dl className="glossary">
          {Object.values(glossary).map((g) => (
            <div key={g.term}>
              <dt>{g.term}</dt>
              <dd>{g.text}</dd>
            </div>
          ))}
        </dl>
      </section>
    </OfficeShell>
  );
}
