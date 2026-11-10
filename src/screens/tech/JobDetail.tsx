import { useNavigate, useParams } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { AppBar, PhoneScreen, SyncBanner } from '../../components/PhoneScreen';
import { Badge, Button } from '../../components/ui';
import { fmtDate, fmtTime, invoiceBalance, mapsLink, naira, whatsappLink } from '../../data/domain';
import { useDb } from '../../data/store';
import { checkIn } from '../../data/techActions';
import { getLocation } from '../../lib/photos';
import { JobNotFound, timeWindow, useJob } from './parts';

export function JobDetail() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { job, lead } = useJob(jobId);
  const invoices = useDb((d) => d.invoices);
  const payments = useDb((d) => d.payments);
  const installation = useDb((d) => d.installations.find((i) => i.id === job?.installationId));
  const ticket = useDb((d) => d.tickets.find((t) => t.id === job?.ticketId));
  if (!job || !lead) return <JobNotFound />;

  // Technicians only see what to collect, never prices or margins (NFR-10)
  const balanceInv = invoices.find((i) => i.jobId === job.id && i.kind === 'Balance');
  const balance = balanceInv ? invoiceBalance({ payments }, balanceInv) : 0;

  const actions: { label: string; icon: IconName; href: string }[] = [
    { label: 'Call', icon: 'phone', href: `tel:${lead.phone}` },
    { label: 'Message', icon: 'message', href: lead.whatsappConsent ? whatsappLink(lead.phone, `Hello ${lead.name}, this is your technician from the solar team.`) : `sms:${lead.phone}` },
    { label: 'Directions', icon: 'directions', href: mapsLink(job.address, job.gps) },
  ];

  const isSurvey = job.type === 'Site survey';
  const done = job.status === 'Done';

  async function start() {
    if (isSurvey) return navigate(`/tech/survey/new?jobId=${job!.id}`);
    if (!job!.checkIn) checkIn(job!.id, await getLocation());
    navigate(`/tech/jobs/${job!.id}/work`);
  }

  return (
    <PhoneScreen>
      <AppBar title={`Job ${job.number}`} leading={{ to: '/tech', icon: 'back', label: 'Back' }} trailing={done ? <Badge tone="green">Done</Badge> : job.status === 'In progress' ? <Badge tone="blue">In progress</Badge> : undefined} />

      <main className="phone__scroll p-main">
        <div className="p-intro">
          <span className="t-overline">
            {job.type} · {job.start ? `${fmtDate(job.start)}, ${timeWindow(job)}` : 'Not scheduled'}
          </span>
          <h1 className="t-display">{lead.name}</h1>
          <span className="t-body muted">{job.address}</span>
          {job.checkIn && (
            <span className="t-small muted">
              Checked in {fmtTime(job.checkIn.at)}
              {job.checkOut && ` · out ${fmtTime(job.checkOut.at)}`}
            </span>
          )}
        </div>

        <div className="p-grid-3">
          {actions.map((a) => (
            <a
              key={a.label}
              href={a.href}
              target={a.href.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              className="card quick-action"
            >
              <Icon name={a.icon} size={24} />
              {a.label}
            </a>
          ))}
        </div>

        {ticket && (
          <section aria-labelledby="fault" className="p-section">
            <h2 id="fault" className="t-section-lg p-section__head">
              Reported fault
            </h2>
            <div className="card card--pad stack" style={{ gap: 4 }}>
              <span className="t-body">{ticket.description}</span>
              <span className="t-small muted">
                {ticket.number} · reported {fmtDate(ticket.createdAt)} by {ticket.channel}
              </span>
            </div>
          </section>
        )}

        {job.equipment.length > 0 && (
          <section aria-labelledby="equip" className="p-section">
            <h2 id="equip" className="t-section-lg p-section__head">
              Equipment to install
            </h2>
            <div className="card card--list">
              {job.equipment.map((e) => (
                <div key={e.description} className="row row--between">
                  <span>{e.description}</span>
                  <span className="strong num">× {e.qty}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {installation && job.type !== 'Installation' && (
          <section aria-labelledby="system" className="p-section">
            <h2 id="system" className="t-section-lg p-section__head">
              Installed system
            </h2>
            <div className="card card--list">
              {installation.items
                .filter((i) => i.category !== 'panel')
                .map((i) => (
                  <div key={i.id} className="row" style={{ gap: 12 }}>
                    <span className="row__main">
                      <span>{i.label}</span>
                      <span className="t-small muted">
                        <span className="serial-code">{i.serial ?? 'No serial'}</span> · warranty to {fmtDate(i.warrantyEndsAt)}
                      </span>
                    </span>
                  </div>
                ))}
              <div className="row row--between">
                <span>Panels</span>
                <span className="strong num">{installation.items.filter((i) => i.category === 'panel').length}</span>
              </div>
            </div>
          </section>
        )}

        {balance > 0 && (
          <section aria-labelledby="pay" className="p-section">
            <h2 id="pay" className="t-section-lg p-section__head">
              Payment
            </h2>
            <div className="card card--pad stack" style={{ gap: 4 }}>
              <span className="t-small muted">Balance to collect at handover</span>
              <span className="t-figure num" style={{ textAlign: 'left' }}>
                {naira(balance)}
              </span>
            </div>
          </section>
        )}

        {job.notes && (
          <section className="card card--pad stack" style={{ gap: 4 }} aria-label="Notes">
            <span className="p-overline">Notes from the office</span>
            <span className="t-body">{job.notes}</span>
          </section>
        )}

        <SyncBanner />
      </main>

      <div className="phone__footer">
        {done ? (
          <Button size="xl" variant="tonal" block to={`/handover/${job.id}`}>
            View handover report
          </Button>
        ) : (
          <Button size="xl" block onClick={start}>
            {isSurvey ? 'Start site survey' : job.checkIn ? 'Continue job' : 'Check in and start'}
          </Button>
        )}
      </div>
    </PhoneScreen>
  );
}
