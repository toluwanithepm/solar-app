import { Link, useNavigate } from 'react-router-dom';
import { IfCan } from '../../components/Guards';
import { Icon } from '../../components/Icon';
import { OfficeShell } from '../../components/OfficeShell';
import { Badge, Button, EmptyState, PageHeader, type Tone } from '../../components/ui';
import { DAY, can, fmtDay, fmtTime, invoiceBalance, isSameDay, nairaShort, optionCost, optionTotal, selectedOption } from '../../data/domain';
import { findConflicts, lateByLabel, liveStatus, startOfDay, type LiveStatus } from '../../data/opsActions';
import { useCurrentUser, useDb } from '../../data/store';
import type { DB } from '../../data/types';
import '../../styles/office-sales.css';

const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);

function kpis(db: DB, now = new Date()) {
  const thisMonth = monthStart(now);
  const lastMonth = monthStart(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const confirmed = db.payments.filter((p) => p.status === 'Confirmed');
  const collected = confirmed.filter((p) => new Date(p.at) >= thisMonth).reduce((s, p) => s + p.amount, 0);
  const lastCollected = confirmed.filter((p) => new Date(p.at) >= lastMonth && new Date(p.at) < thisMonth).reduce((s, p) => s + p.amount, 0);
  const owedInvoices = db.invoices.filter((i) => invoiceBalance(db, i) > 0);
  const owed = owedInvoices.reduce((s, i) => s + invoiceBalance(db, i), 0);
  const overdue14 = owedInvoices.filter((i) => now.getTime() - new Date(i.dueAt).getTime() > 14 * DAY).length;
  const done = db.jobs.filter((j) => j.status === 'Done' && j.completedAt && new Date(j.completedAt) >= thisMonth).length;
  const weekEnd = startOfDay(now).getTime() + 7 * DAY;
  const upcoming = db.jobs.filter((j) => j.status === 'Scheduled' && j.start && new Date(j.start).getTime() < weekEnd && new Date(j.start) >= startOfDay(now)).length;
  const decided = db.quotes.filter((q) => q.status !== 'Draft' && q.sentAt && now.getTime() - new Date(q.sentAt).getTime() < 90 * DAY);
  const won = decided.filter((q) => q.status === 'Accepted').length;
  const winRate = decided.length ? Math.round((won / decided.length) * 100) : 0;
  const open = db.quotes.filter((q) => q.status === 'Sent').length;
  const accepted = db.quotes.filter((q) => q.status === 'Accepted' && q.acceptedAt && new Date(q.acceptedAt) >= thisMonth).map(selectedOption);
  const sales = accepted.reduce((s, o) => s + optionTotal(o), 0);
  const margin = sales ? ((sales - accepted.reduce((s, o) => s + optionCost(o), 0)) / sales) * 100 : 0;
  const change = lastCollected ? Math.round(((collected - lastCollected) / lastCollected) * 100) : null;
  return { collected, change, owed, overdue14, done, upcoming, winRate, open, sales, margin };
}

function attention(db: DB, now = new Date()) {
  const items: { count: number; title: string; note: string; to: string; urgent?: boolean }[] = [];
  const followUp = db.quotes.filter((q) => {
    if (q.status !== 'Sent') return false;
    const last = new Date(q.lastFollowUpAt ?? q.sentAt ?? q.createdAt).getTime();
    return now.getTime() - last >= db.company.followUpDays * DAY;
  });
  if (followUp.length) items.push({ count: followUp.length, title: `quote${followUp.length > 1 ? 's' : ''} to follow up`, note: `Sent over ${db.company.followUpDays} days ago`, to: '/office/quotes' });

  const serviceDue = db.installations.filter((i) => {
    const days = (new Date(i.nextServiceAt).getTime() - now.getTime()) / DAY;
    return days <= 7 && !db.jobs.some((j) => j.installationId === i.id && j.type === 'Maintenance' && j.status !== 'Done' && j.status !== 'Cancelled');
  });
  if (serviceDue.length) items.push({ count: serviceDue.length, title: `maintenance visit${serviceDue.length > 1 ? 's' : ''} to book`, note: 'Due in the next 7 days', to: '/office/service' });

  const open = db.tickets.filter((t) => t.status === 'Open');
  if (open.length) {
    const oldest = Math.max(...open.map((t) => now.getTime() - new Date(t.createdAt).getTime()));
    items.push({ count: open.length, title: `open fault report${open.length > 1 ? 's' : ''}`, note: `Oldest is ${Math.round(oldest / 3_600_000)} hours old`, to: '/office/service?tab=tickets', urgent: true });
  }

  const unscheduled = db.jobs.filter((j) => j.status === 'Unscheduled');
  if (unscheduled.length) items.push({ count: unscheduled.length, title: `job${unscheduled.length > 1 ? 's' : ''} to schedule`, note: 'Waiting for a technician', to: '/office/schedule' });

  const pending = db.payments.filter((p) => p.status === 'Pending approval');
  if (pending.length) items.push({ count: pending.length, title: `payment${pending.length > 1 ? 's' : ''} to approve`, note: 'Cash or bank payments recorded by staff', to: '/office/payments' });

  const conflicts = db.jobs.filter((j) => j.syncConflict);
  if (conflicts.length) items.push({ count: conflicts.length, title: `sync conflict${conflicts.length > 1 ? 's' : ''}`, note: 'Office and technician changed the same job', to: `/office/jobs/${conflicts[0].id}`, urgent: true });

  const warranties = db.installations.flatMap((i) => i.items).filter((it) => {
    const days = (new Date(it.warrantyEndsAt).getTime() - now.getTime()) / DAY;
    return days >= 0 && days <= 90;
  });
  if (warranties.length) items.push({ count: warranties.length, title: `warrant${warranties.length > 1 ? 'ies' : 'y'} ending soon`, note: 'Within 90 days', to: '/office/installations?tab=warranties' });
  return items;
}

const liveTone: Record<LiveStatus, Tone> = {
  Unscheduled: 'amber',
  Scheduled: 'blue',
  'On site': 'blue',
  Late: 'red',
  Done: 'green',
  Cancelled: 'neutral',
};

function weeklyCollections(db: DB, now = new Date()) {
  const monday = startOfDay(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: 8 }, (_, i) => {
    const start = monday.getTime() - (7 - i) * 7 * DAY;
    const end = start + 7 * DAY;
    const total = db.payments.filter((p) => p.status === 'Confirmed' && new Date(p.at).getTime() >= start && new Date(p.at).getTime() < end).reduce((s, p) => s + p.amount, 0);
    return { week: new Date(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), value: total / 1_000_000 };
  });
}

export function Dashboard() {
  const db = useDb();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const now = new Date();
  const k = kpis(db, now);
  const todays = db.jobs.filter((j) => j.start && isSameDay(j.start, now) && j.status !== 'Cancelled').sort((a, b) => a.start!.localeCompare(b.start!));
  const teamsOut = new Set(todays.filter((j) => j.status !== 'Done').flatMap((j) => j.assigneeIds)).size;
  const items = attention(db, now);
  const weeks = weeklyCollections(db, now);
  const max = Math.max(0.1, ...weeks.map((w) => w.value));
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const conflicts = findConflicts(todays);
  const name = (id: string) => db.users.find((u) => u.id === id)?.name.split(' ')[0] ?? '?';

  const cards: { label: string; value: string; note: string; trend?: 'up' | 'down' }[] = [
    { label: 'Collected this month', value: nairaShort(k.collected), note: k.change === null ? 'No payments last month' : `${k.change >= 0 ? '↑' : '↓'} ${Math.abs(k.change)}% vs last month`, trend: k.change === null ? undefined : k.change < 0 ? 'down' : 'up' },
    { label: 'Owed by customers', value: nairaShort(k.owed), note: k.overdue14 ? `${k.overdue14} overdue by 14+ days` : 'Nothing badly overdue', trend: k.overdue14 ? 'down' : undefined },
    { label: 'Jobs completed', value: String(k.done), note: `${k.upcoming} more scheduled this week` },
    { label: 'Quote win rate', value: `${k.winRate}%`, note: `${k.open} quote${k.open === 1 ? '' : 's'} open` },
  ];

  return (
    <OfficeShell>
      <PageHeader
        title={`${greeting}, ${user?.name.split(' ')[0] ?? ''}`}
        subtitle={`${fmtDay(now.toISOString())} · ${teamsOut} technician${teamsOut === 1 ? '' : 's'} out today`}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <IfCan perm="edit.leads">
              <Button variant="tonal" to="/office/leads">
                Log enquiry
              </Button>
            </IfCan>
            <IfCan perm="edit.quotes">
              <Button to="/office/quotes">New quote</Button>
            </IfCan>
          </div>
        }
      />

      <section aria-label="This month" className="kpi-row">
        <div className="kpi-grid">
          {cards.map((c) => (
            <div key={c.label} className="card kpi">
              <span className="kpi__label">{c.label}</span>
              <span className="kpi__value">{c.value}</span>
              <span className={`kpi__note${c.trend ? ` kpi__note--${c.trend}` : ''}`}>{c.note}</span>
            </div>
          ))}
          <IfCan perm="view.costs">
            <div className="card kpi">
              <span className="kpi__label">Sales this month</span>
              <span className="kpi__value">{nairaShort(k.sales)}</span>
              <span className="kpi__note">
                <span className="success">{k.margin.toFixed(1)}% margin</span>· owners only
              </span>
            </div>
          </IfCan>
        </div>
      </section>

      <div className="wrap">
        <section aria-labelledby="today" className="card" style={{ flex: '2 1 560px', minWidth: 0 }}>
          <div className="card__head">
            <h2 id="today" className="t-section-lg">
              Today's jobs
            </h2>
            <span className="t-small faint card__head-meta">Live · updates when phones sync</span>
            <Link to="/office/schedule" className="card__link">
              View schedule
            </Link>
          </div>
          {conflicts.length > 0 && (
            <Link to="/office/schedule" role="alert" className="notice notice--danger">
              <Icon name="warning" size={18} />
              {name(conflicts[0].techId)} is double-booked today
            </Link>
          )}
          {todays.length === 0 ? (
            <EmptyState title="No jobs today">Assign work on the schedule.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Job</th>
                    <th scope="col">Team</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {todays.map((j) => {
                    const st = liveStatus(j, now.getTime());
                    const lead = db.leads.find((l) => l.id === j.leadId);
                    return (
                      <tr key={j.id} className="is-link" onClick={() => navigate(`/office/jobs/${j.id}`)}>
                        <td className="muted cell-time">{fmtTime(j.start)}</td>
                        <td>
                          <Link to={`/office/jobs/${j.id}`} className="cell-link">
                            {lead?.name}
                          </Link>
                        </td>
                        <td>{j.type}</td>
                        <td className="muted">{j.assigneeIds.map(name).join(', ') || 'Unassigned'}</td>
                        <td>
                          <span className="cell-badges">
                            <Badge tone={liveTone[st]} icon={st === 'On site' ? 'pin' : undefined}>
                              {st === 'Late' ? lateByLabel(j, now.getTime()) : st}
                            </Badge>
                            {j.pendingSync && (
                              <span className="t-caption faint cell-sync">
                                <Icon name="sync" size={14} />
                                Syncing
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="attn" className="card" style={{ flex: '1 1 300px', minWidth: 0, alignSelf: 'flex-start' }}>
          <div className="card__head">
            <h2 id="attn" className="t-section-lg">
              Needs attention
            </h2>
            {items.length > 0 && (
              <Badge tone={items.some((a) => a.urgent) ? 'red' : 'amber'} icon={false}>
                {items.length} {items.length === 1 ? 'item' : 'items'}
              </Badge>
            )}
          </div>
          {items.length === 0 && <EmptyState title="All clear">Nothing is waiting on the office right now.</EmptyState>}
          {items.map((a) => (
            <Link key={a.title} to={a.to} className={`attn${a.urgent ? ' attn--urgent' : ''}`}>
              <span className="attn__count">{a.count}</span>
              <span className="attn__main">
                <span className="attn__title">{a.title}</span>
                <span className="attn__note">{a.note}</span>
              </span>
              <span className="attn__chev" aria-hidden="true">
                <Icon name="chevronRight" size={18} />
              </span>
            </Link>
          ))}
        </section>
      </div>

      <section aria-labelledby="coll" className="card">
        <div className="card__head">
          <h2 id="coll" className="t-section-lg">
            Weekly collections
          </h2>
          <span className="t-small muted">Last 8 weeks, ₦ millions</span>
        </div>
        <div className="bars" role="img" aria-label={`Weekly collections over the last 8 weeks, from ${weeks[0].value.toFixed(1)} to ${weeks[7].value.toFixed(1)} million naira`}>
          {weeks.map((w, i) => (
            <div key={w.week} className={`bars__col${i === weeks.length - 1 ? ' bars__col--current' : ''}`}>
              <span className="bars__value">{w.value.toFixed(1)}</span>
              <div className="bars__bar" style={{ height: Math.max(4, Math.round((w.value / max) * 140)) }} />
              <span className="bars__label">{w.week}</span>
            </div>
          ))}
        </div>
      </section>
      {!can(user?.role, 'edit.schedule') && <p className="t-small muted">You have read-only access.</p>}
    </OfficeShell>
  );
}
