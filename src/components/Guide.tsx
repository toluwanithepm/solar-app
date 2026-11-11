// In-place help (Paradox of the Active User: people learn by doing, so help sits where the question comes up):
// - InfoTip: a small (?) next to a term; opens on hover, keyboard focus or tap.
// - JourneyBar / NextStepCard: where a customer is in the journey and the one thing to do next.
// - Tour: a short guided walk through the main sections, offered once and replayable from Help.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { glossary, type GlossaryKey } from '../data/glossary';
import { journeySteps, type Journey } from '../data/journey';
import { Icon } from './Icon';
import { Button } from './ui';
import '../styles/guide.css';

// ---------- InfoTip ----------

export function InfoTip({ term, text, label }: { term?: GlossaryKey; text?: ReactNode; /** What it explains, for screen readers */ label?: string }) {
  const entry = term ? glossary[term] : undefined;
  const body = text ?? entry?.text;
  const name = label ?? entry?.term ?? 'this';
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<'below' | 'above'>('below');
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const tip = ref.current.querySelector<HTMLElement>('.infotip__bubble');
    if (!tip) return;
    const r = ref.current.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    setPlace(r.bottom + t.height + 12 > window.innerHeight && r.top > t.height + 12 ? 'above' : 'below');
    // Keep the bubble on screen sideways
    const left = r.left + r.width / 2 - t.width / 2;
    setShift(left < 8 ? 8 - left : left + t.width > window.innerWidth - 8 ? window.innerWidth - 8 - (left + t.width) : 0);
  }, [open]);

  useEffect(() => {
    if (!pinned) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) {
        setPinned(false);
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [pinned]);

  if (!body) return null;
  return (
    <span
      ref={ref}
      className="infotip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => !pinned && setOpen(false)}
      onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), setPinned(false))}
    >
      <button
        type="button"
        className="infotip__btn"
        aria-label={`What is ${name}?`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPinned(!pinned);
          setOpen(!pinned);
        }}
      >
        <Icon name="help" size={14} />
      </button>
      {open && (
        <span role="tooltip" id={id} className={`infotip__bubble infotip__bubble--${place}`} style={{ marginLeft: shift }}>
          {entry && <strong className="infotip__term">{entry.term}</strong>}
          {body}
        </span>
      )}
    </span>
  );
}

/** A label with its explanation next to it. */
export function Term({ children, term }: { children: ReactNode; term: GlossaryKey }) {
  return (
    <span className="term">
      {children}
      <InfoTip term={term} />
    </span>
  );
}

// ---------- Customer journey ----------

export function JourneyBar({ journey, compact }: { journey: Journey; compact?: boolean }) {
  return (
    <ol className={`journey${compact ? ' journey--compact' : ''}${journey.lost ? ' journey--lost' : ''}`} aria-label="Customer journey">
      {journeySteps.map((s, i) => {
        const state = journey.skipped?.includes(s.id) && i < journey.current ? 'skipped' : i < journey.current ? 'done' : i === journey.current ? 'current' : 'todo';
        return (
          <li key={s.id} className={`journey__step journey__step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="journey__dot" aria-hidden="true">
              {state === 'done' ? <Icon name="check" size={12} /> : state === 'skipped' ? '–' : i + 1}
            </span>
            <span className="journey__label">
              {s.label}
              <span className="sr-only">{state === 'done' ? ' (done)' : state === 'current' ? ' (current step)' : state === 'skipped' ? ' (skipped)' : ''}</span>
              {state === 'skipped' && <span className="journey__note" aria-hidden="true">Skipped</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The single most useful action for this customer now (one primary action per screen). */
export function NextStepCard({ journey, onBookSurvey, canAct }: { journey: Journey; onBookSurvey: () => void; canAct: boolean }) {
  const navigate = useNavigate();
  const n = journey.next;
  return (
    <section className="card next-step" aria-labelledby="next-step-title">
      <div className="next-step__body">
        <span className="t-overline">Next step</span>
        <h2 id="next-step-title" className="t-section-lg">
          {n.label}
        </h2>
        <span className="t-small muted">{n.hint}</span>
      </div>
      {canAct && n.kind !== 'none' && (
        <Button size="lg" onClick={() => (n.kind === 'book-survey' ? onBookSurvey() : navigate(n.to))}>
          {n.label}
          <Icon name="chevronRight" size={18} />
        </Button>
      )}
    </section>
  );
}

// ---------- Guided tour ----------

export type TourStep = { target: string; title: string; text: string };

export const officeTour: TourStep[] = [
  { target: 'nav-home', title: 'Start each day here', text: "Home shows today's jobs, money in and out, and a to-do list of anything that needs you." },
  { target: 'nav-customers', title: '1. Customers', text: 'Every enquiry becomes a customer. Open one to see where they are in the journey and the next step to take.' },
  { target: 'nav-quotes', title: '2. Quotes', text: 'Build a quote from the site survey and your price list, then send the link on WhatsApp. The customer accepts and pays the deposit online.' },
  { target: 'nav-jobs', title: '3. Jobs', text: 'Drag jobs onto technicians and days. Technicians see them on their phones and work through the checklist, even offline.' },
  { target: 'nav-aftercare', title: '4. Aftercare', text: 'Installed systems, warranties, service visits and fault reports, so customers keep coming back.' },
  { target: 'nav-money', title: '5. Money', text: 'Invoices, payments to approve and reports. Card, transfer and USSD payments arrive here on their own.' },
  { target: 'nav-help', title: 'Help is always here', text: 'Look for the (?) next to any term, or open Help for the full journey and answers to common questions.' },
];

const TOUR_KEY = 'solar-app:tour-done';
export const tourDone = () => {
  try {
    return localStorage.getItem(TOUR_KEY) === '1';
  } catch {
    return true;
  }
};
const markTourDone = () => {
  try {
    localStorage.setItem(TOUR_KEY, '1');
  } catch {
    // ignore
  }
};

let startTourListener: (() => void) | null = null;
/** Start the tour from anywhere (Help page, getting-started list). */
export const startTour = () => startTourListener?.();

export function Tour({ steps }: { steps: TourStep[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startTourListener = () => setIndex(0);
    return () => {
      startTourListener = null;
    };
  }, []);

  const step = index === null ? null : steps[index];
  useLayoutEffect(() => {
    if (!step) return;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        setRect(el.getBoundingClientRect());
      } else setRect(null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step]);

  useEffect(() => {
    if (index !== null) cardRef.current?.focus();
  }, [index]);

  if (index === null || !step) return null;
  const finish = () => {
    markTourDone();
    setIndex(null);
  };
  const last = index === steps.length - 1;
  const narrow = window.innerWidth < 900;
  const pos = rect && !narrow ? { top: Math.max(12, Math.min(rect.top - 8, window.innerHeight - 260)), left: rect.right + 16 } : rect ? { top: rect.bottom + 12, left: 12 } : { top: 80, left: 12 };

  return (
    <div className="tour" onKeyDown={(e) => e.key === 'Escape' && finish()}>
      <div className="tour__backdrop" onClick={finish} />
      {rect && <div className="tour__spot" style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }} />}
      <div ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tour-title" className="tour__card" style={pos}>
        <span className="t-caption faint">
          {index + 1} of {steps.length}
        </span>
        <h2 id="tour-title" className="t-section-lg">
          {step.title}
        </h2>
        <p className="t-body muted" style={{ margin: 0 }}>
          {step.text}
        </p>
        <div className="tour__progress" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={i <= index ? 'on' : ''} />
          ))}
        </div>
        <div className="tour__actions">
          <Button variant="text" size="sm" onClick={finish}>
            {last ? 'Close' : 'Skip tour'}
          </Button>
          <span style={{ flex: 1 }} />
          {index > 0 && (
            <Button variant="tonal" size="sm" onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          )}
          <Button size="sm" onClick={() => (last ? finish() : setIndex(index + 1))}>
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** First visit: a small, dismissible offer instead of forcing a tour on people who just want to work. */
export function TourOffer() {
  const [show, setShow] = useState(() => !tourDone());
  if (!show) return null;
  return (
    <div className="tour-offer card" role="region" aria-label="Take a tour">
      <span className="tour-offer__icon" aria-hidden="true">
        <Icon name="help" size={20} />
      </span>
      <div className="stack" style={{ gap: 2, flex: 1 }}>
        <span className="t-section">New here? Take the 1-minute tour</span>
        <span className="t-small muted">See how an enquiry becomes an installed, paid-up customer.</span>
      </div>
      <Button
        variant="text"
        size="sm"
        onClick={() => {
          markTourDone();
          setShow(false);
        }}
      >
        Not now
      </Button>
      <Button
        size="sm"
        onClick={() => {
          setShow(false);
          startTour();
        }}
      >
        Start tour
      </Button>
    </div>
  );
}
