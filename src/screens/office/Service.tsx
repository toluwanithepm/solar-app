import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCan } from '../../components/Guards';
import { OfficeShell } from '../../components/OfficeShell';
import { PhotoThumb } from '../../components/PhotoInput';
import { Dialog, SelectField, TextArea, TextField } from '../../components/forms';
import { Badge, Button, EmptyState, PageHeader, Segmented } from '../../components/ui';
import { DAY, fmtDate, fmtDateTime, naira } from '../../data/domain';
import { addTicketUpdate, bookServiceVisit, createTicket, deletePlan, openServiceJob, savePlan, scheduleRepair } from '../../data/opsActions';
import { uid, useDb } from '../../data/store';
import type { MaintenancePlan, Ticket, TicketStatus } from '../../data/types';

type Tab = 'due' | 'plans' | 'tickets';

export function Service() {
  const db = useDb();
  const [params, setParams] = useSearchParams();
  const tab = (['due', 'plans', 'tickets'].includes(params.get('tab') ?? '') ? params.get('tab') : 'due') as Tab;
  const openTickets = db.tickets.filter((t) => t.status === 'Open').length;
  const dueCount = db.installations.filter((i) => new Date(i.nextServiceAt).getTime() - Date.now() <= 30 * DAY).length;

  return (
    <OfficeShell>
      <PageHeader title="Service and maintenance" subtitle="Reminders go to customers and the office 7 days before each visit" />
      <Segmented
        kind="tab"
        label="Service sections"
        value={tab}
        onChange={(t) => setParams(t === 'due' ? {} : { tab: t })}
        options={[
          { id: 'due', name: `Due for service · ${dueCount}` },
          { id: 'tickets', name: `Fault reports · ${openTickets} open` },
          { id: 'plans', name: 'Plans' },
        ]}
      />
      {tab === 'due' && <DueList />}
      {tab === 'plans' && <Plans />}
      {tab === 'tickets' && <Tickets />}
    </OfficeShell>
  );
}

function DueList() {
  const db = useDb();
  const navigate = useNavigate();
  const canSchedule = useCan('edit.schedule');
  const now = Date.now();
  const due = db.installations.filter((i) => new Date(i.nextServiceAt).getTime() - now <= 30 * DAY).sort((a, b) => a.nextServiceAt.localeCompare(b.nextServiceAt));

  return (
    <section className="card table-scroll" aria-label="Installations due for service in the next 30 days">
      {due.length === 0 ? (
        <EmptyState title="No services due in the next 30 days" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Due</th>
              <th scope="col">Reminder</th>
              <th scope="col">Plan</th>
              <th scope="col">Visit</th>
            </tr>
          </thead>
          <tbody>
            {due.map((i) => {
              const lead = db.leads.find((l) => l.id === i.leadId);
              const days = Math.ceil((new Date(i.nextServiceAt).getTime() - now) / DAY);
              const job = openServiceJob(db, i.id);
              return (
                <tr key={i.id}>
                  <td>
                    <Link to={`/office/installations/${i.id}`} style={{ color: 'var(--text)', fontWeight: 500 }}>
                      {lead?.name}
                    </Link>
                    <div className="t-small muted">{i.site}</div>
                  </td>
                  <td>
                    {fmtDate(i.nextServiceAt)}
                    <div className="t-small" style={{ color: days < 0 ? 'var(--danger)' : 'var(--muted)' }}>
                      {days < 0 ? `${-days} days overdue` : days === 0 ? 'Today' : `In ${days} days`}
                    </div>
                  </td>
                  <td className="muted">{i.lastServiceReminderAt ? `Sent ${fmtDate(i.lastServiceReminderAt)}` : days <= 7 ? 'Sending today' : `Goes out ${fmtDate(new Date(new Date(i.nextServiceAt).getTime() - 7 * DAY).toISOString())}`}</td>
                  <td className="muted">{db.plans.find((p) => p.id === i.planId)?.name ?? 'No plan'}</td>
                  <td>
                    {job ? (
                      <Link to={`/office/jobs/${job.id}`}>{job.start ? `Booked ${fmtDate(job.start)}` : 'Waiting on schedule'}</Link>
                    ) : canSchedule ? (
                      <Button
                        size="sm"
                        variant="tonal"
                        className="btn--compact"
                        onClick={() => {
                          bookServiceVisit(i.id);
                          navigate('/office/schedule');
                        }}
                      >
                        Book visit
                      </Button>
                    ) : (
                      <span className="muted">Not booked</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Plans() {
  const db = useDb();
  const canEdit = useCan('manage.settings');
  const [editing, setEditing] = useState<MaintenancePlan | null>(null);
  const now = Date.now();
  const renewals = db.installations.filter((i) => i.planRenewsAt && new Date(i.planRenewsAt).getTime() - now <= 30 * DAY).sort((a, b) => a.planRenewsAt!.localeCompare(b.planRenewsAt!));
  const withPlan = db.installations.filter((i) => i.planId).length;
  const share = db.installations.length ? Math.round((withPlan / db.installations.length) * 100) : 0;

  return (
    <div className="wrap">
      <section className="card stack" style={{ flex: '1 1 420px', padding: '20px 24px 8px' }} aria-labelledby="plans">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
          <h2 id="plans" className="t-section-lg" style={{ flexGrow: 1 }}>
            Maintenance plans
          </h2>
          {canEdit && (
            <Button size="sm" variant="tonal" className="btn--compact" onClick={() => setEditing({ id: uid('plan_'), name: '', price: 60_000, visitsPerYear: 2 })}>
              Add plan
            </Button>
          )}
        </div>
        <span className="t-small muted">
          {withPlan} of {db.installations.length} installations ({share}%) have a plan. Sell plans from an installation record or at handover.
        </span>
        {db.plans.map((p) => {
          const used = db.installations.filter((i) => i.planId === p.id).length;
          return (
            <div key={p.id} className="row" style={{ gap: 12 }}>
              <span className="row__main">
                <span>{p.name}</span>
                <span className="t-small muted">
                  {naira(p.price)} a year · {p.visitsPerYear} visits · {used} customer{used === 1 ? '' : 's'}
                </span>
              </span>
              {canEdit && (
                <Button size="sm" variant="text" onClick={() => setEditing(p)}>
                  Edit
                </Button>
              )}
            </div>
          );
        })}
      </section>

      <section className="card stack" style={{ flex: '1 1 420px', padding: '20px 24px 8px' }} aria-labelledby="renew">
        <h2 id="renew" className="t-section-lg" style={{ paddingBottom: 4 }}>
          Renewals in the next 30 days
        </h2>
        {renewals.length === 0 && <EmptyState title="No renewals due" />}
        {renewals.map((i) => (
          <Link key={i.id} to={`/office/installations/${i.id}`} className="row" style={{ gap: 12, color: 'var(--text)' }}>
            <span className="row__main">
              <span>{db.leads.find((l) => l.id === i.leadId)?.name}</span>
              <span className="t-small muted">
                {db.plans.find((p) => p.id === i.planId)?.name} · renews {fmtDate(i.planRenewsAt)}
              </span>
            </span>
            {i.lastRenewalReminderAt ? <Badge tone="green">Reminded</Badge> : <Badge tone="amber">Reminder pending</Badge>}
          </Link>
        ))}
      </section>

      {editing && <PlanDialog plan={editing} inUse={db.installations.some((i) => i.planId === editing.id)} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PlanDialog({ plan, inUse, onClose }: { plan: MaintenancePlan; inUse: boolean; onClose: () => void }) {
  const [name, setName] = useState(plan.name);
  const [price, setPrice] = useState(String(plan.price));
  const [visits, setVisits] = useState(String(plan.visitsPerYear));
  const valid = name.trim() && Number(price) > 0 && Number(visits) >= 1;
  return (
    <Dialog
      open
      onClose={onClose}
      title={plan.name ? 'Edit plan' : 'New plan'}
      actions={
        <>
          {plan.name && !inUse && (
            <Button
              variant="text"
              onClick={() => {
                deletePlan(plan.id);
                onClose();
              }}
            >
              Delete
            </Button>
          )}
          <Button
            disabled={!valid}
            onClick={() => {
              savePlan({ id: plan.id, name: name.trim(), price: Math.round(Number(price)), visitsPerYear: Math.round(Number(visits)) });
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <TextField id="pl-name" label="Name" value={name} onChange={setName} placeholder="e.g. Care plus" />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <TextField id="pl-price" label="Price a year (₦)" type="number" min={0} value={price} onChange={setPrice} style={{ flex: '1 1 160px' }} />
        <TextField id="pl-visits" label="Visits a year" type="number" min={1} value={visits} onChange={setVisits} style={{ flex: '1 1 120px' }} hint="Each visit is booked automatically when due" />
      </div>
      {inUse && <span className="t-small muted">Customers are on this plan, so it can't be deleted.</span>}
    </Dialog>
  );
}

function Tickets() {
  const db = useDb();
  const navigate = useNavigate();
  const canAct = useCan('edit.schedule');
  const [filter, setFilter] = useState<TicketStatus | 'All'>('Open');
  const [logging, setLogging] = useState(false);
  const [updating, setUpdating] = useState<Ticket | null>(null);
  const list = db.tickets.filter((t) => filter === 'All' || t.status === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <Segmented
          label="Ticket status"
          value={filter}
          onChange={setFilter}
          options={(['Open', 'Scheduled', 'Resolved', 'All'] as const).map((s) => ({ id: s, name: `${s} · ${s === 'All' ? db.tickets.length : db.tickets.filter((t) => t.status === s).length}` }))}
        />
        {canAct && (
          <Button variant="tonal" onClick={() => setLogging(true)}>
            Log a fault
          </Button>
        )}
      </div>
      {list.length === 0 && (
        <div className="card">
          <EmptyState title={`No ${filter === 'All' ? '' : filter.toLowerCase() + ' '}fault reports`} />
        </div>
      )}
      <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', alignItems: 'start' }}>
        {list.map((t) => {
          const lead = db.leads.find((l) => l.id === t.leadId);
          const job = db.jobs.find((j) => j.ticketId === t.id && j.status !== 'Cancelled');
          const ageH = Math.round((Date.now() - new Date(t.createdAt).getTime()) / 3_600_000);
          return (
            <article key={t.id} className="card stack" style={{ padding: 20, gap: 12 }} aria-label={`${t.number} from ${lead?.name}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="t-small muted" style={{ flexGrow: 1 }}>
                  {t.number} · via {t.channel} · {ageH < 48 ? `${ageH} h ago` : fmtDate(t.createdAt)}
                </span>
                <Badge tone={t.status === 'Open' ? 'red' : t.status === 'Scheduled' ? 'blue' : 'green'}>{t.status}</Badge>
              </div>
              <div className="stack" style={{ gap: 2 }}>
                <span className="t-section">{lead?.name}</span>
                <span className="t-body">{t.description}</span>
              </div>
              {t.photos.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
                  {t.photos.map((p) => (
                    <PhotoThumb key={p.id} photo={p} label="Fault photo" style={{ borderRadius: 10 }} />
                  ))}
                </div>
              )}
              <ol className="stack" style={{ margin: 0, padding: 0, listStyle: 'none', gap: 6, borderTop: '1px solid var(--divider)', paddingTop: 12 }}>
                {t.updates.map((u, i) => (
                  <li key={i} className="t-small" style={{ display: 'flex', gap: 8 }}>
                    <span className="muted" style={{ flexShrink: 0, width: 110 }}>
                      {fmtDateTime(u.at)}
                    </span>
                    <span>{u.text}</span>
                  </li>
                ))}
              </ol>
              {canAct && t.status !== 'Resolved' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {job ? (
                    <Button size="sm" variant="tonal" to={`/office/jobs/${job.id}`}>
                      {job.start ? `Repair ${fmtDate(job.start)}` : 'Repair job: assign'}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        scheduleRepair(t.id);
                        navigate('/office/schedule');
                      }}
                    >
                      Schedule repair
                    </Button>
                  )}
                  <Button size="sm" variant="text" onClick={() => setUpdating(t)}>
                    Send update
                  </Button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {logging && <LogFaultDialog onClose={() => setLogging(false)} />}
      {updating && <UpdateDialog ticket={updating} onClose={() => setUpdating(null)} />}
    </>
  );
}

function LogFaultDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const options = db.installations.map((i) => ({ value: i.id, label: `${db.leads.find((l) => l.id === i.leadId)?.name} · ${i.site}` })).sort((a, b) => a.label.localeCompare(b.label));
  const [insId, setInsId] = useState(options[0]?.value ?? '');
  const [channel, setChannel] = useState<Ticket['channel']>('Call');
  const [text, setText] = useState('');
  const ins = db.installations.find((i) => i.id === insId);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Log a fault"
      actions={
        <Button
          disabled={!ins || !text.trim()}
          onClick={() => {
            createTicket({ leadId: ins!.leadId, installationId: ins!.id, description: text.trim(), channel });
            onClose();
          }}
        >
          Create ticket
        </Button>
      }
    >
      <SelectField id="lf-ins" label="Customer system" value={insId} onChange={setInsId} options={options} />
      <SelectField id="lf-ch" label="Reported by" value={channel} onChange={setChannel} options={['Call', 'WhatsApp', 'Link'] as const} />
      <TextArea id="lf-text" label="What's wrong?" value={text} onChange={setText} placeholder="e.g. Inverter beeps and shuts off at night" />
      <span className="t-small muted">The customer gets a WhatsApp confirmation with the ticket number.</span>
    </Dialog>
  );
}

function UpdateDialog({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Update ${ticket.number}`}
      actions={
        <Button
          disabled={!text.trim()}
          onClick={() => {
            addTicketUpdate(ticket.id, text.trim(), status);
            onClose();
          }}
        >
          Send to customer
        </Button>
      }
    >
      <TextArea id="up-text" label="Message" value={text} onChange={setText} placeholder="e.g. Technician arrives tomorrow at 10:00" />
      <SelectField id="up-status" label="Status" value={status} onChange={setStatus} options={['Open', 'Scheduled', 'Resolved'] as const} />
    </Dialog>
  );
}
