import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { fmtDateTime, roleLabel } from '../data/domain';
import { signOut } from '../data/auth';
import { update, useCurrentUser, useDb } from '../data/store';
import { Icon, type IconName } from './Icon';
import { Logo } from './ui';

const officeNav: { group?: string; items: { to: string; label: string; icon: IconName; end?: boolean }[] }[] = [
  { items: [{ to: '/office', label: 'Home', icon: 'dashboard', end: true }] },
  {
    group: 'Sales',
    items: [
      { to: '/office/leads', label: 'Leads', icon: 'people' },
      { to: '/office/quotes', label: 'Quotes', icon: 'description' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { to: '/office/schedule', label: 'Schedule', icon: 'calendar' },
      { to: '/office/service', label: 'Service', icon: 'wrench' },
      { to: '/office/installations', label: 'Register', icon: 'shield' },
    ],
  },
  {
    group: 'Money',
    items: [
      { to: '/office/payments', label: 'Payments', icon: 'receipt' },
      { to: '/office/reports', label: 'Reports', icon: 'chart' },
    ],
  },
  { items: [{ to: '/office/settings', label: 'Settings', icon: 'settings' }] },
];

// ---------- theme (office only: technician and customer screens stay light for outdoor reading) ----------

type ThemePref = 'system' | 'light' | 'dark';
const THEME_KEY = 'solar-app:theme';
const readPref = (): ThemePref => {
  try {
    return (localStorage.getItem(THEME_KEY) as ThemePref) || 'system';
  } catch {
    return 'system';
  }
};

function useOfficeTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || (pref === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
      delete document.documentElement.dataset.theme;
    };
  }, [pref]);
  const choose = (p: ThemePref) => {
    setPref(p);
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch {
      // ignore
    }
  };
  return [pref, choose] as const;
}

export function OfficeShell({ children, gap = 24 }: { children: ReactNode; gap?: number }) {
  const company = useDb((d) => d.company);
  const [theme, setTheme] = useOfficeTheme();
  return (
    <div className="office">
      <nav aria-label="Main" className="sidebar no-print">
        <Link to="/office" className="sidebar__brand" aria-label={`${company.name || 'Home'}: home`}>
          <Logo small />
          <span className="sidebar__firm">{company.name || 'Solar Field Service'}</span>
        </Link>
        <div className="sidebar__nav">
          {officeNav.map((section, i) => (
            <div key={section.group ?? i} className="sidebar__group">
              {section.group && <span className="sidebar__label">{section.group}</span>}
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className="side-link">
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </div>
      </nav>
      <div className="office__col">
        <TopBar theme={theme} setTheme={setTheme} />
        <main className="office__main" style={{ gap }}>
          {children}
        </main>
      </div>
    </div>
  );
}

/** Closes a popover on outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

function TopBar({ theme, setTheme }: { theme: ThemePref; setTheme: (t: ThemePref) => void }) {
  const user = useCurrentUser();
  const company = useDb((d) => d.company);
  const notifications = useDb((d) => d.notifications);
  const navigate = useNavigate();
  const [open, setOpen] = useState<'bell' | 'account' | null>(null);
  const close = () => setOpen(null);
  const bellRef = useDismiss(open === 'bell', close);
  const accountRef = useDismiss(open === 'account', close);
  const mine = notifications.filter((n) => user && n.forRoles.includes(user.role));
  const unread = mine.filter((n) => !n.read).length;
  const trialDays = Math.ceil((new Date(company.subscription.trialEndsAt).getTime() - Date.now()) / 86_400_000);

  return (
    <header className="topbar no-print">
      <div className="topbar__left">
        {company.subscription.status === 'trial' && (
          <Link to="/office/settings/billing" className="trial-pill">
            <Icon name="bolt" size={14} />
            Free trial · {Math.max(0, trialDays)} days left
          </Link>
        )}
      </div>
      <div ref={bellRef} style={{ position: 'relative' }}>
        <button type="button" className="icon-btn" aria-label={`Notifications, ${unread} unread`} aria-expanded={open === 'bell'} onClick={() => setOpen(open === 'bell' ? null : 'bell')}>
          <Icon name="bell" size={20} />
          {unread > 0 && <span className="topbar__count">{unread > 9 ? '9+' : unread}</span>}
        </button>
        {open === 'bell' && (
          <div className="card popover" style={{ width: 360 }}>
            <div className="card__head">
              <span className="t-section">Notifications</span>
              {unread > 0 && (
                <button
                  type="button"
                  className="btn btn--text btn--compact"
                  onClick={() => update((d) => d.notifications.forEach((n) => user && n.forRoles.includes(user.role) && (n.read = true)))}
                >
                  Mark all read
                </button>
              )}
            </div>
            <div style={{ maxHeight: 380, overflowY: 'auto', padding: '4px 0' }}>
              {mine.length === 0 && <p className="t-small muted" style={{ padding: '12px 16px', margin: 0 }}>You're all caught up.</p>}
              {mine.slice(0, 20).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="notif"
                  onClick={() => {
                    update((d) => {
                      const x = d.notifications.find((y) => y.id === n.id);
                      if (x) x.read = true;
                    });
                    close();
                    if (n.link) navigate(n.link);
                  }}
                >
                  <span className="dot" aria-hidden="true" style={{ marginTop: 7, background: n.read ? 'transparent' : 'var(--primary)' }} />
                  <span className="row__main">
                    <span style={{ fontWeight: n.read ? 400 : 500 }}>{n.text}</span>
                    <span className="t-caption faint">{fmtDateTime(n.at)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div ref={accountRef} style={{ position: 'relative' }}>
        <button type="button" aria-label="Account" aria-expanded={open === 'account'} className="avatar" onClick={() => setOpen(open === 'account' ? null : 'account')}>
          {user?.name
            .split(' ')
            .map((p) => p[0])
            .join('')
            .slice(0, 2)}
        </button>
        {open === 'account' && user && (
          <div className="card popover" style={{ width: 280, padding: 16, gap: 14 }}>
            <div className="stack" style={{ gap: 2 }}>
              <span className="t-section">{user.name}</span>
              <span className="t-small muted">
                {roleLabel[user.role]} · {user.phone}
              </span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <span className="t-caption muted strong">Appearance</span>
              <div role="radiogroup" aria-label="Appearance" className="segmented segmented--fill">
                {(['system', 'light', 'dark'] as const).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={theme === t} className="segmented__item" onClick={() => setTheme(t)}>
                    {t === 'system' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="btn btn--tonal btn--md"
              onClick={async () => {
                await signOut();
                navigate('/');
              }}
            >
              <Icon name="logout" size={18} />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
