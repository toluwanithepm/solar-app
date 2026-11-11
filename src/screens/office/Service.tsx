import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import '../../styles/office-ops.css';
import { useCan } from '../../components/Guards';
import { Icon } from '../../components/Icon';
import { aftercareTabs, OfficeShell, SubNav } from '../../components/OfficeShell';
import { PhotoThumb } from '../../components/PhotoInput';
import { Dialog, MoneyField, SelectField, TextArea, TextField } from '../../components/forms';
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
      <PageHeader title="Aftercare" subtitle="Service visits, fault reports and maintenance plans. Reminders go out 7 days before each visit." />
      <SubNav items={aftercareTabs} />
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
    <section className="card" aria-label="Installations due for service in the next 30 days">
      {due.length === 0 ? (
        <EmptyState title="No services due in the next 30 days">Installations show up here a month before their next visit.</EmptyState>
      ) : (
        <div className="table-scroll">
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
                    <Link to={`/office/installations/${i.id}`} className="cell-link">
                      {lead?.name}
                    </Link>
                    <div className="t-small muted">{i.site}</div>
                  </td>
                  <td>
                    <div style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.nextServiceAt)}</div>
                    {days < 0 ? (
                      <Badge tone="red">{-days} days overdue</Badge>
                    ) : days <= 7 ? (
                      <Badge tone="amber">{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}</Badge>
                    ) : (
                      <div className="t-caption faint">In {days} days</div>
                    )}
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
        </div>
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
      <section className="card" style={{ flex: '1 1 420px' }} aria-labelledby="plans">
        <div className="card__head">
          <h2 id="plans" className="t-section">
            Maintenance plans
          </h2>
          {canEdit && (
            <Button size="sm" variant="tonal" className="btn--compact" onClick={() => setEditing({ id: uid('plan_'), name: '', price: 60_000, visitsPerYear: 2 })}>
              Add plan
            </Button>
          )}
        </div>
        <p className="t-small muted ops-card__note" style={{ margin: 0 }}>
          {withPlan} of {db.installations.length} installations ({share}%) have a plan. Sell plans from an installation record or at handover.
        </p>
        <div className="ops-card__body">
          {db.plans.length === 0 && <EmptyState title="No plans yet">Add a plan to sell yearly maintenance.</EmptyState>}
          {db.plans.map((p) => {
            const used = db.installations.filter((i) => i.planId === p.id).length;
            return (
              <div key={p.id} className="row" style={{ gap: 12 }}>
                <span className="row__main">
                  <span className="strong">{p.name}</span>
                  <span className="t-small muted">
                    {p.visitsPerYear} visits a year · {used} customer{used === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="num">
                  <span className="strong">{naira(p.price)}</span>
                  <span className="t-caption faint"> / year</span>
                </span>
                {canEdit && (
                  <Button size="sm" variant="text" onClick={() => setEditing(p)} ariaLabel={`Edit ${p.name}`}>
                    Edit
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card" style={{ flex: '1 1 420px' }} aria-labelledby="renew">
        <div className="card__head">
          <h2 id="renew" className="t-section">
            Renewals in the next 30 days
          </h2>
        </div>
        <div className="ops-card__body">
        {renewals.length === 0 && <EmptyState title="No renewals due">Plans renewing within 30 days appear here.</EmptyState>}
        {renewals.map((i) => (
          <Link key={i.id} to={`/office/installations/${i.id}`} className="row" style={{ gap: 12 }}>
            <span className="row__main">
              <span>{db.leads.find((l) => l.id === i.leadId)?.name}</span>
              <span className="t-small muted">
                {db.plans.find((p) => p.id === i.planId)?.name} · renews {fmtDate(i.planRenewsAt)}
              </span>
            </span>
            {i.lastRenewalReminderAt ? <Badge tone="green">Reminded</Badge> : <Badge tone="amber">Reminder pending</Badge>}
          </Link>
        ))}
        </div>
      </section>

      {editing && <PlanDialog plan={editing} inUse={db.installations.some((i) => i.planId === editing.id)} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PlanDialog({ plan, inUse, onClose }: { plan: MaintenancePlan; inUse: boolean; onClose: () => void }) {
  const [name, setName] = useState(plan.name);
  const [price, setPrice] = useState<number>(plan.price);
  const [visits, setVisits] = useState(String(plan.visitsPerYear));
  const valid = name.trim() && price > 0 && Number(visits) >= 1;
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
              savePlan({ id: plan.id, name: name.trim(), price: Math.round(price), visitsPerYear: Math.round(Number(visits)) });
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
        <MoneyField id="pl-price" label="Price a year" value={price} onChange={setPrice} required style={{ flex: '1 1 160px' }} />
        <TextField id="pl-visits" label="Visits a year" type="number" inputMode="numeric" min={1} value={visits} onChange={setVisits} style={{ flex: '1 1 120px' }} hint="Each visit is booked automatically when due" />
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
      <div className="ops-filters">
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
          <EmptyState title={`No ${filter === 'All' ? '' : filter.toLowerCase() + ' '}fault reports`}>{filter === 'Open' ? 'Customers report faults from their link, or log one from a call.' : undefined}</EmptyState>
        </div>
      )}
      <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', alignItems: 'start' }}>
        {list.map((t) => {
          const lead = db.leads.find((l) => l.id === t.leadId);
          const job = db.jobs.find((j) => j.ticketId === t.id && j.status !== 'Cancelled');
          const ageH = Math.round((Date.now() - new Date(t.createdAt).getTime()) / 3_600_000);
          // Age emphasis: an open fault waiting a day is a warning, two days is stale
          const open = t.status === 'Open';
          const ageCls = open && ageH >= 48 ? ' ticket__age--stale' : open && ageH >= 24 ? ' ticket__age--warn' : '';
          return (
            <article key={t.id} className={`card ticket${open && ageH >= 48 ? ' ticket--stale' : ''}`} aria-label={`${t.number} from ${lead?.name}`}>
              <div className="ticket__head">
                <span className="t-small mono">{t.number}</span>
                <span className="t-caption faint" style={{ flexGrow: 1 }}>
                  via {t.channel}
                </span>
                <Badge tone={t.status === 'Open' ? 'red' : t.status === 'Scheduled' ? 'blue' : 'green'}>{t.status}</Badge>
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <span className="t-section">{lead?.name}</span>
                <span className="t-body">{t.description}</span>
                <span className={`ticket__age${ageCls}${ageCls ? '' : ' faint'}`}>
                  <Icon name="clock" size={13} />
                  {ageH < 48 ? `Reported ${ageH} h ago` : `Reported ${fmtDate(t.createdAt)} · ${Math.floor(ageH / 24)} days`}
                </span>
              </div>
              {t.photos.length > 0 && (
                <div className="ticket__photos">
                  {t.photos.map((p) => (
                    <PhotoThumb key={p.id} photo={p} label="Fault photo" style={{ borderRadius: 'var(--radius)' }} />
                  ))}
                </div>
              )}
              <ol className="ticket__log" aria-label="Updates">
                {t.updates.map((u, i) => (
                  <li key={i} className="t-small">
                    <time dateTime={u.at}>{fmtDateTime(u.at)}</time>
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
