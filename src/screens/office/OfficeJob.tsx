import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import '../../styles/office-ops.css';
import { IfCan, useCan } from '../../components/Guards';
import { Icon } from '../../components/Icon';
import { OfficeShell } from '../../components/OfficeShell';
import { PhotoThumb } from '../../components/PhotoInput';
import { Badge, Button, EmptyState, PageHeader, type Tone } from '../../components/ui';
import { fmtDate, fmtDateTime, fmtTime, mapsLink, naira } from '../../data/domain';
import { invoiceExtras, lateByLabel, liveStatus, type LiveStatus } from '../../data/opsActions';
import { resolveSyncConflict } from '../../data/settingsActions';
import { useShareLink } from '../../data/remote/shareLinks';
import { useDb } from '../../data/store';
import type { Invoice } from '../../data/types';
import { formatGps } from '../../lib/photos';

const statusTone: Record<LiveStatus, Tone> = {
  Unscheduled: 'amber',
  Scheduled: 'blue',
  'On site': 'blue',
  Late: 'red',
  Done: 'green',
  Cancelled: 'neutral',
};

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
        <div role="alert" className="notice notice--danger ops-alert">
          <Icon name="warning" size={18} />
          <span className="ops-alert__text">{job.syncConflict}</span>
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
                [
                  'Status',
                  <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Badge tone={statusTone[st]}>{st === 'Late' ? lateByLabel(job) : st}</Badge>
                    {job.pendingSync && (
                      <Badge tone="amber" icon="sync">
                        Waiting to sync
                      </Badge>
                    )}
                  </span>,
                ],
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
                <Icon name={s.done ? 'checkCircle' : 'circle'} size={18} color={s.done ? 'var(--success)' : 'var(--faint)'} />
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
                <span className="mono">{s.serial}</span>
              </div>
            ))}
          </Card>

          <Card title={`Photos · ${job.photos.length}`}>
            {job.photos.length === 0 ? (
              <EmptyState title="No photos yet" />
            ) : (
              <div className="photo-grid" style={{ padding: '16px 0' }}>
                {job.photos.map((p) => (
                  <figure key={p.id} style={{ margin: 0 }} className="stack">
                    <PhotoThumb photo={p} label={`${p.kind} photo`} />
                    <figcaption className="t-caption faint" style={{ paddingTop: 4 }}>
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
              <div className="stack" style={{ gap: 8, padding: '16px 0' }}>
                {job.signature.dataUrl && <img src={job.signature.dataUrl} alt={`Signature of ${job.signature.name}`} style={{ width: '100%', maxHeight: 120, objectFit: 'contain', background: 'var(--surface-2)', border: '1px solid var(--divider)', borderRadius: 'var(--radius)' }} />}
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
                </span>
                <span className="num">{naira(x.qty * priceOf(x.itemId))}</span>
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
    <section className="card" aria-label={title}>
      <div className="card__head">
        <h2 className="t-section">{title}</h2>
        {action}
      </div>
      <div className="ops-card__body">{children}</div>
    </section>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <>
      {rows.map(([k, v]) => (
        <div key={k} className="kv">
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </>
  );
}

/** An invoice opening its customer payment page (a token link in backend mode). */
function InvoiceLinkRow({ inv }: { inv: Invoice }) {
  const link = useShareLink('invoice', inv.id);
  return (
    <a href={link || undefined} target="_blank" rel="noreferrer" className="row row--between">
      <span className="row__main">
        <span>{inv.description}</span>
        <span className="t-small muted">
          {inv.number} · due {fmtDate(inv.dueAt)}
        </span>
      </span>
      <span className="num strong">{naira(inv.amount)}</span>
    </a>
  );
}
