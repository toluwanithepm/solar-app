import { Icon } from '../../components/Icon';
import { PhotoThumb } from '../../components/PhotoInput';
import { usePublicLink, usePublicTarget } from '../../components/PublicPage';
import { Badge, Button, EmptyState, Logo } from '../../components/ui';
import { addMonths, categoryLabel, fmtDate, fmtTime } from '../../data/domain';
import { useDb } from '../../data/store';

/** Customer handover report, opened from WhatsApp and printable as the handover PDF (E6-5, E7-1). No prices. */
export function HandoverReport() {
  const jobId = usePublicTarget('jobId');
  const db = useDb();
  const job = db.jobs.find((j) => j.id === jobId);
  const lead = db.leads.find((l) => l.id === job?.leadId);
  const installation = db.installations.find((i) => i.id === job?.installationId);
  const company = db.company;
  const faultLink = usePublicLink('fault_report', installation?.id);

  if (!job || !lead) {
    return (
      <div className="report">
        <EmptyState title="Report not found">Ask your installer to send the link again.</EmptyState>
      </div>
    );
  }

  const techs = db.users.filter((u) => job.assigneeIds.includes(u.id)).map((u) => u.name);
  const date = job.completedAt ?? job.checkOut?.at ?? job.updatedAt;
  // Prefer the installation register; fall back to serials captured on this job
  const items =
    job.type === 'Installation' && installation
      ? installation.items
      : job.serials.map((s) => ({ id: s.id, label: s.label, category: s.category, serial: s.serial, warrantyEndsAt: addMonths(date, s.warrantyYears * 12) }));
  const plan = db.plans.find((p) => p.id === installation?.planId);
  const before = job.photos.filter((p) => p.kind === 'before');
  const after = job.photos.filter((p) => p.kind === 'after');

  const section = (title: string, children: React.ReactNode) => (
    <section className="p-section" style={{ breakInside: 'avoid' }} aria-label={title}>
      <h2 className="t-section-lg p-section__head">
        {title}
      </h2>
      {children}
    </section>
  );

  return (
    <div className="report">
      <header className="report__head">
        {company.logoDataUrl ? <img src={company.logoDataUrl} alt="" className="brand-head__logo" style={{ width: 40, height: 40 }} /> : <Logo />}
        <div className="stack" style={{ flexGrow: 1, gap: 2 }}>
          <span className="brand-head__name">{company.name}</span>
          <span className="t-small muted">
            {company.phone} · {company.address}
          </span>
        </div>
        <Button variant="tonal" size="lg" className="no-print" onClick={() => window.print()}>
          <Icon name="print" size={20} />
          Save as PDF
        </Button>
      </header>

      <div className="p-intro">
        <span className="t-overline">
          {job.type} handover · {job.number}
        </span>
        <h1 className="t-display">{lead.name}</h1>
        <span className="t-body muted">{job.address}</span>
        <span>{job.status === 'Done' ? <Badge tone="green">Completed and signed off</Badge> : <Badge tone="blue">{job.status}</Badge>}</span>
      </div>

      <div className="card card--list">
        {[
          ['Date', fmtDate(date)],
          ['Time on site', job.checkIn ? `${fmtTime(job.checkIn.at)} – ${fmtTime(job.checkOut?.at)}` : '—'],
          ['Technicians', techs.join(', ') || '—'],
          ...(installation ? [['Next service', fmtDate(installation.nextServiceAt)]] : []),
          ...(plan ? [['Maintenance plan', `${plan.name} · ${plan.visitsPerYear} visits a year`]] : []),
        ].map(([k, v]) => (
          <div key={k} className="row row--between">
            <span className="muted">{k}</span>
            <span className="strong" style={{ textAlign: 'right' }}>
              {v}
            </span>
          </div>
        ))}
      </div>

      {items.length > 0 &&
        section(
          'Equipment and warranty',
          <div className="card table-scroll">
            <table className="table" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Type</th>
                  <th scope="col">Serial</th>
                  <th scope="col">Warranty until</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.label}</td>
                    <td className="muted">{categoryLabel[i.category]}</td>
                    <td className="serial-code">{i.serial ?? '—'}</td>
                    <td>{fmtDate(i.warrantyEndsAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        )}

      {job.checklist.length > 0 &&
        section(
          'Work done',
          <ul className="card card--list" style={{ margin: 0, listStyle: 'none' }}>
            {job.checklist.map((s) => (
              <li key={s.id} className="row" style={{ gap: 12 }}>
                <Icon name={s.done ? 'checkCircle' : 'circle'} size={20} color={s.done ? 'var(--success)' : 'var(--faint)'} />
                <span className="row__main" style={{ color: s.done ? 'var(--text)' : 'var(--muted)' }}>
                  {s.label}
                </span>
                {!s.done && <span className="t-small faint">Not done</span>}
              </li>
            ))}
          </ul>,
        )}

      {(before.length > 0 || after.length > 0) &&
        section(
          'Photos',
          <div className="stack" style={{ gap: 12 }}>
            {[
              ['Before', before],
              ['After', after],
            ].map(([label, photos]) =>
              (photos as typeof before).length ? (
                <div key={label as string} className="stack" style={{ gap: 8 }}>
                  <span className="t-small muted">{label as string}</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                    {(photos as typeof before).map((p, i) => (
                      <PhotoThumb key={p.id} photo={{ ...p, uploaded: true }} label={`${label} photo ${i + 1}`} />
                    ))}
                  </div>
                </div>
              ) : null,
            )}
          </div>,
        )}

      {job.signature &&
        section(
          'Customer sign-off',
          <div className="card card--pad stack" style={{ gap: 8 }}>
            {job.signature.dataUrl && <img src={job.signature.dataUrl} alt={`Signature of ${job.signature.name}`} style={{ width: '100%', maxWidth: 420, maxHeight: 160, objectFit: 'contain', alignSelf: 'flex-start' }} />}
            <span className="t-body">
              {job.signature.name} · {fmtDate(job.signature.at)}, {fmtTime(job.signature.at)}
            </span>
            <span className="t-small muted">The customer confirmed the system was working at handover.</span>
          </div>,
        )}

      <section className="card card--pad stack" style={{ gap: 8, breakInside: 'avoid' }} aria-label="Need help">
        <span className="t-section-lg">Something not working?</span>
        <span className="t-small muted">Call {company.phone} or report a fault online and we will get back to you.</span>
        <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          {faultLink && (
            <a href={faultLink} className="btn btn--primary btn--lg">
              Report a fault
            </a>
          )}
          <Button variant="tonal" size="lg" href={`tel:${company.phone}`}>
            <Icon name="phone" size={20} />
            Call us
          </Button>
        </div>
      </section>
    </div>
  );
}
