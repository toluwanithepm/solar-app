// Loading feedback: a spinner for actions, and skeletons shaped like the screen that is on its way
// (so the layout doesn't jump when the data lands). Screen readers hear one "Loading…" status, not the shapes.
import { useLayoutEffect, type CSSProperties } from 'react';
import '../styles/loading.css';

export function Spinner({ size = 18, label }: { size?: number; /** Announce it (use when no other text says what is happening) */ label?: string }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 9)) }}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}

/** A grey placeholder block. */
export function Skeleton({ w = '100%', h = 14, r, style }: { w?: number | string; h?: number; r?: number; style?: CSSProperties }) {
  return <span className="skeleton sk" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

function Announce({ text = 'Loading…' }: { text?: string }) {
  return (
    <span role="status" className="sr-only">
      {text}
    </span>
  );
}

/** Office: sidebar, top bar, title, KPI tiles and a table, in the real layout's places. */
export function OfficeSkeleton({ text }: { text?: string }) {
  // Same appearance setting the office uses (OfficeShell), so a dark-mode user doesn't see a light flash first
  useLayoutEffect(() => {
    let pref = 'system';
    try {
      pref = localStorage.getItem('solar-app:theme') || 'system';
    } catch {
      // ignore
    }
    const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, []);
  return (
    <div className="office" aria-busy="true">
      <Announce text={text} />
      <div className="sidebar" aria-hidden="true">
        <div className="sidebar__brand">
          <Skeleton w={28} h={28} r={7} />
          <Skeleton w={110} h={14} />
        </div>
        <div className="sidebar__nav">
          {[3, 2, 3, 2, 1].map((n, g) => (
            <div key={g} className="sidebar__group" style={{ gap: 10, padding: '0 10px' }}>
              {g > 0 && g < 4 && <Skeleton w={64} h={10} />}
              {Array.from({ length: n }, (_, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Skeleton w={18} h={18} r={5} />
                  <Skeleton w={70 + ((i * 23) % 40)} h={12} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="office__col" aria-hidden="true">
        <div className="topbar">
          <div className="topbar__left">
            <Skeleton w={150} h={24} r={12} />
          </div>
          <Skeleton w={32} h={32} r={16} />
        </div>
        <div className="office__main">
          <div className="stack" style={{ gap: 8 }}>
            <Skeleton w={260} h={26} />
            <Skeleton w={200} h={14} />
          </div>
          <div className="kpi-grid">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="card kpi">
                <Skeleton w="55%" h={12} />
                <Skeleton w="40%" h={26} />
                <Skeleton w="70%" h={12} />
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card__head">
              <Skeleton w={140} h={16} />
            </div>
            <div className="sk-rows">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="sk-row">
                  <Skeleton w={48} h={12} />
                  <Skeleton w={`${22 + ((i * 7) % 12)}%`} h={12} />
                  <Skeleton w="16%" h={12} />
                  <Skeleton w={84} h={20} r={10} style={{ marginLeft: 'auto' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Technician phone: header, sync line, next-job card and a short list. */
export function PhoneSkeleton({ text }: { text?: string }) {
  return (
    <div className="phone phone--fixed" aria-busy="true">
      <Announce text={text} />
      <div className="sk-phone" aria-hidden="true">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div className="stack" style={{ gap: 8, flex: 1 }}>
            <Skeleton w={150} h={13} />
            <Skeleton w={110} h={30} />
          </div>
          <Skeleton w={48} h={48} r={24} />
          <Skeleton w={48} h={48} r={24} />
        </div>
        <Skeleton h={44} r={10} />
        <div className="card card--pad stack" style={{ gap: 12 }}>
          <Skeleton w="45%" h={14} />
          <Skeleton w="70%" h={24} />
          <Skeleton w="90%" h={14} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Skeleton w={110} h={28} r={8} />
            <Skeleton w={110} h={28} r={8} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Skeleton h={48} r={8} style={{ flex: 1, width: 'auto' }} />
            <Skeleton h={48} r={8} style={{ flex: 1, width: 'auto' }} />
          </div>
        </div>
        <Skeleton w={120} h={18} />
        <div className="card">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="sk-row sk-row--phone">
              <Skeleton w={48} h={14} />
              <div className="stack" style={{ gap: 6, flex: 1 }}>
                <Skeleton w="60%" h={15} />
                <Skeleton w="40%" h={12} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Customer pages: firm header, title and a content card. */
export function PageSkeleton({ text }: { text?: string }) {
  return (
    <div className="phone" aria-busy="true">
      <Announce text={text} />
      <div aria-hidden="true">
        <div className="sk-brand">
          <Skeleton w={40} h={40} r={10} />
          <Skeleton w={140} h={16} />
        </div>
        <div className="sk-phone">
          <Skeleton w="50%" h={13} />
          <Skeleton w="80%" h={28} />
          <div className="card card--pad stack" style={{ gap: 12 }}>
            <Skeleton w="35%" h={12} />
            <Skeleton w="60%" h={32} />
            <Skeleton w="45%" h={13} />
          </div>
          <div className="card card--pad stack" style={{ gap: 12 }}>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Skeleton w="40%" h={14} />
                <Skeleton w="25%" h={14} />
              </div>
            ))}
          </div>
          <Skeleton h={52} r={10} />
        </div>
      </div>
    </div>
  );
}

/** The right skeleton for where the app is opening. */
export function AppSkeleton({ path = location.pathname, text }: { path?: string; text?: string }) {
  if (path.startsWith('/office')) return <OfficeSkeleton text={text} />;
  if (path.startsWith('/tech')) return <PhoneSkeleton text={text} />;
  return <PageSkeleton text={text} />;
}
