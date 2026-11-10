import { PhoneScreen, SyncBanner, TechBottomNav } from '../../components/PhoneScreen';
import { EmptyState } from '../../components/ui';
import { addDays, fmtDay } from '../../data/domain';
import { useCurrentUser, useDb } from '../../data/store';
import type { Job } from '../../data/types';
import { AccountButton, JobRow } from './parts';

export function AllJobs() {
  const user = useCurrentUser();
  const allJobs = useDb((d) => d.jobs);
  const leads = useDb((d) => d.leads);

  const mine = allJobs.filter((j) => user && j.assigneeIds.includes(user.id) && j.status !== 'Cancelled');
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const upcoming = mine.filter((j) => j.status !== 'Done' && (!j.start || new Date(j.start) >= startOfToday)).sort((a, b) => (a.start ?? '9').localeCompare(b.start ?? '9'));
  const overdue = mine.filter((j) => j.status !== 'Done' && j.start && new Date(j.start) < startOfToday);
  const recent = mine
    .filter((j) => j.status === 'Done' && j.completedAt && j.completedAt > addDays(new Date(), -30))
    .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));

  const byDay = new Map<string, Job[]>();
  for (const j of upcoming) {
    const key = j.start ? fmtDay(j.start) : 'Not scheduled yet';
    byDay.set(key, [...(byDay.get(key) ?? []), j]);
  }

  const group = (title: string, jobs: Job[], showDate = false) => (
    <section key={title} aria-label={title} className="p-section">
      <div className="p-section__head">
        <h2 className="t-section-lg">{title}</h2>
        <span className="t-small muted">{jobs.length}</span>
      </div>
      <div className="card p-list">
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} lead={leads.find((l) => l.id === j.leadId)} showDate={showDate} />
        ))}
      </div>
    </section>
  );

  return (
    <PhoneScreen>
      <header className="p-head">
        <div className="p-head__title">
          <h1 className="t-display">All jobs</h1>
        </div>
        <AccountButton />
      </header>
      <SyncBanner inset />
      <main className="phone__scroll p-main">
        {overdue.length > 0 && group('Not finished', overdue, true)}
        {[...byDay.entries()].map(([day, jobs]) => group(day, jobs))}
        {recent.length > 0 && group('Completed in the last 30 days', recent, true)}
        {mine.length === 0 && (
          <div className="card">
            <EmptyState title="No jobs assigned">The office will assign jobs to you here.</EmptyState>
          </div>
        )}
      </main>
      <TechBottomNav />
    </PhoneScreen>
  );
}
