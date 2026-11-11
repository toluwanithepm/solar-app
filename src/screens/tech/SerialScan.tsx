import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Dialog, TextField } from '../../components/forms';
import { AppBar, PhoneScreen } from '../../components/PhoneScreen';
import { Badge, Button, ProgressBar } from '../../components/ui';
import { removeSerial, saveSerial, serialSlots, type SerialSlot } from '../../data/techActions';
import type { ItemCategory } from '../../data/types';
import { JobNotFound, useJob } from './parts';
import { createDetector } from '../../data/barcode';


const corners: CSSProperties[] = [
  { left: 0, top: 0, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 12 },
  { right: 0, top: 0, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 12 },
  { left: 0, bottom: 0, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 12 },
  { right: 0, bottom: 0, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 12 },
];

type CameraState = 'starting' | 'scanning' | 'unsupported' | 'denied';

export function SerialScan() {
  const { jobId } = useParams();
  const { job } = useJob(jobId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [torch, setTorch] = useState<{ on: boolean; track: MediaStreamTrack } | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [manual, setManual] = useState<SerialSlot | null>(null);
  const [flash, setFlash] = useState('');

  const slots = job ? serialSlots(job) : [];
  const extraSlots: SerialSlot[] = job
    ? job.serials.filter((s) => !slots.some((x) => x.label === s.label)).map((s) => ({ key: s.id, label: s.label, detail: 'Added on site', category: s.category, itemId: s.itemId }))
    : [];
  const allSlots = [...slots, ...extraSlots];
  const serialFor = (label: string) => job?.serials.find((s) => s.label === label);
  const target = allSlots.find((s) => s.key === activeKey && !serialFor(s.label)) ?? allSlots.find((s) => !serialFor(s.label));
  const scannedCount = allSlots.filter((s) => serialFor(s.label)).length;

  // Keep the latest values visible to the detection loop without restarting the camera
  const latest = useRef({ target, job });
  latest.current = { target, job };

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported');
      return;
    }
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let stopped = false;

    createDetector()
      .then((detector) => {
        if (!detector) throw new Error('unsupported');
        return navigator.mediaDevices
          .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
          .then((s) => ({ s, detector }));
      })
      .then(async ({ s, detector }) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const video = videoRef.current!;
        video.srcObject = s;
        await video.play();
        setCamera('scanning');
        const track = s.getVideoTracks()[0];
        if ((track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch) setTorch({ on: false, track });
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue?.trim();
            const { target: t, job: j } = latest.current;
            if (value && t && j && !j.serials.some((x) => x.serial === value)) {
              saveSerial(j.id, t, value, 'scan');
              setFlash(`${t.label}: ${value}`);
              navigator.vibrate?.(80);
            }
          } catch {
            // frame not ready
          }
          timer = window.setTimeout(tick, 400);
        };
        tick();
      })
      .catch((e: Error) => setCamera(e?.message === 'unsupported' ? 'unsupported' : 'denied'));

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (!job) return <JobNotFound />;

  const cameraMessage =
    camera === 'scanning'
      ? target
        ? `Point at the barcode on the ${target.label.toLowerCase()} label`
        : 'All serials scanned'
      : camera === 'starting'
        ? 'Starting camera…'
        : camera === 'denied'
          ? 'Camera blocked. Allow camera access, or type the serials in.'
          : "This phone can't scan barcodes here. Type the serials in.";

  return (
    <PhoneScreen style={{ background: 'var(--scanner-bg)' }}>
      <div className="scanner">
        <video ref={videoRef} muted playsInline aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: camera === 'scanning' ? 0.85 : 0 }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
          <AppBar
            title="Scan serial numbers"
            leading={{ to: `/tech/jobs/${job.id}/work`, icon: 'close', label: 'Close scanner' }}
            trailing={
              torch ? (
                <button
                  type="button"
                  aria-label={torch.on ? 'Turn off flashlight' : 'Turn on flashlight'}
                  aria-pressed={torch.on}
                  className="icon-btn"
                  onClick={async () => {
                    await torch.track.applyConstraints({ advanced: [{ torch: !torch.on } as MediaTrackConstraintSet] });
                    setTorch({ ...torch, on: !torch.on });
                  }}
                >
                  <Icon name="flashlight" size={22} />
                </button>
              ) : undefined
            }
          />
        </div>
        <div aria-hidden="true" className="scanner__frame">
          {corners.map((c, i) => (
            <div key={i} className="scanner__corner" style={c} />
          ))}
        </div>
        <p aria-live="polite" className={`scanner__msg${flash ? ' scanner__msg--saved' : ''}`}>
          {flash ? `Saved ${flash}` : cameraMessage}
        </p>
      </div>

      <div className="sheet">
        <div aria-hidden="true" className="sheet__grip" />
        <div className="stack" style={{ gap: 8, padding: '14px 0 8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <h1 className="t-title">Equipment</h1>
            <Badge tone={allSlots.length > 0 && scannedCount === allSlots.length ? 'green' : 'neutral'} icon={false}>
              {scannedCount} of {allSlots.length} scanned
            </Badge>
          </div>
          <ProgressBar value={allSlots.length ? Math.round((scannedCount / allSlots.length) * 100) : 0} label="Serials scanned" />
        </div>

        <div style={{ overflowY: 'auto', minHeight: 0, flexGrow: 1 }}>
          {allSlots.length === 0 && <p className="t-small muted">No equipment with serial numbers on this job. Add a part you fitted below.</p>}
          {allSlots.map((s) => {
            const rec = serialFor(s.label);
            const active = !rec && target?.key === s.key;
            return (
              <div key={s.key} className={`serial-row${active ? ' serial-row--active' : ''}`}>
                <Icon name={rec ? 'checkCircle' : active ? 'circleDot' : 'circle'} size={24} color={rec ? 'var(--success)' : active ? 'var(--primary)' : 'var(--faint)'} />
                <button type="button" className="serial-row__main" onClick={() => (rec ? setManual(s) : setActiveKey(s.key))} aria-label={rec ? `Edit ${s.label} serial` : `Scan ${s.label} next`}>
                  <span style={{ fontWeight: 500 }}>{s.label}</span>
                  {rec ? (
                    <span className="t-small muted">
                      <span className="serial-code" style={{ color: 'var(--text)' }}>
                        {rec.serial}
                      </span>
                      {rec.method === 'manual' ? ' · typed' : ' · scanned'}
                    </span>
                  ) : (
                    <span className="t-small" style={active ? { color: 'var(--on-primary-tint)', fontWeight: 600 } : { color: 'var(--muted)' }}>
                      {active ? (camera === 'scanning' ? 'Scanning now…' : 'Next to enter') : s.detail}
                    </span>
                  )}
                </button>
                {rec && (
                  <button type="button" className="icon-btn" aria-label={`Clear ${s.label} serial`} onClick={() => removeSerial(job.id, rec.id)}>
                    <Icon name="close" size={20} />
                  </button>
                )}
              </div>
            );
          })}
          <button type="button" className="btn btn--text btn--lg" style={{ marginTop: 4 }} onClick={() => setManual({ key: 'new', label: '', detail: '', category: 'accessory' })}>
            <Icon name="add" size={20} />
            Add another part
          </button>
        </div>

        <div className="phone__footer" style={{ margin: '0 -16px' }}>
          <Button variant="tonal" size="xl" block disabled={!target} onClick={() => target && setManual(target)}>
            Type it in
          </Button>
          <Button size="xl" block to={`/tech/jobs/${job.id}/work`}>
            Done
          </Button>
        </div>
      </div>

      <ManualDialog
        slot={manual}
        initial={manual ? (serialFor(manual.label)?.serial ?? '') : ''}
        taken={(v) => job.serials.some((x) => x.serial === v && x.label !== manual?.label)}
        onClose={() => setManual(null)}
        onSave={(slot, serial) => saveSerial(job.id, slot, serial, 'manual')}
      />
    </PhoneScreen>
  );
}

function ManualDialog({ slot, initial, taken, onClose, onSave }: { slot: SerialSlot | null; initial: string; taken: (v: string) => boolean; onClose: () => void; onSave: (slot: SerialSlot, serial: string) => void }) {
  const [value, setValue] = useState(initial);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<ItemCategory>('accessory');
  const isNew = slot?.key === 'new';
  useEffect(() => {
    setValue(initial);
    setLabel('');
  }, [slot, initial]);
  const v = value.trim().toUpperCase();
  const dup = !!v && taken(v);

  return (
    <Dialog
      open={!!slot}
      onClose={onClose}
      title={isNew ? 'Add a part' : `Serial for ${slot?.label ?? ''}`}
      actions={
        <Button
          disabled={!v || dup || (isNew && !label.trim())}
          onClick={() => {
            if (!slot) return;
            onSave(isNew ? { ...slot, label: label.trim(), category } : slot, v);
            onClose();
          }}
        >
          Save
        </Button>
      }
    >
      {isNew && (
        <>
          <TextField id="part-label" label="Part" value={label} onChange={setLabel} placeholder="e.g. Replacement charge controller" />
          <div className="field">
            <label htmlFor="part-cat">Type</label>
            <select id="part-cat" value={category} onChange={(e) => setCategory(e.target.value as ItemCategory)}>
              <option value="inverter">Inverter</option>
              <option value="battery">Battery</option>
              <option value="panel">Panel</option>
              <option value="accessory">Other part</option>
            </select>
          </div>
        </>
      )}
      <TextField id="serial" label="Serial number" value={value} onChange={setValue} placeholder="As printed on the label" hint={dup ? 'This serial is already used on this job' : undefined} />
    </Dialog>
  );
}
