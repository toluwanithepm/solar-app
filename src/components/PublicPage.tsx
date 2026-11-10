import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { VerifyResponse, ViewResponse } from '../../supabase/functions/_shared/contract';
import { fromRemote } from '../data/remote/mapping';
import { callPublic, customerUrl, isToken, type LinkKind } from '../data/remote/publicApi';
import { reload } from '../data/remote/sync';
import { getDb, getSession, isBackend, replaceDb } from '../data/store';
import type { DB } from '../data/types';
import { Icon } from './Icon';
import '../styles/phone.css';
import { EmptyState } from './ui';

type PublicCtx = { targetId?: string; token?: string; links: Record<string, string>; provider?: 'paystack' | 'bachs'; refresh: () => Promise<void> };
const Ctx = createContext<PublicCtx | null>(null);

const has: Record<LinkKind, (d: DB, id: string) => boolean> = {
  quote: (d, id) => d.quotes.some((x) => x.id === id),
  invoice: (d, id) => d.invoices.some((x) => x.id === id),
  handover: (d, id) => d.jobs.some((x) => x.id === id),
  fault_report: (d, id) => d.installations.some((x) => x.id === id),
};

/**
 * Wraps a customer page (quote, payment, handover report, fault report).
 * Demo mode, or a signed-in staff member opening a record id: the page reads the app's own data.
 * Backend mode with a link token: loads just what this customer may see from the `public` Edge Function,
 * and handles the return from the payment page (?reference=…).
 */
export function PublicPage({ kind, param, children }: { kind: LinkKind; param: string; children: ReactNode }) {
  const raw = useParams()[param];
  const location = useLocation();
  const navigate = useNavigate();
  const viaToken = isBackend && isToken(raw);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>(viaToken ? 'loading' : 'ready');
  const [targetId, setTargetId] = useState<string | undefined>(viaToken ? undefined : raw);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<PublicCtx['provider']>();
  const [notice, setNotice] = useState<{ tone: 'ok' | 'wait' | 'bad'; text: string } | null>(null);
  const replaced = useRef(false);

  const load = useCallback(async () => {
    if (!viaToken || !raw) return;
    const bundle = await callPublic<ViewResponse>({ action: 'view', token: raw });
    setLinks(bundle.links ?? {});
    setProvider(bundle.paymentProvider);
    setTargetId(bundle.targetId);
    // A signed-in staff member already has this record; don't swap out their data
    if (getSession() && has[kind](getDb(), bundle.targetId)) return;
    const firmId = String(bundle.tables.firms?.[0]?.id ?? '');
    replaceDb(fromRemote(bundle.tables, { firmId, staffId: '', role: 'viewer' }, (bucket, path) => bundle.files[`${bucket}/${path}`] ?? ''));
    replaced.current = true;
  }, [viaToken, raw, kind]);

  useEffect(() => {
    if (!viaToken) {
      setTargetId(raw);
      setState('ready');
      return;
    }
    let live = true;
    (async () => {
      const reference = new URLSearchParams(location.search).get('reference');
      if (reference) {
        navigate(location.pathname, { replace: true });
        setNotice({ tone: 'wait', text: 'Checking your payment…' });
        try {
          const v = await callPublic<VerifyResponse>({ action: 'verify', reference });
          if (live) setNotice(v.status === 'success' ? { tone: 'ok', text: 'Payment received. Thank you!' } : v.status === 'pending' ? { tone: 'wait', text: 'Your payment is still being confirmed. This page will update shortly.' } : { tone: 'bad', text: "That payment didn't go through. You can try again." });
          if (v.status === 'pending') setTimeout(() => void load().catch(() => undefined), 4000);
        } catch {
          if (live) setNotice({ tone: 'wait', text: 'Your payment is being confirmed. Refresh this page in a minute.' });
        }
      }
      try {
        await load();
        if (live) setState('ready');
      } catch {
        if (live) setState('invalid');
      }
    })();
    return () => {
      live = false;
    };
    // Load once per link; the query string is consumed above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viaToken, raw]);

  // Give a signed-in staff member their own data back when they leave a customer page
  useEffect(
    () => () => {
      if (replaced.current && getSession()) void reload();
    },
    [],
  );

  if (state === 'loading') {
    return (
      <div role="status" className="t-body muted p-loading">
        <span className="skeleton" aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 'var(--radius-pill)' }} />
        Loading…
      </div>
    );
  }
  if (state === 'invalid') {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '64px 16px' }}>
        <EmptyState title="This link isn't valid or has expired">Ask your installer to send you a new link.</EmptyState>
      </div>
    );
  }

  const toneIcon = { ok: 'checkCircle', wait: 'clock', bad: 'alertCircle' } as const;
  return (
    <Ctx.Provider value={{ targetId, token: viaToken ? raw : undefined, links, provider, refresh: load }}>
      {notice && (
        <div role="status" className={`no-print p-toast p-toast--top p-toast--${notice.tone}`}>
          <Icon name={toneIcon[notice.tone]} size={20} />
          <span style={{ flexGrow: 1 }}>{notice.text}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}

/** The record id a customer page shows: resolved from the link token, or the URL param itself. */
export function usePublicTarget(param: string): string | undefined {
  const ctx = useContext(Ctx);
  const raw = useParams()[param];
  return ctx?.targetId ?? (isToken(raw) ? undefined : raw);
}

/** URL of a related customer page (e.g. pay the balance, report a fault), or undefined when the customer can't open it. */
export function usePublicLink(kind: LinkKind, targetId: string | undefined): string | undefined {
  const ctx = useContext(Ctx);
  if (!targetId) return undefined;
  if (!isBackend) return customerUrl(kind, targetId);
  const token = ctx?.links[`${kind}:${targetId}`];
  if (token) return customerUrl(kind, token);
  return getSession() ? customerUrl(kind, targetId) : undefined;
}

/** The link token this page was opened with (backend mode), needed to start a payment or report a fault. */
export function usePublicToken(): string | undefined {
  return useContext(Ctx)?.token;
}

/** Reload the customer's data after they submit something (e.g. a fault report). */
export function usePublicRefresh() {
  return useContext(Ctx)?.refresh ?? (async () => undefined);
}

/** How the active payment provider takes money, for the line under a pay button (USSD is Paystack only). */
export function usePaymentMethodsNote(): string {
  return useContext(Ctx)?.provider === 'bachs' ? 'Card or bank transfer on Bachs' : 'Card, bank transfer or USSD on Paystack';
}
