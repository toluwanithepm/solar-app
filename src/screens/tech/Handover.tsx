import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Dialog, TextField } from '../../components/forms';
import { AppBar, PhoneScreen, SyncBanner } from '../../components/PhoneScreen';
import { Badge, Button } from '../../components/ui';
import { fmtDate, invoiceBalance, naira, whatsappLink } from '../../data/domain';
import { useShareLink } from '../../data/remote/shareLinks';
import { useDb } from '../../data/store';
import { completeWithHandover, missingForCompletion } from '../../data/techActions';
import { getLocation } from '../../lib/photos';
import { JobNotFound, useJob } from './parts';

export function Handover() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { job, lead } = useJob(jobId);
  const invoices = useDb((d) => d.invoices);
  const payments = useDb((d) => d.payments);
  const plans = useDb((d) => d.plans);
  const installation = useDb((d) => d.installations.find((i) => i.id === job?.installationId));
  const [name, setName] = useState('');
  const [signature, setSignature] = useState('');
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (lead && !name) setName(lead.name);
  }, [lead?.id]);

  // The customer's pay link is a secure token from the server, so it needs a connection
  const payLink = useShareLink('invoice', invoices.find((i) => i.jobId === job?.id && i.kind === 'Balance')?.id);

  if (!job || !lead) return <JobNotFound />;

  const done = job.status === 'Done';
  const balanceInv = invoices.find((i) => i.jobId === job.id && i.kind === 'Balance');
  const balance = balanceInv ? invoiceBalance({ payments }, balanceInv) : 0;
  const missing = done ? [] : missingForCompletion(job, name, !!signature);
  const stepsDone = job.checklist.filter((s) => s.done).length;
  const offerPlan = !done && !installation?.planId && (job.type === 'Installation' || job.type === 'Maintenance');

  async function complete() {
    setBusy(true);
    const gps = await getLocation();
    completeWithHandover(job!.id, { dataUrl: signature, name: name.trim() }, gps, planId || undefined);
    setBusy(false);
    setCompleted(true);
  }

  return (
    <PhoneScreen>
      <AppBar title={lead.name} leading={{ to: `/tech/jobs/${job.id}/work`, icon: 'back', label: 'Back' }} />

      <main className="phone__scroll p-main">
        <div className="p-intro">
          <h1 className="t-display">Handover</h1>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={stepsDone === job.checklist.length ? 'green' : 'neutral'} icon={stepsDone === job.checklist.length ? undefined : false}>
              {stepsDone} of {job.checklist.length} steps
            </Badge>
            <Badge tone="neutral">{job.serials.length} serials</Badge>
            <Badge tone="neutral">{job.photos.length} photos</Badge>
          </div>
        </div>

        {(balance > 0 || offerPlan) && (
          <div className="card card--list">
            {balance > 0 && balanceInv && (
              <div className="row" style={{ minHeight: 80 }}>
                <span className="row__main">
                  <span className="t-small muted">Balance due</span>
                  <span className="t-title num">
                    {naira(balance)}
                  </span>
                </span>
                <Button variant="tonal" size="md" disabled={!payLink} href={whatsappLink(lead.phone, `Hello ${lead.name}, you can pay the balance of ${naira(balance)} here: ${payLink}`)}>
                  {payLink ? 'Send pay link' : 'Pay link needs signal'}
                </Button>
              </div>
            )}
            {offerPlan && (
              <fieldset className="stack" style={{ border: 0, margin: 0, padding: '14px 0 4px' }}>
                <legend className="t-section" style={{ padding: 0 }}>
                  Maintenance plan
                </legend>
                {[{ id: '', name: 'No plan for now', price: 0, visitsPerYear: 0 }, ...plans].map((p) => (
                  <label key={p.id || 'none'} className="choice">
                    <input type="radio" name="plan" checked={planId === p.id} onChange={() => setPlanId(p.id)} />
                    <span className="row__main">
                      <span>{p.name}</span>
                      {p.id && (
                        <span className="t-small muted">
                          {p.visitsPerYear} visits a year · {naira(p.price)}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}

        {done ? (
          <section className="card card--pad stack" style={{ gap: 8 }} aria-label="Signed off">
            <span className="t-small muted">Signed off by</span>
            <span className="t-title">{job.signature?.name ?? lead.name}</span>
            {job.signature?.dataUrl && <img src={job.signature.dataUrl} alt={`Signature of ${job.signature.name}`} style={{ width: '100%', maxHeight: 140, objectFit: 'contain' }} />}
            <span className="t-small muted">Completed {fmtDate(job.completedAt)}</span>
          </section>
        ) : (
          <section aria-labelledby="sig" className="p-section" style={{ gap: 12 }}>
            <div className="p-section__head">
              <h2 id="sig" className="t-section-lg">
                Customer signature
              </h2>
              <button type="button" className="btn btn--text btn--md" onClick={() => setSignature('')} disabled={!signature}>
                Clear
              </button>
            </div>
            <SignaturePad value={signature} onChange={setSignature} caption={`${name || 'Customer'} · ${fmtDate(new Date().toISOString())}`} />
            <TextField id="signer" label="Customer's name" value={name} onChange={setName} />
            <span className="t-small muted p-footer-note">
              By signing, the customer confirms the system works. The report and warranty go to them on WhatsApp.
            </span>
          </section>
        )}

        {missing.length > 0 && (
          <section className="notice notice--warning" aria-labelledby="missing">
            <Icon name="alertCircle" size={20} style={{ marginTop: 2 }} />
            <div className="stack" style={{ gap: 4 }}>
              <h2 id="missing" className="t-section" style={{ color: 'inherit' }}>
                Before you can complete
              </h2>
              <ul style={{ margin: 0, paddingLeft: 18 }} className="t-body">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
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
          <Button size="xl" block disabled={missing.length > 0 || busy} onClick={complete}>
            {busy ? 'Completing…' : 'Complete job'}
          </Button>
        )}
      </div>

      <Dialog
        open={completed}
        onClose={() => navigate('/tech')}
        title="Job complete"
        actions={
          <>
            <Button variant="tonal" to={`/handover/${job.id}`}>
              View report
            </Button>
            <Button onClick={() => navigate('/tech')}>Back to today</Button>
          </>
        }
      >
        <span className="t-body muted" style={{ display: 'flex', gap: 8 }}>
          <Icon name="whatsapp" size={20} color="var(--success)" />
          The handover report{balance > 0 ? ' and balance payment link were' : ' was'} sent to {lead.name} on WhatsApp{job.pendingSync ? ' and will go out when you are back online' : ''}.
        </span>
      </Dialog>
    </PhoneScreen>
  );
}

/** Finger/stylus signature on a canvas; hands back a PNG data URL after each stroke. */
function SignaturePad({ value, onChange, caption }: { value: string; onChange: (dataUrl: string) => void; caption: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Ink colour from the theme (canvas can't read CSS variables directly)
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--text').trim() || 'black';
  }, []);

  useEffect(() => {
    if (value) return;
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
  }, [value]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div className="card sig-pad">
      <canvas
        ref={canvasRef}
        aria-label="Signature pad. Ask the customer to sign with their finger."
        role="img"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const ctx = e.currentTarget.getContext('2d')!;
          const [x, y] = point(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 0.1, y + 0.1);
          ctx.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          const [x, y] = point(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          onChange(e.currentTarget.toDataURL('image/png'));
        }}
        onPointerCancel={() => (drawing.current = false)}
      />
      <div aria-hidden="true" className="sig-pad__line" />
      <span className="t-small muted sig-pad__caption">
        {value ? caption : 'Sign here'}
      </span>
    </div>
  );
}
