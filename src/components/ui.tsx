import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

type ButtonVariant = 'primary' | 'tonal' | 'text';
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

type ButtonProps = {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  to?: string;
  /** External link (wa.me, maps); opens in a new tab */
  href?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function Button({ children, variant = 'primary', size = 'md', block, to, href, onClick, type = 'button', disabled, className = '', ariaLabel }: ButtonProps) {
  const cls = `btn btn--${variant} btn--${size}${block ? ' btn--block' : ''} ${className}`.trim();
  if (to && !disabled) {
    return (
      <Link to={to} className={cls} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }
  if (href && !disabled) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls} aria-label={ariaLabel} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__bar" style={{ width: `${value}%` }} />
    </div>
  );
}

type SegmentedProps<T extends string> = {
  label: string;
  options: { id: T; name: string }[];
  value: T;
  onChange: (id: T) => void;
  fill?: boolean;
  /** "radio" for a choice, "tab" when it switches the content below */
  kind?: 'radio' | 'tab';
};

export function Segmented<T extends string>({ label, options, value, onChange, fill, kind = 'radio' }: SegmentedProps<T>) {
  return (
    <div
      role={kind === 'radio' ? 'radiogroup' : 'tablist'}
      aria-label={label}
      className={`segmented${fill ? ' segmented--fill' : ''}`}
      style={fill ? undefined : { alignSelf: 'flex-start' }}
    >
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role={kind}
            {...(kind === 'radio' ? { 'aria-checked': selected } : { 'aria-selected': selected })}
            className="segmented__item"
            onClick={() => onChange(o.id)}
          >
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

export function StatusDot({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="dot" aria-hidden="true" style={{ background: color }} />
      {children}
    </span>
  );
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <span role="img" aria-label="Installer logo" className={`logo${small ? ' logo--sm' : ''}`}>
      <Icon name="bolt" size={small ? 16 : 20} filled />
    </span>
  );
}

export type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet';
const toneIcon: Record<Tone, IconName | null> = {
  neutral: null,
  blue: 'circleDot',
  green: 'checkCircle',
  amber: 'clock',
  red: 'alertCircle',
  violet: 'checkCircle',
};

/** Status pill: tint + icon + label, so state never depends on colour alone. */
export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: IconName | false; children: ReactNode }) {
  const glyph = icon === false ? null : (icon ?? toneIcon[tone]);
  return (
    <span className={`badge badge--${tone}`}>
      {glyph && <Icon name={glyph} size={13} />}
      {children}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty__icon" aria-hidden="true">
        <Icon name="inbox" size={20} />
      </span>
      <span className="t-section">{title}</span>
      {children && <span className="t-small muted">{children}</span>}
    </div>
  );
}

/** Office page header: optional back link, title, subtitle and actions on the right. */
export function PageHeader({ title, subtitle, back, actions }: { title: ReactNode; subtitle?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head__title">
        {back && (
          <Link to={back.to} className="page-head__back">
            <Icon name="chevronLeft" size={16} />
            {back.label}
          </Link>
        )}
        <h1 className="t-display">{title}</h1>
        {subtitle && (
          <span className="page-head__sub">
            {subtitle}
          </span>
        )}
      </div>
      {actions}
    </div>
  );
}

/** Label/value pair stacked vertically, used for stat readouts. */
export function Stat({ label, value, size = 20 }: { label: string; value: ReactNode; size?: number }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <span className="t-small muted">{label}</span>
      <span className="num" style={{ fontSize: size, lineHeight: `${size + 8}px`, fontWeight: 600, letterSpacing: size >= 20 ? '-0.01em' : undefined }}>{value}</span>
    </div>
  );
}
