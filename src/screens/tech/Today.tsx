import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { PhoneScreen, SyncBanner, TechBottomNav } from '../../components/PhoneScreen';
import { Button, EmptyState } from '../../components/ui';
import { fmtDay, fmtTime, isSameDay } from '../../data/domain';
import { useCurrentUser, useDb } from '../../data/store';
import { AccountButton, equipmentChips, JobRow } from './parts';

export function Today() {
  const user = useCurrentUser();
  const allJobs = useDb((d) => d.jobs);
  const leads = useDb((d) => d.leads);
  const now = new Date();

  const jobs = allJobs
    .filter((j) => user && j.assigneeIds.includes(user.id) && j.start && isSameDay(j.start, now) && j.status !== 'Cancelled')
    .sort((a, b) => a.start!.localeCompare(b.start!));
  const next = jobs.find((j) => j.status !== 'Done');
  const rest = jobs.filter((j) => j !== next);
  const doneCount = jobs.filter((j) => j.status === 'Done').length;
  const nextLead = leads.find((l) => l.id === next?.leadId);
  const startTo = next && (next.type === 'Site survey' ? `/tech/survey/new?jobId=${next.id}` : `/tech/jobs/${next.id}/work`);

  return (
    <PhoneScreen>
      <header className="p-head">
        <div className="p-head__title">
          <span className="t-small muted">{fmtDay(now.toISOString())}</span>
          <h1 className="t-display">Today</h1>
        </div>
        <Link to="/tech/survey/new" aria-label="New site survey" className="icon-btn icon-btn--round" style={{ width: 48, height: 48 }}>
          <Icon name="add" size={24} />
        </Link>
        <AccountButton />
      </header>

      <SyncBanner inset />

      <main className="phone__scroll p-main">
        {next && nextLead ? (
          <section aria-labelledby="next" className="card card--pad next-job">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span id="next" className="next-job__time">
                <Icon name="clock" size={18} />
                {next.status === 'In progress' ? 'In progress' : 'Next'} · {fmtTime(next.start)}
              </span>
              <span className="t-small muted">{nextLead.location}</span>
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <span className="t-title">{nextLead.name}</span>
              <span className="t-small muted">
                {next.type} · {next.address}
              </span>
            </div>
            {equipmentChips(next).length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {equipmentChips(next).map((c) => (
                  <span key={c} className="chip">
                    {c}
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="tonal" size="lg" block to={`/tech/jobs/${next.id}`}>
                View details
              </Button>
              <Button size="lg" block to={startTo}>
                {next.status === 'In progress' ? 'Continue' : 'Start job'}
              </Button>
            </div>
          </section>
        ) : (
          <section className="card">
            <EmptyState title={jobs.length ? 'All done for today' : 'No jobs today'}>{jobs.length ? 'Nice work. Your completed jobs are below.' : 'Check All jobs for what is coming up.'}</EmptyState>
          </section>
        )}

        {rest.length > 0 && (
          <section aria-labelledby="later" className="p-section">
            <div className="p-section__head">
              <h2 id="later" className="t-section-lg">
                Later today
              </h2>
              <span className="t-small muted">
                {doneCount} of {jobs.length} done
              </span>
            </div>
            <div className="card p-list">
              {rest.map((job) => (
                <JobRow key={job.id} job={job} lead={leads.find((l) => l.id === job.leadId)} />
              ))}
            </div>
          </section>
        )}
      </main>

      <TechBottomNav />
    </PhoneScreen>
  );
}
