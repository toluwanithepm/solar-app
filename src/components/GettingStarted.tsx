// Getting started (owners): the few set-up steps that make everything else work, ticked off from real data where
// possible. A visible, unfinished list nudges completion (Zeigarnik effect) and progress motivates (goal gradient).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isBackend, useDb } from '../data/store';
import { startTour, tourDone } from './Guide';
import { Icon } from './Icon';
import { ProgressBar } from './ui';
import '../styles/guide.css';

const KEY = 'solar-app:getting-started';
type Saved = { dismissed?: boolean; shared?: boolean };
const read = (): Saved => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
};
const write = (s: Saved) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
};

export function GettingStarted() {
  const navigate = useNavigate();
  const company = useDb((d) => d.company);
  const prices = useDb((d) => d.priceItems.length);
  const techs = useDb((d) => d.users.filter((u) => u.role === 'technician' && u.active).length);
  const quoted = useDb((d) => d.quotes.some((q) => q.status !== 'Draft'));
  const [saved, setSaved] = useState(read);
  const save = (s: Saved) => {
    const next = { ...saved, ...s };
    setSaved(next);
    write(next);
  };

  const items = [
    { label: 'Add your company and bank details', hint: 'They appear on quotes and invoices', done: !!(company.phone && company.accountNumber), go: () => navigate('/office/settings/company') },
    { label: 'Check your price list', hint: 'Costs and selling prices for your equipment', done: prices > 0, go: () => navigate('/office/settings/prices') },
    { label: 'Add your technicians', hint: 'They sign in on their phones with their number', done: techs > 0, go: () => navigate('/office/settings/staff') },
    {
      label: 'Share your enquiry form',
      hint: 'Put it on WhatsApp and your social pages',
      done: !!saved.shared,
      go: () => {
        save({ shared: true });
        navigate(isBackend ? '/office/settings/company' : '/enquire');
      },
    },
    { label: 'Send your first quote', hint: 'Start from a customer under Customers', done: quoted, go: () => navigate('/office/leads') },
    { label: 'Take the 1-minute tour', hint: 'See the whole journey', done: tourDone(), go: () => startTour() },
  ];
  const doneCount = items.filter((i) => i.done).length;
  if (saved.dismissed || doneCount === items.length) return null;

  return (
    <section className="card setup" aria-labelledby="setup-title">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div className="stack" style={{ gap: 2, flex: 1 }}>
          <h2 id="setup-title" className="t-section-lg">
            Getting started
          </h2>
          <span className="t-small muted">
            {doneCount} of {items.length} done. Finish these and the app runs most of the paperwork for you.
          </span>
        </div>
        <button type="button" className="btn btn--text btn--compact" onClick={() => save({ dismissed: true })}>
          Hide
        </button>
      </div>
      <ProgressBar value={Math.round((doneCount / items.length) * 100)} label="Getting started progress" />
      <ul className="setup__list">
        {items.map((i) => (
          <li key={i.label}>
            <button type="button" className={`setup__item${i.done ? ' setup__item--done' : ''}`} onClick={i.go} style={{ width: '100%' }}>
              <span className="setup__check" aria-hidden="true">
                {i.done && <Icon name="check" size={14} />}
              </span>
              <span className="stack" style={{ gap: 0, flex: 1 }}>
                <span className="setup__label t-small strong">{i.label}</span>
                <span className="t-caption faint">{i.hint}</span>
              </span>
              <span className="sr-only">{i.done ? '(done)' : ''}</span>
              <Icon name="chevronRight" size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
