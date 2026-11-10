import type { CSSProperties, ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useSyncStatus } from '../data/remote/sync';
import { isBackend, setForcedOffline, useDb, useOnline } from '../data/store';
import { Icon, type IconName } from './Icon';
import '../styles/phone.css';

/**
 * Offline-first status line (NFR-1): shows connectivity and how many changes wait to be sent.
 * Labelled in words and icon (not colour alone) so it reads in bright sun.
 * The toggle simulates losing data so offline behaviour can be tested on a desk.
 */
export function SyncBanner({ style, inset }: { style?: CSSProperties; /** Pad to sit under a page header */ inset?: boolean }) {
  const online = useOnline();
  const demoPending = useDb((d) => d.jobs.filter((j) => j.pendingSync).length + d.surveys.filter((s) => s.photos.some((p) => !p.uploaded)).length);
  const sync = useSyncStatus();
  // Backend mode counts real unsent changes kept on this device
  const pending = isBackend ? sync.pending : demoPending;
  const changes = `${pending} change${pending === 1 ? '' : 's'}`;
  const tone = !online ? ' p-sync--offline' : pending ? ' p-sync--pending' : '';
  const text = online ? (pending ? `Sending ${changes}…` : 'Online · all changes sent') : pending ? `Offline · ${changes} waiting to send` : 'Offline · changes will be kept on this phone';
  const banner = (
    <div className="sync-banner p-sync" role="status" style={inset ? undefined : style}>
      <Icon name={online ? (pending ? 'sync' : 'checkCircle') : 'cloudOff'} size={20} color={online && !pending ? 'var(--success)' : undefined} />
      <span className="p-sync__text">{text}</span>
      <button type="button" className="btn btn--text" onClick={() => setForcedOffline(online)}>
        {online ? 'Go offline' : 'Go online'}
      </button>
    </div>
  );
  return inset ? (
    <div className="p-sync-wrap" style={style}>
      {banner}
    </div>
  ) : (
    banner
  );
}

type PhoneScreenProps = {
  children: ReactNode;
  /** Fixed screens fill the viewport and scroll inside; others scroll the page. */
  fixed?: boolean;
  style?: CSSProperties;
};

export function PhoneScreen({ children, fixed = true, style }: PhoneScreenProps) {
  return (
    <div className={`phone${fixed ? ' phone--fixed' : ''}`} style={style}>
      {children}
    </div>
  );
}

type AppBarProps = {
  title: ReactNode;
  leading: { to: string; icon: IconName; label: string };
  trailing?: ReactNode;
  color?: string;
};

export function AppBar({ title, leading, trailing, color }: AppBarProps) {
  return (
    <header className="appbar" style={color ? { color } : undefined}>
      <Link to={leading.to} aria-label={leading.label} className="icon-btn" style={color ? { color } : undefined}>
        <Icon name={leading.icon} />
      </Link>
      <span className="appbar__title">{title}</span>
      {trailing}
    </header>
  );
}

const techNav: { to: string; label: string; icon: IconName }[] = [
  { to: '/tech', label: 'Today', icon: 'calendar' },
  { to: '/tech/jobs', label: 'All jobs', icon: 'dashboard' },
  { to: '/tech/customers', label: 'Customers', icon: 'people' },
];

export function TechBottomNav() {
  return (
    <nav aria-label="Main" className="bottom-nav">
      {techNav.map((item) => (
        <NavLink key={item.to} to={item.to} end className="nav-item">
          <span className="nav-item__pill">
            <Icon name={item.icon} size={22} />
          </span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
