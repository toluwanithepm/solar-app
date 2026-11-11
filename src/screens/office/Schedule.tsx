import { useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import '../../styles/office-ops.css';
import { useCan } from '../../components/Guards';
import { Icon, type IconName } from '../../components/Icon';
import { OfficeShell } from '../../components/OfficeShell';
import { Dialog } from '../../components/forms';
import { Badge, Button, EmptyState, PageHeader, Segmented } from '../../components/ui';
import { DAY, fmtDay, fmtTime } from '../../data/domain';
import { conflictsForProposal, findConflicts, jobEndMs, jobStartMs, liveStatus, scheduleJob, startOfDay, unscheduleJob } from '../../data/opsActions';
import { useDb } from '../../data/store';
import type { Job, JobType } from '../../data/types';

const DAY_START = 7;
const HOURS = 12;
const SLOTS = HOURS * 2;
const NAME_COL = 168;
const gridColumns = `${NAME_COL}px repeat(${SLOTS}, minmax(0, 1fr))`;
const weekColumns = `${NAME_COL}px repeat(7, minmax(0, 1fr))`;
/** Faint hour gridlines behind the day timeline (starting after the technician column). */
const hourLines = `repeating-linear-gradient(to right, var(--divider) 0 1px, transparent 1px calc(100% / ${HOURS}))`;

/** Per-type colour classes (tokens in office-ops.css) and short labels for the job blocks. */
const typeClass: Record<JobType, string> = {
  Installation: 'sched-type--install',
  'Site survey': 'sched-type--survey',
  Maintenance: 'sched-type--maintenance',
  'Fault repair': 'sched-type--repair',
};
const typeShort: Record<JobType, string> = {
  Installation: 'Install',
  'Site survey': 'Survey',
  Maintenance: 'Service',
  'Fault repair': 'Repair',
};

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const weekStart = (d: Date) => {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};

/** Pack overlapping blocks into lanes so they stack instead of covering each other. */
function lanes(jobs: Job[]) {
  const ends: number[] = [];
  const out = new Map<string, number>();
  for (const j of [...jobs].sort((a, b) => jobStartMs(a) - jobStartMs(b))) {
    let lane = ends.findIndex((e) => e <= jobStartMs(j));
    if (lane < 0) lane = ends.length;
    ends[lane] = jobEndMs(j);
    out.set(j.id, lane);
  }
  return { lane: out, count: Math.max(1, ends.length) };
}

export function Schedule() {
  const db = useDb();
  const canEdit = useCan('edit.schedule');
  const [view, setView] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [editing, setEditing] = useState<Job | null>(null);

  const techs = db.users.filter((u) => u.role === 'technician' && u.active);
  const leadName = (id: string) => db.leads.find((l) => l.id === id)?.name ?? 'Customer';
  const techName = (id: string) => db.users.find((u) => u.id === id)?.name ?? '?';
  const rangeStart = view === 'day' ? date : weekStart(date);
  const rangeEnd = new Date(rangeStart.getTime() + (view === 'day' ? 1 : 7) * DAY);
  const inRange = db.jobs.filter((j) => j.start && j.status !== 'Cancelled' && new Date(j.start) >= rangeStart && new Date(j.start) < rangeEnd);
  const conflicts = findConflicts(inRange);
  const conflictIds = new Set(conflicts.flatMap((c) => [c.a.id, c.b.id]));
  const unscheduled = db.jobs.filter((j) => j.status === 'Unscheduled');

  const shift = (dir: number) => setDate(new Date(date.getTime() + dir * (view === 'day' ? 1 : 7) * DAY));
  const isToday = startOfDay(new Date()).getTime() === date.getTime();

  const drop = (e: DragEvent, techId: string, start: Date) => {
    e.preventDefault();
    if (!canEdit) return;
    const jobId = e.dataTransfer.getData('text/job');
    const fromTech = e.dataTransfer.getData('text/tech');
    const job = db.jobs.find((j) => j.id === jobId);
    if (!job) return;
    let assignees = job.assigneeIds.length ? [...job.assigneeIds] : [techId];
    if (fromTech && fromTech !== techId) assignees = assignees.map((t) => (t === fromTech ? techId : t));
    if (!assignees.includes(techId)) assignees = [techId, ...assignees];
    scheduleJob(job.id, start.toISOString(), job.durationHours, [...new Set(assignees)]);
  };

  return (
    <OfficeShell>
      <PageHeader
        title="Jobs"
        subtitle={view === 'day' ? fmtDay(date.toISOString()) : `Week of ${rangeStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`}
        actions={
          <>
            <div className="sched-nav">
              <button type="button" aria-label={view === 'day' ? 'Previous day' : 'Previous week'} className="icon-btn" onClick={() => shift(-1)}>
                <Icon name="chevronLeft" size={18} />
              </button>
              <button type="button" className="sched-nav__today" onClick={() => setDate(startOfDay(new Date()))} disabled={isToday && view === 'day'}>
                Today
              </button>
              <button type="button" aria-label={view === 'day' ? 'Next day' : 'Next week'} className="icon-btn" onClick={() => shift(1)}>
                <Icon name="chevronRight" size={18} />
              </button>
            </div>
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { id: 'day', name: 'Day' },
                { id: 'week', name: 'Week' },
              ]}
            />
            {canEdit && <Button to="/office/leads">New job</Button>}
          </>
        }
      />

      {conflicts.map((c) => (
        <div key={`${c.techId}-${c.a.id}-${c.b.id}`} role="alert" className="notice notice--danger ops-alert">
          <Icon name="warning" size={18} />
          <span className="ops-alert__text">
            <strong>{techName(c.techId).split(' ')[0]} is double-booked</strong> {view === 'week' ? `${new Date(c.b.start!).toLocaleDateString('en-GB', { weekday: 'short' })} ` : ''}
            {fmtTime(c.b.start)}–{fmtTime(new Date(Math.min(jobEndMs(c.a), jobEndMs(c.b))).toISOString())}: {leadName(c.a.leadId)} and {leadName(c.b.leadId)}
          </span>
          {canEdit && (
            <Button variant="tonal" size="sm" className="btn--compact" onClick={() => setEditing(c.b)}>
              Reassign {leadName(c.b.leadId)}
            </Button>
          )}
        </div>
      ))}

      <div className="wrap">
        <section aria-labelledby="unassigned" className="card sched-queue">
          <div className="card__head">
            <h2 id="unassigned" className="t-section">
              Unassigned
            </h2>
            {unscheduled.length > 0 && <Badge tone="amber">{unscheduled.length} waiting</Badge>}
          </div>
          {unscheduled.length === 0 ? (
            <EmptyState title="Nothing waiting">New jobs land here until they have a date and a team.</EmptyState>
          ) : (
            <>
              {canEdit && <p className="t-small muted ops-card__note" style={{ margin: 0 }}>Drag onto a technician, or select to assign.</p>}
              <div className="sched-queue__list">
                {unscheduled.map((j) => {
                  const urgent = j.type === 'Fault repair';
                  return (
                    <button
                      key={j.id}
                      type="button"
                      draggable={canEdit}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/job', j.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => canEdit && setEditing(j)}
                      className={`sched-queue__item ${typeClass[j.type]}`}
                      style={canEdit ? undefined : { cursor: 'default' }}
                    >
                      <span className="sched-queue__top">
                        <span className="t-small strong">{leadName(j.leadId)}</span>
                        {urgent && (
                          <Badge tone="red" icon="warning">
                            Urgent
                          </Badge>
                        )}
                      </span>
                      <span className="t-caption muted">
                        {j.type} · {j.durationHours} h · {db.leads.find((l) => l.id === j.leadId)?.location}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {view === 'day' ? (
          <DayGrid
            jobs={inRange}
            techs={techs}
            date={date}
            canEdit={canEdit}
            conflictIds={conflictIds}
            leadName={leadName}
            onOpen={setEditing}
            onDrop={drop}
          />
        ) : (
          <WeekGrid jobs={inRange} techs={techs} start={rangeStart} canEdit={canEdit} conflictIds={conflictIds} leadName={leadName} onOpen={setEditing} onDrop={drop} />
        )}
      </div>

      <div className="t-small muted sched-legend">
        {(Object.keys(typeClass) as JobType[]).map((t) => (
          <span key={t} className="sched-legend__item">
            <span aria-hidden="true" className={`sched-swatch ${typeClass[t]}`} />
            {t}
          </span>
        ))}
        <span className="sched-legend__item">
          <span aria-hidden="true" className="sched-swatch sched-swatch--conflict" />
          Conflict
        </span>
      </div>

      {editing && <AssignDialog key={editing.id} job={editing} onClose={() => setEditing(null)} />}
    </OfficeShell>
  );
}

type GridProps = {
  jobs: Job[];
  techs: { id: string; name: string; title: string }[];
  canEdit: boolean;
  conflictIds: Set<string>;
  leadName: (id: string) => string;
  onOpen: (j: Job) => void;
  onDrop: (e: DragEvent, techId: string, start: Date) => void;
};

type BlockStatus = { cls: string; icon: IconName; label: string };

/** A job on the board: customer, time · type, and a status pill when it needs attention. */
function JobBlock({ job, conflict, canEdit, leadName, onOpen, techId, style, week }: { job: Job; conflict: boolean; canEdit: boolean; leadName: (id: string) => string; onOpen: (j: Job) => void; techId: string; style?: CSSProperties; week?: boolean }) {
  const st = liveStatus(job);
  const done = st === 'Done';
  const range = `${fmtTime(job.start)}–${fmtTime(new Date(jobEndMs(job)).toISOString())}`;
  const status: BlockStatus | null = conflict
    ? { cls: 'conflict', icon: 'alertCircle', label: 'Overlaps' }
    : done
      ? { cls: 'done', icon: 'checkCircle', label: `Done ${fmtTime(job.completedAt)}` }
      : st === 'On site'
        ? { cls: 'onsite', icon: 'circleDot', label: 'On site' }
        : st === 'Late'
          ? { cls: 'late', icon: 'clock', label: 'Late' }
          : null;
  return (
    <button
      type="button"
      draggable={canEdit && !done}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/job', job.id);
        e.dataTransfer.setData('text/tech', techId);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onOpen(job)}
      aria-label={`${leadName(job.leadId)}, ${job.type}, ${fmtTime(job.start)} for ${job.durationHours} hours, ${st}${conflict ? ', conflict' : ''}`}
      title={`${leadName(job.leadId)} · ${job.type} · ${range}${status ? ` · ${status.label}` : ''}`}
      className={`sched-block ${typeClass[job.type]}${week ? ' sched-block--week' : ''}${done ? ' sched-block--done' : ''}${conflict ? ' sched-block--conflict' : ''}`}
      style={style}
    >
      <span className="sched-block__name">{leadName(job.leadId)}</span>
      <span className="sched-block__meta">
        {status && (
          <span className={`sched-block__status sched-block__status--${status.cls}`}>
            <Icon name={status.icon} size={11} />
            {status.label}
          </span>
        )}
        <span className="sched-block__time">{done ? typeShort[job.type] : `${week ? fmtTime(job.start) : range} · ${typeShort[job.type]}`}</span>
      </span>
    </button>
  );
}

function DayGrid({ jobs, techs, date, canEdit, conflictIds, leadName, onOpen, onDrop }: GridProps & { date: Date }) {
  const [hover, setHover] = useState<string | null>(null);
  const slotStart = (e: DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - NAME_COL;
    const slot = Math.max(0, Math.min(SLOTS - 1, Math.floor((x / (rect.width - NAME_COL)) * SLOTS)));
    const d = new Date(date);
    d.setHours(DAY_START, slot * 30, 0, 0);
    return d;
  };
  const col = (j: Job) => {
    const s = new Date(j.start!);
    const startSlot = Math.max(0, Math.round(((s.getHours() - DAY_START) * 60 + s.getMinutes()) / 30));
    const endSlot = Math.min(SLOTS, Math.max(startSlot + 1, startSlot + Math.round(j.durationHours * 2)));
    return `${2 + startSlot} / ${2 + endSlot}`;
  };

  return (
    <section aria-label="Day timeline" className="card sched-board">
      <div style={{ minWidth: 900 }}>
        <div className="sched-head" style={{ gridTemplateColumns: gridColumns }}>
          <span style={{ padding: '10px 20px' }}>Technician</span>
          {Array.from({ length: HOURS }, (_, i) => (
            <span key={i} className="sched-head__hour" style={{ gridColumn: `${2 + i * 2} / ${4 + i * 2}` }}>
              {pad(DAY_START + i)}:00
            </span>
          ))}
        </div>
        {techs.length === 0 && <EmptyState title="No technicians yet">Add technicians in Settings › Staff.</EmptyState>}
        {techs.map((t) => {
          const mine = jobs.filter((j) => j.assigneeIds.includes(t.id));
          const { lane, count } = lanes(mine);
          return (
            <div
              key={t.id}
              onDragOver={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setHover(t.id);
              }}
              onDragLeave={() => setHover((h) => (h === t.id ? null : h))}
              onDrop={(e) => {
                setHover(null);
                onDrop(e, t.id, slotStart(e));
              }}
              className={`sched-row${hover === t.id ? ' sched-row--drop' : ''}`}
              style={{
                gridTemplateColumns: gridColumns,
                gridTemplateRows: count > 1 ? `repeat(${count}, 60px)` : '72px',
                backgroundImage: hourLines,
                backgroundPosition: `${NAME_COL}px 0`,
                backgroundSize: `calc(100% - ${NAME_COL}px) 100%`,
                backgroundRepeat: 'no-repeat',
              }}
            >
              <div className="sched-tech" style={{ gridColumn: 1, gridRow: `1 / ${count + 1}` }}>
                <span className="sched-tech__name">{t.name}</span>
                <span className="t-caption muted">{t.title}</span>
              </div>
              {mine.map((j) => (
                <JobBlock
                  key={j.id}
                  job={j}
                  techId={t.id}
                  conflict={conflictIds.has(j.id)}
                  canEdit={canEdit}
                  leadName={leadName}
                  onOpen={onOpen}
                  style={{ gridColumn: col(j), gridRow: (lane.get(j.id) ?? 0) + 1 }}
                />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WeekGrid({ jobs, techs, start, canEdit, conflictIds, leadName, onOpen, onDrop }: GridProps & { start: Date }) {
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY));
  const today = startOfDay(new Date()).getTime();
  return (
    <section aria-label="Week calendar" className="card sched-board">
      <div style={{ minWidth: 980 }}>
        <div className="sched-head" style={{ gridTemplateColumns: weekColumns }}>
          <span style={{ padding: '10px 20px' }}>Technician</span>
          {days.map((d) => (
            <span key={d.toISOString()} className={`sched-head__day${d.getTime() === today ? ' sched-head__day--today' : ''}`}>
              {d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}
            </span>
          ))}
        </div>
        {techs.length === 0 && <EmptyState title="No technicians yet">Add technicians in Settings › Staff.</EmptyState>}
        {techs.map((t) => (
          <div key={t.id} className="sched-row" style={{ gridTemplateColumns: weekColumns, minHeight: 72, alignItems: 'stretch' }}>
            <div className="sched-tech" style={{ padding: '14px 20px' }}>
              <span className="sched-tech__name">{t.name}</span>
              <span className="t-caption muted">{t.title}</span>
            </div>
            {days.map((d) => {
              const dayJobs = jobs.filter((j) => j.assigneeIds.includes(t.id) && startOfDay(j.start!).getTime() === d.getTime()).sort((a, b) => a.start!.localeCompare(b.start!));
              return (
                <div
                  key={d.toISOString()}
                  onDragOver={(e) => canEdit && e.preventDefault()}
                  onDrop={(e) => {
                    const job = jobs.find((j) => j.id === e.dataTransfer.getData('text/job'));
                    const s = new Date(d);
                    if (job?.start) s.setHours(new Date(job.start).getHours(), new Date(job.start).getMinutes());
                    else s.setHours(9, 0);
                    onDrop(e, t.id, s);
                  }}
                  className={`sched-day-cell${d.getTime() === today ? ' sched-day-cell--today' : ''}`}
                >
                  {dayJobs.map((j) => (
                    <JobBlock key={j.id} job={j} techId={t.id} conflict={conflictIds.has(j.id)} canEdit={canEdit} leadName={leadName} onOpen={onOpen} week />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function AssignDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const db = useDb();
  const canEdit = useCan('edit.schedule');
  const techs = db.users.filter((u) => u.role === 'technician' && u.active);
  const initial = job.start ? new Date(job.start) : (() => {
    const d = startOfDay(new Date(Date.now() + DAY));
    d.setHours(9);
    return d;
  })();
  const [assignees, setAssignees] = useState<string[]>(job.assigneeIds);
  const [day, setDay] = useState(toDateInput(initial));
  const [time, setTime] = useState(toTimeInput(initial));
  const [duration, setDuration] = useState(String(job.durationHours));
  const lead = db.leads.find((l) => l.id === job.leadId);
  const startIso = useMemo(() => {
    const d = new Date(`${day}T${time}`);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }, [day, time]);
  const hours = Math.max(0.5, Number(duration) || 1);
  const clashes = assignees.length && startIso ? conflictsForProposal(db.jobs, job.id, startIso, hours, assignees) : [];
  const done = job.status === 'Done';
  const readOnly = !canEdit || done;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${lead?.name} · ${job.type}`}
      actions={
        <>
          <Button variant="text" to={`/office/jobs/${job.id}`}>
            Open job
          </Button>
          {!readOnly && job.start && (
            <Button
              variant="tonal"
              onClick={() => {
                unscheduleJob(job.id);
                onClose();
              }}
            >
              Unschedule
            </Button>
          )}
          {!readOnly && (
            <Button
              disabled={!assignees.length || !startIso}
              onClick={() => {
                scheduleJob(job.id, startIso, hours, assignees);
                onClose();
              }}
            >
              {clashes.length ? 'Save anyway' : 'Save'}
            </Button>
          )}
        </>
      }
    >
      <span className="t-small muted">
        {job.number} · {job.address}
      </span>
      {done && (
        <div className="notice notice--success">
          <Icon name="checkCircle" size={18} style={{ marginTop: 1 }} />
          <span>This job is done and can no longer be moved.</span>
        </div>
      )}
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="stack" style={{ gap: 8 }}>
          <span id="as-techs" className="t-small strong">
            Technicians
          </span>
          <div role="group" aria-labelledby="as-techs" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {techs.map((t) => {
              const on = assignees.includes(t.id);
              return (
                <label key={t.id} className={`pick-chip${on ? ' pick-chip--on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => setAssignees(on ? assignees.filter((x) => x !== t.id) : [...assignees, t.id])} />
                  {t.name}
                </label>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 140px' }}>
            <label htmlFor="as-date">Date</label>
            <input id="as-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 110px' }}>
            <label htmlFor="as-time">Start</label>
            <input id="as-time" type="time" step={1800} value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 100px' }}>
            <label htmlFor="as-dur">Hours</label>
            <input id="as-dur" type="number" inputMode="decimal" min={0.5} step={0.5} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
        </div>
      </fieldset>
      {clashes.length > 0 && (
        <div role="alert" className="notice notice--danger">
          <Icon name="warning" size={18} style={{ marginTop: 1 }} />
          <span>
            Clashes with{' '}
            {clashes
              .map((c) => `${db.leads.find((l) => l.id === c.leadId)?.name} (${fmtTime(c.start)}, ${c.assigneeIds.filter((a) => assignees.includes(a)).map((a) => db.users.find((u) => u.id === a)?.name.split(' ')[0]).join(', ')})`)
              .join('; ')}
          </span>
        </div>
      )}
      {job.pendingSync && !readOnly && (
        <div className="notice notice--warning">
          <Icon name="sync" size={18} style={{ marginTop: 1 }} />
          <span>The technician has unsynced updates on this job. Their field data will be kept.</span>
        </div>
      )}
      {lead && (
        <Link to={`/office/leads/${lead.id}`} className="t-small">
          View customer
        </Link>
      )}
    </Dialog>
  );
}
