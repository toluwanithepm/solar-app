import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { PhoneScreen } from '../../components/PhoneScreen';
import { PhotoInput, PhotoThumb } from '../../components/PhotoInput';
import { usePublicRefresh, usePublicTarget, usePublicToken } from '../../components/PublicPage';
import { TextArea } from '../../components/forms';
import { Badge, Button, EmptyState, Logo } from '../../components/ui';
import { fmtDate, fmtDateTime } from '../../data/domain';
import { createTicket } from '../../data/opsActions';
import type { ReportResponse } from '../../../supabase/functions/_shared/contract';
import { callPublic } from '../../data/remote/publicApi';
import { isBackend, useDb } from '../../data/store';
import type { Photo } from '../../data/types';

export function ReportFault() {
  const installationId = usePublicTarget('installationId');
  const token = usePublicToken();
  const refresh = usePublicRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const db = useDb();
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [sent, setSent] = useState<string | null>(null);
  const ins = db.installations.find((i) => i.id === installationId);
  const lead = ins && db.leads.find((l) => l.id === ins.leadId);
  const tickets = db.tickets.filter((t) => t.installationId === installationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const company = db.company;

  return (
    <PhoneScreen fixed={false}>
      <header style={{ height: 64, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', borderBottom: '1px solid var(--divider)', flexShrink: 0 }}>
        {company.logoDataUrl ? <img src={company.logoDataUrl} alt="" style={{ width: 32, height: 32, borderRadius: 10, objectFit: 'cover' }} /> : <Logo small />}
        <span className="t-body" style={{ fontWeight: 500 }}>
          {company.name}
        </span>
      </header>

      <main style={{ padding: '32px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {!ins || !lead ? (
          <EmptyState title="This link is not valid">Please contact {company.name} on {company.phone}.</EmptyState>
        ) : (
          <>
            <div className="stack" style={{ padding: '0 4px', gap: 8 }}>
              <span className="t-small muted">
                {lead.name} · installed {fmtDate(ins.installedAt)}
              </span>
              <h1 className="t-display">Report a problem</h1>
            </div>

            {sent ? (
              <section className="card card--pad stack" style={{ gap: 8 }} role="status">
                <Icon name="checkCircle" size={32} color="var(--success)" />
                <span className="t-title">We've got it</span>
                <span className="t-body muted">
                  Your ticket number is <strong style={{ color: 'var(--text)' }}>{sent}</strong>. We'll send updates on WhatsApp. For anything urgent, call {company.phone}.
                </span>
                <Button variant="text" onClick={() => setSent(null)}>
                  Report another problem
                </Button>
              </section>
            ) : (
              <form
                className="card card--pad stack"
                style={{ gap: 16 }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!isBackend) {
                    const t = createTicket({ leadId: lead.id, installationId: ins.id, description: text.trim(), channel: 'Link', photos });
                    setSent(t.number);
                    setText('');
                    setPhotos([]);
                    return;
                  }
                  setBusy(true);
                  setError('');
                  try {
                    const r = await callPublic<ReportResponse>({ action: 'report', token: token!, description: text.trim() });
                    for (const p of photos) {
                      await callPublic({ action: 'report-photo', token: token!, ticketId: r.ticketId, dataUrl: p.dataUrl, takenAt: p.takenAt, lat: p.gps?.lat, lng: p.gps?.lng });
                    }
                    setSent(r.number);
                    setText('');
                    setPhotos([]);
                    await refresh();
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <TextArea id="fault" label="What's happening?" value={text} onChange={setText} rows={4} placeholder="e.g. No power from the inverter since this morning" />
                <div className="stack" style={{ gap: 8 }}>
                  <span className="t-small muted">Photos (optional) · the inverter screen or any error helps</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                    {photos.map((p, i) => (
                      <PhotoThumb key={p.id} photo={p} label={`Photo ${i + 1}`} onRemove={() => setPhotos(photos.filter((x) => x.id !== p.id))} />
                    ))}
                    {photos.length < 3 && <PhotoInput kind="fault" label="Add photo" onPhoto={(p) => setPhotos([...photos, p])} />}
                  </div>
                </div>
                {isBackend && !token && <span className="t-small muted">Staff preview: customers report faults from the link sent to them.</span>}
                {error && (
                  <span role="alert" className="t-small danger">
                    {error}
                  </span>
                )}
                <Button type="submit" size="xl" disabled={!text.trim() || busy || (isBackend && !token)}>
                  {busy ? 'Sending…' : 'Send report'}
                </Button>
              </form>
            )}

            {tickets.length > 0 && (
              <section aria-labelledby="mine" className="stack" style={{ gap: 8 }}>
                <h2 id="mine" className="t-section" style={{ padding: '0 4px' }}>
                  Your reports
                </h2>
                {tickets.map((t) => (
                  <article key={t.id} className="card card--pad stack" style={{ gap: 12 }} aria-label={t.number}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="t-small muted" style={{ flexGrow: 1 }}>
                        {t.number} · {fmtDate(t.createdAt)}
                      </span>
                      <Badge tone={t.status === 'Open' ? 'amber' : t.status === 'Scheduled' ? 'blue' : 'green'}>{t.status === 'Open' ? 'Received' : t.status}</Badge>
                    </div>
                    <span className="t-body">{t.description}</span>
                    <ol className="stack" style={{ margin: 0, padding: 0, listStyle: 'none', gap: 8 }}>
                      {t.updates.map((u, i) => (
                        <li key={i} style={{ display: 'flex', gap: 12 }}>
                          <span className="dot" aria-hidden="true" style={{ marginTop: 6, background: i === t.updates.length - 1 ? 'var(--primary)' : 'var(--faint)' }} />
                          <span className="stack" style={{ gap: 2 }}>
                            <span style={{ fontSize: 14, lineHeight: '20px' }}>{u.text}</span>
                            <span className="t-small muted">{fmtDateTime(u.at)}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </article>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </PhoneScreen>
  );
}
