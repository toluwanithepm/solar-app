import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Dialog } from '../../components/forms';
import { AppBar, PhoneScreen } from '../../components/PhoneScreen';
import { Badge, Button, EmptyState } from '../../components/ui';
import { fmtTime, roleLabel } from '../../data/domain';
import { signOut } from '../../data/auth';
import { unsentChanges } from '../../data/remote/sync';
import { useCurrentUser, useDb } from '../../data/store';
import type { Job, Lead } from '../../data/types';

export function useJob(jobId: string | undefined): { job?: Job; lead?: Lead } {
  const job = useDb((d) => d.jobs.find((j) => j.id === jobId));
  const lead = useDb((d) => d.leads.find((l) => l.id === job?.leadId));
  return { job, lead };
}

/** Shown when a job id in the URL doesn't exist (e.g. deleted while offline). */
export function JobNotFound() {
  return (
    <PhoneScreen>
      <AppBar title="Job not found" leading={{ to: '/tech', icon: 'back', label: 'Back' }} />
      <div className="p-main">
        <EmptyState title="This job is no longer on your list">It may have been cancelled or moved to another technician.</EmptyState>
        <Button size="xl" to="/tech">
          Back to today
        </Button>
      </div>
    </PhoneScreen>
  );
}


/** "5 kVA inverter", "2 × 5 kWh battery" chips from the job's equipment, no prices. */
export function equipmentChips(job: Job, max = 3) {
  return job.equipment
    .filter((e) => e.category !== 'accessory' && e.category !== 'service')
    .slice(0, max)
    .map((e) => {
      const spec = e.description.includes('· ') ? e.description.split('· ').pop()! : e.description;
      return e.qty > 1 ? `${e.qty} × ${spec}` : spec;
    });
}

export const timeWindow = (job: Job) => (job.start ? `${fmtTime(job.start)} – ${fmtTime(new Date(new Date(job.start).getTime() + job.durationHours * 3_600_000).toISOString())}` : 'Not scheduled');

export const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function AccountButton() {
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Account"
        className="icon-btn icon-btn--round"
        style={{ width: 48, height: 48, background: 'var(--primary-tint)', color: 'var(--on-primary-tint)', borderColor: 'transparent', fontSize: 15, fontWeight: 600 }}
        onClick={() => setOpen(true)}
      >
        {initials(user.name)}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={user.name}
        actions={
          <Button
            variant="tonal"
            onClick={async () => {
              // Signing out wipes this phone's saved data, so unsent work would be lost
              const unsent = unsentChanges();
              if (unsent && !window.confirm(`${unsent} change${unsent === 1 ? '' : 's'} on this phone ${unsent === 1 ? 'has' : 'have'} not been sent yet and will be lost if you sign out now. Sign out anyway?`)) return;
              await signOut();
              navigate('/');
            }}
          >
            <Icon name="logout" size={20} />
            Sign out
          </Button>
        }
      >
        <span className="t-body muted">
          {roleLabel[user.role]} · {user.title} · {user.phone}
        </span>
      </Dialog>
    </>
  );
}

/** List row linking to a job: time, customer, type and place. */
export function JobRow({ job, lead, showDate }: { job: Job; lead?: Lead; showDate?: boolean }) {
  const done = job.status === 'Done';
  const when = job.start ? (showDate ? new Date(job.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : fmtTime(job.start)) : '—';
  return (
    <Link to={`/tech/jobs/${job.id}`} className={`job-row${done ? ' job-row--done' : ''}`}>
      <span className="job-row__time">{when}</span>
      <span className="row__main">
        <span className="job-row__name">{lead?.name ?? 'Customer'}</span>
        <span className="t-small muted">{done ? job.type : `${job.type} · ${lead?.location ?? job.address}`}</span>
        {(done || job.pendingSync || job.status === 'In progress') && (
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
            {done && <Badge tone="green">Done</Badge>}
            {job.status === 'In progress' && <Badge tone="blue">In progress</Badge>}
            {job.pendingSync && (
              <Badge tone="amber" icon="cloudOff">
                Not sent yet
              </Badge>
            )}
          </span>
        )}
      </span>
      <Icon name="chevronRight" size={22} color="var(--faint)" />
    </Link>
  );
}
