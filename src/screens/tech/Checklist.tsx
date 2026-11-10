import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Dialog, SelectField, TextField } from '../../components/forms';
import { AppBar, PhoneScreen, SyncBanner } from '../../components/PhoneScreen';
import { PhotoInput, PhotoThumb } from '../../components/PhotoInput';
import { Button, ProgressBar } from '../../components/ui';
import { fmtTime, itemLabel } from '../../data/domain';
import { useDb } from '../../data/store';
import { addExtra, addJobPhoto, checkIn, removeExtra, removeJobPhoto, serialSlots, toggleStep } from '../../data/techActions';
import type { PhotoKind } from '../../data/types';
import { getLocation } from '../../lib/photos';
import { JobNotFound, useJob } from './parts';

export function Checklist() {
  const { jobId } = useParams();
  const { job, lead } = useJob(jobId);
  const [extraOpen, setExtraOpen] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  if (!job || !lead) return <JobNotFound />;

  const steps = job.checklist;
  const doneCount = steps.filter((s) => s.done).length;
  const requiredLeft = steps.filter((s) => s.required && !s.done).length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 100;
  const hasSerials = serialSlots(job).length > 0 || job.type === 'Fault repair';
  const locked = job.status === 'Done';

  const photoGroup = (kind: PhotoKind, title: string) => {
    const photos = job.photos.filter((p) => p.kind === kind);
    return (
      <div className="stack" style={{ gap: 8 }}>
        <span className="t-small muted" style={{ padding: '0 4px' }}>
          {title} · {photos.length ? `${photos.length} taken` : 'at least 1 required'}
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {photos.map((p, i) => (
            <PhotoThumb key={p.id} photo={p} label={`${title} photo ${i + 1}`} onRemove={locked ? undefined : () => removeJobPhoto(job.id, p.id)} />
          ))}
          {!locked && <PhotoInput kind={kind} label={title} onPhoto={(p) => addJobPhoto(job.id, p)} />}
        </div>
      </div>
    );
  };

  return (
    <PhoneScreen>
      <AppBar
        title={lead.name}
        leading={{ to: `/tech/jobs/${job.id}`, icon: 'back', label: 'Back' }}
        trailing={
          job.checkIn ? (
            <span className="t-small muted" style={{ padding: '0 12px' }}>
              Checked in {fmtTime(job.checkIn.at)}
            </span>
          ) : undefined
        }
      />

      <div className="stack" style={{ padding: '8px 20px 16px', gap: 16, flexShrink: 0 }}>
        <h1 className="t-display">{job.type}</h1>
        <div className="stack" style={{ gap: 8 }}>
          <ProgressBar value={pct} label="Checklist progress" />
          <div className="t-small muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>
              {doneCount} of {steps.length} done
            </span>
            <span>{requiredLeft === 0 ? 'Required steps done' : `${requiredLeft} required left`}</span>
          </div>
        </div>
      </div>

      <main className="phone__scroll" style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {!job.checkIn && (
          <section className="card card--pad stack" style={{ gap: 12 }} aria-label="Check in">
            <span className="t-body">Check in when you arrive so time on site is recorded.</span>
            <Button
              disabled={checkingIn}
              onClick={async () => {
                setCheckingIn(true);
                checkIn(job.id, await getLocation());
                setCheckingIn(false);
              }}
            >
              <Icon name="pin" size={20} />
              {checkingIn ? 'Getting location…' : 'Check in now'}
            </Button>
          </section>
        )}

        <div className="card" style={{ padding: '4px 0' }}>
          {steps.map((s, i) => (
            <label
              key={s.id}
              style={{ display: 'flex', alignItems: 'center', gap: 16, minHeight: 64, padding: '8px 20px', cursor: locked ? 'default' : 'pointer', borderBottom: i < steps.length - 1 ? '1px solid var(--divider)' : 0 }}
            >
              <input type="checkbox" checked={s.done} disabled={locked} onChange={() => toggleStep(job.id, s.id)} style={{ width: 22, height: 22, margin: 0, accentColor: 'var(--primary)', flexShrink: 0 }} />
              <span className="row__main">
                <span className="t-body" style={{ color: s.done ? 'var(--muted)' : 'var(--text)' }}>
                  {s.label}
                </span>
                <span className="t-small muted">{s.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <section aria-labelledby="photos" className="stack" style={{ gap: 12 }}>
          <h2 id="photos" className="t-section" style={{ padding: '0 4px' }}>
            Photos
          </h2>
          {photoGroup('before', 'Before')}
          {photoGroup('after', 'After')}
        </section>

        <section aria-labelledby="extras" className="stack" style={{ gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
            <h2 id="extras" className="t-section">
              Extra materials
            </h2>
            {!locked && (
              <button type="button" className="btn btn--text" style={{ height: 40, fontSize: 14 }} onClick={() => setExtraOpen(true)}>
                <Icon name="add" size={18} />
                Log extra
              </button>
            )}
          </div>
          {job.extras.length === 0 ? (
            <span className="t-small muted" style={{ padding: '0 4px' }}>
              Used more cable, breakers or panels than planned? Log them so the office can bill them.
            </span>
          ) : (
            <div className="card card--list">
              {job.extras.map((x) => (
                <div key={x.id} className="row">
                  <span className="row__main">
                    <span>
                      {x.qty} × {x.description}
                    </span>
                    <span className="t-small muted">Flagged for invoicing</span>
                  </span>
                  {!locked && (
                    <button type="button" className="icon-btn" aria-label={`Remove ${x.description}`} onClick={() => removeExtra(job.id, x.id)}>
                      <Icon name="delete" size={20} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <SyncBanner />
      </main>

      <div className="phone__footer">
        {hasSerials && (
          <Button variant="tonal" size="xl" block to={`/tech/jobs/${job.id}/scan`}>
            Scan serials
          </Button>
        )}
        <Button size="xl" block to={`/tech/jobs/${job.id}/handover`}>
          {locked ? 'Handover' : 'Hand over'}
        </Button>
      </div>

      <ExtraDialog open={extraOpen} onClose={() => setExtraOpen(false)} onAdd={(x) => addExtra(job.id, x)} />
    </PhoneScreen>
  );
}

/** E6-6: pick from the price list by name (no prices shown) or type a free-text item. */
function ExtraDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (x: { description: string; qty: number; itemId?: string }) => void }) {
  const items = useDb((d) => d.priceItems);
  const [itemId, setItemId] = useState('');
  const [text, setText] = useState('');
  const [qty, setQty] = useState('1');
  const item = items.find((i) => i.id === itemId);
  const description = item ? itemLabel(item) : text.trim();
  const n = Math.max(1, Math.round(Number(qty) || 1));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Log extra material"
      actions={
        <Button
          disabled={!description}
          onClick={() => {
            onAdd({ description, qty: n, itemId: item?.id });
            setItemId('');
            setText('');
            setQty('1');
            onClose();
          }}
        >
          Add
        </Button>
      }
    >
      <SelectField
        id="extra-item"
        label="From price list"
        value={itemId}
        onChange={setItemId}
        options={[{ value: '', label: 'Something else (type below)' }, ...items.map((i) => ({ value: i.id, label: itemLabel(i) }))]}
      />
      {!item && <TextField id="extra-text" label="Item" value={text} onChange={setText} placeholder="e.g. 10 m of 16 mm² cable" />}
      <TextField id="extra-qty" label="Quantity" type="number" inputMode="numeric" min={1} value={qty} onChange={setQty} />
    </Dialog>
  );
}
