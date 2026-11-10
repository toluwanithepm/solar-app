import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Dialog, TextField } from '../../components/forms';
import { AppBar, PhoneScreen } from '../../components/PhoneScreen';
import { Button } from '../../components/ui';
import { removeSerial, saveSerial, serialSlots, type SerialSlot } from '../../data/techActions';
import type { ItemCategory } from '../../data/types';
import { JobNotFound, useJob } from './parts';

// The Barcode Detection API is not in TypeScript's DOM lib yet.
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<DetectedBarcode[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

const corner = (pos: CSSProperties): CSSProperties => ({ position: 'absolute', width: 24, height: 24, borderColor: '#fff', borderStyle: 'solid', borderWidth: 0, ...pos });

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
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported');
      return;
    }
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let stopped = false;
    const detector = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'qr_code', 'ean_13', 'data_matrix'] });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
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
      .catch(() => setCamera('denied'));

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
      <div style={{ height: 340, flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
        <video ref={videoRef} muted playsInline aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: camera === 'scanning' ? 0.85 : 0 }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
          <AppBar
            title="Scan serial numbers"
            color="#fff"
            leading={{ to: `/tech/jobs/${job.id}/work`, icon: 'close', label: 'Close scanner' }}
            trailing={
              torch ? (
                <button
                  type="button"
                  aria-label={torch.on ? 'Turn off flashlight' : 'Turn on flashlight'}
                  aria-pressed={torch.on}
                  className="icon-btn"
                  style={{ color: '#fff' }}
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
        <div aria-hidden="true" style={{ position: 'absolute', left: '50%', marginLeft: -130, top: 104, width: 260, height: 130 }}>
          <div style={corner({ left: 0, top: 0, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 12 })} />
          <div style={corner({ right: 0, top: 0, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 12 })} />
          <div style={corner({ left: 0, bottom: 0, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 12 })} />
          <div style={corner({ right: 0, bottom: 0, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 12 })} />
        </div>
        <p aria-live="polite" style={{ position: 'absolute', left: 32, right: 32, top: 256, margin: 0, textAlign: 'center', color: 'var(--scanner-text)', fontSize: 14, lineHeight: '20px' }}>
          {flash ? `Saved ${flash}` : cameraMessage}
        </p>
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, background: 'var(--surface)', borderRadius: '28px 28px 0 0', display: 'flex', flexDirection: 'column', padding: '12px 20px 24px' }}>
        <div aria-hidden="true" style={{ width: 32, height: 4, borderRadius: 2, background: 'var(--scanner-text)', alignSelf: 'center' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '20px 0 8px' }}>
          <h1 className="t-title">Equipment</h1>
          <span className="t-small muted">
            {scannedCount} of {allSlots.length} scanned
          </span>
        </div>

        <div style={{ overflowY: 'auto', minHeight: 0, flexGrow: 1 }}>
          {allSlots.length === 0 && <p className="t-small muted">No equipment with serial numbers on this job. Add a part you fitted below.</p>}
          {allSlots.map((s) => {
            const rec = serialFor(s.label);
            const active = !rec && target?.key === s.key;
            return (
              <div key={s.key} className="row" style={{ gap: 12 }}>
                <Icon name={rec ? 'checkCircle' : 'circle'} color={rec ? 'var(--primary)' : 'var(--faint)'} />
                <button type="button" className="row__main" onClick={() => (rec ? setManual(s) : setActiveKey(s.key))} style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }} aria-label={rec ? `Edit ${s.label} serial` : `Scan ${s.label} next`}>
                  <span>{s.label}</span>
                  <span className="t-small" style={active ? { color: 'var(--primary)', fontWeight: 500 } : { color: 'var(--muted)' }}>
                    {rec ? `${rec.serial}${rec.method === 'manual' ? ' · typed' : ''}` : active ? (camera === 'scanning' ? 'Scanning…' : 'Next to enter') : s.detail}
                  </span>
                </button>
                {rec && (
                  <button type="button" className="icon-btn" aria-label={`Clear ${s.label} serial`} onClick={() => removeSerial(job.id, rec.id)}>
                    <Icon name="close" size={20} />
                  </button>
                )}
              </div>
            );
          })}
          <button type="button" className="btn btn--text" style={{ height: 44, marginTop: 4 }} onClick={() => setManual({ key: 'new', label: '', detail: '', category: 'accessory' })}>
            <Icon name="add" size={18} />
            Add another part
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, paddingTop: 16 }}>
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
