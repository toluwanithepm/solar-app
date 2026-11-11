import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Dialog, SelectField, TextField } from '../../components/forms';
import { AppBar, PhoneScreen, SyncBanner } from '../../components/PhoneScreen';
import { PhotoInput, PhotoThumb } from '../../components/PhotoInput';
import { Badge, Button, ProgressBar } from '../../components/ui';
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
        <div className="p-section__head" style={{ minHeight: 24 }}>
          <span className="t-section">{title}</span>
          {photos.length ? <Badge tone="green">{photos.length} taken</Badge> : <Badge tone="amber">At least 1 needed</Badge>}
        </div>
        <div className="p-grid-3">
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
            <span style={{ padding: '0 8px' }}>
              <Badge tone="green" icon="pin">
                In {fmtTime(job.checkIn.at)}
              </Badge>
            </span>
          ) : undefined
        }
      />

      <div className={`check-progress${requiredLeft === 0 ? ' check-progress--done' : ''}`}>
        <h1 className="t-display">{job.type}</h1>
        <div className="check-progress__meta">
          <span className="t-section-lg" aria-live="polite">
            Step {Math.min(doneCount + 1, steps.length)} of {steps.length}
            <span className="t-small muted" style={{ fontWeight: 400 }}>
              {' '}
              · {doneCount} done
            </span>
          </span>
          {requiredLeft === 0 ? (
            <Badge tone="green">Required done</Badge>
          ) : (
            <Badge tone="amber" icon="alertCircle">
              {requiredLeft} required left
            </Badge>
          )}
        </div>
        <ProgressBar value={pct} label="Checklist progress" />
      </div>

      <main className="phone__scroll p-main">
        {!job.checkIn && (
          <section className="card card--pad stack" style={{ gap: 12 }} aria-label="Check in">
            <span className="t-body">Check in when you arrive so time on site is recorded.</span>
            <Button
              size="lg"
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

        <section aria-label="Checklist" className="card p-list">
          {steps.map((s) => (
            <label key={s.id} className={`check-item${s.done ? ' check-item--done' : ''}${locked ? ' check-item--locked' : ''}`}>
              <input type="checkbox" checked={s.done} disabled={locked} onChange={() => toggleStep(job.id, s.id)} />
              <span className="check-item__box" aria-hidden="true">
                {s.done && <Icon name="check" size={20} />}
              </span>
              <span className="row__main">
                <span className="check-item__label">{s.label}</span>
                {s.hint && <span className="t-small muted">{s.hint}</span>}
              </span>
              {s.done ? (
                <Icon name="checkCircle" size={20} color="var(--success)" />
              ) : (
                s.required && !/^required/i.test(s.hint) && <span className="check-item__tag">Required</span>
              )}
            </label>
          ))}
        </section>

        <section aria-labelledby="photos" className="p-section" style={{ gap: 12 }}>
          <h2 id="photos" className="t-section-lg p-section__head">
            Photos
          </h2>
          {photoGroup('before', 'Before')}
          {photoGroup('after', 'After')}
        </section>

        <section aria-labelledby="extras" className="p-section">
          <div className="p-section__head">
            <h2 id="extras" className="t-section-lg">
              Extra materials
            </h2>
            {!locked && (
              <button type="button" className="btn btn--text btn--md" onClick={() => setExtraOpen(true)}>
                <Icon name="add" size={20} />
                Log extra
              </button>
            )}
          </div>
          {job.extras.length === 0 ? (
            <span className="t-small muted p-footer-note">
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
                    <span>
                      <Badge tone="blue">Flagged for invoicing</Badge>
                    </span>
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
