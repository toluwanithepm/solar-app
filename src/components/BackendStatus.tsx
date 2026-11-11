import { useEffect, useState, type ReactNode } from 'react';
import { restoreSession } from '../data/auth';
import { clearSyncError, useSyncStatus } from '../data/remote/sync';
import { isBackend } from '../data/store';
import { Icon } from './Icon';
import '../styles/phone.css';

/** Backend mode: resume the saved sign-in and hold the app until the firm's data has loaded. */
export function BackendGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isBackend);
  const status = useSyncStatus();
  useEffect(() => {
    if (isBackend) void restoreSession().finally(() => setReady(true));
  }, []);
  if (!ready || (isBackend && status.loading && !status.loaded)) {
    return (
      <div role="status" className="t-body muted p-loading">
        <Icon name="sync" size={20} />
        Loading your data…
      </div>
    );
  }
  return (
    <>
      <DemoModeNotice />
      <SyncErrorBanner />
      {children}
    </>
  );
}

/**
 * A hosted site built without the Supabase settings runs as a demo: every device keeps its own sample data
 * and nothing is shared. Say so plainly, so it can't be mistaken for the real thing.
 */
function DemoModeNotice() {
  const local = /^(localhost|127.0.0.1|[::1])$/.test(location.hostname);
  if (isBackend || local) return null;
  return (
    <div role="note" className="no-print demo-strip">
      <Icon name="warning" size={16} />
      <span>
        <strong>Demo mode.</strong> Changes stay on this device and aren't shared with the office or other phones.
      </span>
    </div>
  );
}

/** Shows when a change was refused or the data couldn't load; the store has already reloaded from the server. */
function SyncErrorBanner() {
  const { error } = useSyncStatus();
  if (!isBackend || !error) return null;
  return (
    <div role="alert" className="no-print p-toast p-toast--bottom p-toast--bad">
      <Icon name="warning" size={20} />
      <span style={{ flexGrow: 1 }}>{error}</span>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={clearSyncError}>
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}
