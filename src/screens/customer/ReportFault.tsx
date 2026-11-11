import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { PhoneScreen } from '../../components/PhoneScreen';
import { PhotoInput, PhotoThumb } from '../../components/PhotoInput';
import { usePublicRefresh, usePublicTarget, usePublicToken } from '../../components/PublicPage';
import { TextArea } from '../../components/forms';
import { Badge, Button, EmptyState } from '../../components/ui';
import { BrandHeader } from './CustomerQuote';
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
      <BrandHeader company={company} />

      <main className="c-main">
        {!ins || !lead ? (
          <div className="card">
            <EmptyState title="This link is not valid">Please contact {company.name} on {company.phone}.</EmptyState>
          </div>
        ) : (
          <>
            <div className="p-intro">
              <span className="t-small muted">
                {lead.name} · installed {fmtDate(ins.installedAt)}
              </span>
              <h1 className="t-display">Report a problem</h1>
            </div>

            {sent ? (
              <section className="c-ok" role="status">
                <span className="t-title c-ok__title">
                  <Icon name="checkCircle" size={24} />
                  We've got it
                </span>
                <span className="t-body">
                  Your ticket number is <strong>{sent}</strong>. We'll send updates on WhatsApp. For anything urgent, call {company.phone}.
                </span>
                <Button variant="tonal" size="lg" onClick={() => setSent(null)}>
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
                  <span className="t-small">
                    <span className="strong">Photos (optional)</span>
                    <span className="muted"> · the inverter screen or any error helps</span>
                  </span>
                  <div className="p-grid-3">
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
              <section aria-labelledby="mine" className="p-section">
                <h2 id="mine" className="t-section-lg p-section__head">
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
                    <ol className="timeline">
                      {t.updates.map((u, i) => (
                        <li key={i}>
                          <span className="dot" aria-hidden="true" />
                          <span className="stack" style={{ gap: 2 }}>
                            <span className="t-small">{u.text}</span>
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
