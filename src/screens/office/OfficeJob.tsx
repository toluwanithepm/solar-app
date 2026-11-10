import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IfCan, useCan } from '../../components/Guards';
import { Icon } from '../../components/Icon';
import { OfficeShell } from '../../components/OfficeShell';
import { PhotoThumb } from '../../components/PhotoInput';
import { Badge, Button, EmptyState, PageHeader, StatusDot } from '../../components/ui';
import { fmtDate, fmtDateTime, fmtTime, mapsLink, naira } from '../../data/domain';
import { invoiceExtras, lateByLabel, liveStatus, liveStatusColor } from '../../data/opsActions';
import { resolveSyncConflict } from '../../data/settingsActions';
import { useShareLink } from '../../data/remote/shareLinks';
import { useDb } from '../../data/store';
import type { Invoice } from '../../data/types';
import { formatGps } from '../../lib/photos';

export function OfficeJob() {
  const { jobId } = useParams();
  const db = useDb();
  const canEdit = useCan('edit.schedule');
  const job = db.jobs.find((j) => j.id === jobId);
  if (!job) {
    return (
      <OfficeShell>
        <PageHeader title="Job not found" back={{ to: '/office/schedule', label: 'Schedule' }} />
      </OfficeShell>
    );
  }
  const lead = db.leads.find((l) => l.id === job.leadId);
  const st = liveStatus(job);
  const user = (id: string) => db.users.find((u) => u.id === id)?.name ?? 'Unknown';
  const invoices = db.invoices.filter((i) => i.jobId === job.id);
  const uninvoiced = job.extras.filter((x) => !x.invoiceId);
  const priceOf = (itemId?: string) => db.priceItems.find((p) => p.id === itemId)?.price ?? 0;
  const done = job.checklist.filter((s) => s.done).length;
  const timeOnSite = job.checkIn && job.checkOut ? Math.round((new Date(job.checkOut.at).getTime() - new Date(job.checkIn.at).getTime()) / 60_000) : null;

  return (
    <OfficeShell>
      <PageHeader
        back={{ to: '/office/schedule', label: 'Schedule' }}
        title={`${lead?.name} · ${job.type}`}
        subtitle={
          <>
            {job.number} · {job.address}
          </>
        }
        actions={
          <>
            <Button variant="tonal" href={mapsLink(job.address, job.gps)}>
              Map
            </Button>
            {job.status === 'Done' && <Button variant="tonal" to={`/handover/${job.id}`}>Handover report</Button>}
            {canEdit && job.status !== 'Done' && <Button to="/office/schedule">{job.start ? 'Reschedule' : 'Assign'}</Button>}
          </>
        }
      />

      {job.syncConflict && (
        <div role="alert" className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '14px 20px', borderRadius: 16 }}>
          <Icon name="warning" size={20} color="var(--danger)" />
          <span style={{ flex: '1 1 300px', fontSize: 14, lineHeight: '20px' }}>{job.syncConflict}</span>
          {canEdit && (
            <Button
              variant="tonal"
              size="sm"
              className="btn--compact"
              onClick={() => resolveSyncConflict(job.id)}
            >
              Mark resolved
            </Button>
          )}
        </div>
      )}

      <div className="wrap">
        <div className="stack" style={{ flex: '2 1 520px', minWidth: 0, gap: 16 }}>
          <Card title="Field record">
            <Rows
              rows={[
                ['Status', <StatusDot color={liveStatusColor[st]}>{st === 'Late' ? lateByLabel(job) : st}{job.pendingSync ? ' · waiting to sync' : ''}</StatusDot>],
                ['Scheduled', job.start ? `${fmtDateTime(job.start)} · ${job.durationHours} h` : 'Not scheduled'],
                ['Team', job.assigneeIds.map(user).join(', ') || 'Unassigned'],
                ['Check-in', job.checkIn ? `${fmtTime(job.checkIn.at)} · ${formatGps(job.checkIn.gps)}` : '—'],
                ['Check-out', job.checkOut ? `${fmtTime(job.checkOut.at)} · ${formatGps(job.checkOut.gps)}` : '—'],
                ['Time on site', timeOnSite !== null ? `${Math.floor(timeOnSite / 60)} h ${timeOnSite % 60} min` : '—'],
              ]}
            />
          </Card>

          <Card title={`Checklist · ${done} of ${job.checklist.length}`}>
            {job.checklist.map((s) => (
              <div key={s.id} className="row" style={{ gap: 12 }}>
                <Icon name={s.done ? 'checkCircle' : 'circle'} color={s.done ? 'var(--primary)' : 'var(--faint)'} />
                <span className="row__main">
                  <span>{s.label}</span>
                  <span className="t-small muted">{s.required ? 'Required' : 'Optional'}</span>
                </span>
              </div>
            ))}
          </Card>

          <Card title={`Serial numbers · ${job.serials.length}`}>
            {job.serials.length === 0 && <EmptyState title="No serials scanned yet" />}
            {job.serials.map((s) => (
              <div key={s.id} className="row row--between">
                <span className="row__main">
                  <span>{s.label}</span>
                  <span className="t-small muted">{s.method === 'scan' ? 'Scanned' : 'Typed in'} · {s.warrantyYears}-year warranty</span>
                </span>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14 }}>{s.serial}</span>
              </div>
            ))}
          </Card>

          <Card title={`Photos · ${job.photos.length}`}>
            {job.photos.length === 0 ? (
              <EmptyState title="No photos yet" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, padding: '12px 0' }}>
                {job.photos.map((p) => (
                  <figure key={p.id} style={{ margin: 0 }} className="stack">
                    <PhotoThumb photo={p} label={`${p.kind} photo`} />
                    <figcaption className="t-small muted" style={{ paddingTop: 4 }}>
                      {p.kind[0].toUpperCase() + p.kind.slice(1)} · {fmtTime(p.takenAt)} · {Math.round(p.bytes / 1024)} KB
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </Card>
        </div>

        <aside className="stack" style={{ flex: '1 1 300px', minWidth: 0, gap: 16 }}>
          <Card title="Customer">
            <Rows
              rows={[
                ['Name', lead ? <Link to={`/office/leads/${lead.id}`}>{lead.name}</Link> : '—'],
                ['Phone', lead?.phone ?? '—'],
                ['Installation', job.installationId ? <Link to={`/office/installations/${job.installationId}`}>View record</Link> : '—'],
              ]}
            />
          </Card>

          <Card title="Customer sign-off">
            {job.signature ? (
              <div className="stack" style={{ gap: 8, padding: '12px 0' }}>
                {job.signature.dataUrl && <img src={job.signature.dataUrl} alt={`Signature of ${job.signature.name}`} style={{ width: '100%', maxHeight: 120, objectFit: 'contain', background: 'var(--bg)', borderRadius: 12 }} />}
                <span className="t-small muted">
                  {job.signature.name} · {fmtDateTime(job.signature.at)}
                </span>
              </div>
            ) : (
              <EmptyState title="Not signed yet" />
            )}
          </Card>

          <Card
            title="Extra materials"
            action={
              uninvoiced.length > 0 && (
                <IfCan perm="record.payments">
                  <Button size="sm" variant="tonal" className="btn--compact" onClick={() => invoiceExtras(job.id)}>
                    Create invoice
                  </Button>
                </IfCan>
              )
            }
          >
            {job.extras.length === 0 && <EmptyState title="None logged" />}
            {job.extras.map((x) => (
              <div key={x.id} className="row" style={{ gap: 12 }}>
                <span className="row__main">
                  <span>
                    {x.qty} × {x.description}
                  </span>
                  <span className="t-small muted">{naira(x.qty * priceOf(x.itemId))}</span>
                </span>
                {x.invoiceId ? <Badge tone="green">Invoiced</Badge> : <Badge tone="amber">To invoice</Badge>}
              </div>
            ))}
          </Card>

          <Card title="Invoices">
            {invoices.length === 0 && <EmptyState title="No invoices" />}
            {invoices.map((i) => (
              <InvoiceLinkRow key={i.id} inv={i} />
            ))}
          </Card>
        </aside>
      </div>
    </OfficeShell>
  );
}

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card stack" style={{ padding: '20px 24px 8px' }} aria-label={title}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
        <h2 className="t-section-lg" style={{ flexGrow: 1 }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <>
      {rows.map(([k, v]) => (
        <div key={k} className="row row--between" style={{ fontSize: 14, lineHeight: '20px', gap: 12 }}>
          <span className="muted">{k}</span>
          <span style={{ textAlign: 'right' }}>{v}</span>
        </div>
      ))}
    </>
  );
}

/** An invoice opening its customer payment page (a token link in backend mode). */
function InvoiceLinkRow({ inv }: { inv: Invoice }) {
  const link = useShareLink('invoice', inv.id);
  return (
    <a href={link || undefined} target="_blank" rel="noreferrer" className="row row--between" style={{ color: 'var(--text)' }}>
      <span className="row__main">
        <span>{inv.description}</span>
        <span className="t-small muted">
          {inv.number} · due {fmtDate(inv.dueAt)}
        </span>
      </span>
      <span>{naira(inv.amount)}</span>
    </a>
  );
}
