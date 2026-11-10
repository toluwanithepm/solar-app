import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCan } from '../../components/Guards';
import { OfficeShell } from '../../components/OfficeShell';
import { PhotoThumb } from '../../components/PhotoInput';
import { SelectField } from '../../components/forms';
import { Badge, Button, EmptyState, PageHeader } from '../../components/ui';
import { DAY, categoryLabel, fmtDate, naira, whatsappLink } from '../../data/domain';
import { useShareLink } from '../../data/remote/shareLinks';
import { bookServiceVisit, openServiceJob, sellPlan } from '../../data/opsActions';
import { useDb } from '../../data/store';

export function InstallationDetail() {
  const { installationId } = useParams();
  const db = useDb();
  const navigate = useNavigate();
  const canSchedule = useCan('edit.schedule');
  const canSell = useCan('record.payments');
  const [planId, setPlanId] = useState(db.plans[0]?.id ?? '');
  const [copied, setCopied] = useState(false);
  const reportLink = useShareLink('fault_report', installationId);
  const ins = db.installations.find((i) => i.id === installationId);
  if (!ins) {
    return (
      <OfficeShell>
        <PageHeader title="Installation not found" back={{ to: '/office/installations', label: 'Register' }} />
      </OfficeShell>
    );
  }
  const lead = db.leads.find((l) => l.id === ins.leadId)!;
  const plan = db.plans.find((p) => p.id === ins.planId);
  const jobs = db.jobs.filter((j) => j.installationId === ins.id || j.id === ins.jobId).sort((a, b) => (b.completedAt ?? b.start ?? b.updatedAt).localeCompare(a.completedAt ?? a.start ?? a.updatedAt));
  const tickets = db.tickets.filter((t) => t.installationId === ins.id);
  const installJob = db.jobs.find((j) => j.id === ins.jobId);
  const photos = installJob?.photos ?? [];
  const openVisit = openServiceJob(db, ins.id);
  const now = Date.now();

  return (
    <OfficeShell>
      <PageHeader
        back={{ to: '/office/installations', label: 'Register' }}
        title={lead.name}
        subtitle={`${ins.site} · installed ${fmtDate(ins.installedAt)} by ${ins.technicianIds.map((id) => db.users.find((u) => u.id === id)?.name).join(', ')}`}
        actions={
          canSchedule && (
            <Button
              onClick={() => {
                bookServiceVisit(ins.id);
                navigate('/office/schedule');
              }}
            >
              {openVisit ? 'View service visit' : 'Book service visit'}
            </Button>
          )
        }
      />

      <div className="wrap">
        <section className="card table-scroll" style={{ flex: '2 1 560px', minWidth: 0 }} aria-labelledby="eq">
          <h2 id="eq" className="t-section-lg" style={{ padding: '20px 24px 8px' }}>
            Equipment · {ins.items.length} items
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Serial</th>
                <th scope="col">Warranty</th>
                <th scope="col">Ends</th>
              </tr>
            </thead>
            <tbody>
              {ins.items.map((it) => {
                const days = (new Date(it.warrantyEndsAt).getTime() - now) / DAY;
                return (
                  <tr key={it.id}>
                    <td>
                      {it.label}
                      <div className="t-small muted">{categoryLabel[it.category]}</div>
                    </td>
                    <td style={{ fontFamily: 'ui-monospace, monospace' }}>{it.serial ?? '—'}</td>
                    <td className="muted">{it.warrantyYears} years</td>
                    <td>{days < 0 ? <Badge tone="neutral">Expired</Badge> : days <= 90 ? <Badge tone="amber">{fmtDate(it.warrantyEndsAt)}</Badge> : fmtDate(it.warrantyEndsAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <aside className="stack" style={{ flex: '1 1 300px', minWidth: 0, gap: 16 }}>
          <Panel title="Maintenance">
            <Line k="Next service" v={fmtDate(ins.nextServiceAt)} />
            <Line k="Interval" v={`Every ${ins.serviceIntervalMonths} months`} />
            <Line k="Last reminder" v={ins.lastServiceReminderAt ? fmtDate(ins.lastServiceReminderAt) : 'Not yet'} />
            <Line k="Plan" v={plan ? `${plan.name} · ${ins.planVisitsLeft ?? 0} visits left` : 'None'} />
            {plan && <Line k="Renews" v={fmtDate(ins.planRenewsAt)} />}
            {canSell && (
              <div className="stack" style={{ gap: 8, paddingTop: 12 }}>
                <SelectField id="plan" label={plan ? 'Change plan' : 'Sell a plan'} value={planId} onChange={setPlanId} options={db.plans.map((p) => ({ value: p.id, label: `${p.name} · ${naira(p.price)} · ${p.visitsPerYear} visits` }))} />
                <Button variant="tonal" disabled={!planId} onClick={() => sellPlan(ins.id, planId)}>
                  {plan ? 'Renew or switch plan' : 'Sell plan and send invoice'}
                </Button>
              </div>
            )}
          </Panel>

          <Panel title="Fault-report link">
            <p className="t-small muted" style={{ margin: '4px 0 12px' }}>
              The customer opens this to report a fault with photos.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingBottom: 12 }}>
              <Button
                variant="tonal"
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(reportLink);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button variant="tonal" size="sm" href={whatsappLink(lead.phone, `If your solar system has a problem, report it here: ${reportLink}`)}>
                Send on WhatsApp
              </Button>
            </div>
          </Panel>
        </aside>
      </div>

      <div className="wrap">
        <Panel title={`Service history · ${jobs.length}`} style={{ flex: '1 1 420px' }}>
          {jobs.length === 0 && <EmptyState title="No visits yet" />}
          {jobs.map((j) => (
            <Link key={j.id} to={`/office/jobs/${j.id}`} className="row" style={{ gap: 12, color: 'var(--text)' }}>
              <span className="row__main">
                <span>{j.type}</span>
                <span className="t-small muted">
                  {j.number} · {j.completedAt ? `done ${fmtDate(j.completedAt)}` : j.start ? `scheduled ${fmtDate(j.start)}` : 'not scheduled'}
                </span>
              </span>
              <Badge tone={j.status === 'Done' ? 'green' : j.status === 'Unscheduled' ? 'amber' : 'blue'}>{j.status}</Badge>
            </Link>
          ))}
        </Panel>
        <Panel title={`Fault reports · ${tickets.length}`} style={{ flex: '1 1 420px' }}>
          {tickets.length === 0 && <EmptyState title="No faults reported" />}
          {tickets.map((t) => (
            <Link key={t.id} to="/office/service?tab=tickets" className="row" style={{ gap: 12, color: 'var(--text)' }}>
              <span className="row__main">
                <span>{t.description}</span>
                <span className="t-small muted">
                  {t.number} · {fmtDate(t.createdAt)}
                </span>
              </span>
              <Badge tone={t.status === 'Resolved' ? 'green' : t.status === 'Open' ? 'red' : 'blue'}>{t.status}</Badge>
            </Link>
          ))}
        </Panel>
      </div>

      <Panel title={`Installation photos · ${photos.length}`}>
        {photos.length === 0 ? (
          <EmptyState title="No photos on record" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, padding: '12px 0 16px' }}>
            {photos.map((p) => (
              <PhotoThumb key={p.id} photo={p} label={`${p.kind} photo, ${fmtDate(p.takenAt)}`} />
            ))}
          </div>
        )}
      </Panel>
    </OfficeShell>
  );
}

function Panel({ title, children, style }: { title: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <section className="card stack" style={{ padding: '20px 24px 8px', minWidth: 0, ...style }} aria-label={title}>
      <h2 className="t-section-lg" style={{ paddingBottom: 4 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Line({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="row row--between" style={{ fontSize: 14, lineHeight: '20px', gap: 12 }}>
      <span className="muted">{k}</span>
      <span style={{ textAlign: 'right' }}>{v}</span>
    </div>
  );
}
