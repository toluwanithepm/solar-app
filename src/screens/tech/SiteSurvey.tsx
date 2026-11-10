import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Dialog, SelectField, TextField } from '../../components/forms';
import { AppBar, PhoneScreen, SyncBanner } from '../../components/PhoneScreen';
import { PhotoInput, PhotoThumb } from '../../components/PhotoInput';
import { Button, EmptyState, Stat } from '../../components/ui';
import { appliancePresets, effectiveSize, sunHoursByState } from '../../data/domain';
import { useCurrentUser, useDb } from '../../data/store';
import { addAppliance, createQuickLead, editSurvey, startSurvey, submitSurvey } from '../../data/techActions';
import type { PhotoKind, PropertyType, Survey, SystemSize } from '../../data/types';
import { formatGps } from '../../lib/photos';

export function SiteSurvey() {
  const { surveyId } = useParams();
  const survey = useDb((d) => d.surveys.find((s) => s.id === surveyId));
  if (surveyId === 'new') return <NewSurvey />;
  if (!survey) {
    return (
      <PhoneScreen>
        <AppBar title="Survey" leading={{ to: '/tech', icon: 'back', label: 'Back' }} />
        <EmptyState title="Survey not found" />
      </PhoneScreen>
    );
  }
  return <SurveyEditor survey={survey} />;
}

/** Resolves ?jobId= or ?leadId= into a draft survey, or asks which customer it is for. */
function NewSurvey() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const leads = useDb((d) => d.leads);
  const jobId = params.get('jobId') ?? undefined;
  const leadId = params.get('leadId') ?? undefined;
  const [quickOpen, setQuickOpen] = useState(false);

  useEffect(() => {
    if (!user || (!jobId && !leadId)) return;
    const id = startSurvey(user.id, { jobId, leadId });
    if (id) navigate(`/tech/survey/${id}`, { replace: true });
  }, [user, jobId, leadId, navigate]);

  const open = leads.filter((l) => l.stage === 'New').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pick = (id: string) => user && navigate(`/tech/survey/${startSurvey(user.id, { leadId: id })}`, { replace: true });

  if (jobId || leadId) return <PhoneScreen>{null}</PhoneScreen>;

  return (
    <PhoneScreen>
      <AppBar title="New site survey" leading={{ to: '/tech', icon: 'close', label: 'Cancel' }} />
      <main className="phone__scroll" style={{ padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 className="t-display" style={{ padding: '0 4px' }}>
          Who is it for?
        </h1>
        <Button size="lg" variant="tonal" onClick={() => setQuickOpen(true)}>
          <Icon name="add" size={20} />
          New customer on site
        </Button>
        {open.length > 0 && (
          <section className="stack" style={{ gap: 8 }} aria-labelledby="enq">
            <h2 id="enq" className="t-section" style={{ padding: '0 4px' }}>
              New enquiries
            </h2>
            <div className="card" style={{ overflow: 'hidden' }}>
              {open.map((l) => (
                <button key={l.id} type="button" className="row" onClick={() => pick(l.id)} style={{ width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--divider)', padding: '16px 16px 16px 20px', textAlign: 'left' }}>
                  <span className="row__main">
                    <span>{l.name}</span>
                    <span className="t-small muted">
                      {l.propertyType} · {l.location}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={20} color="var(--faint)" />
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
      <QuickLeadDialog open={quickOpen} onClose={() => setQuickOpen(false)} onCreated={pick} />
    </PhoneScreen>
  );
}

function QuickLeadDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (leadId: string) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [state, setState] = useState('Lagos');
  const [propertyType, setPropertyType] = useState<PropertyType>('Home');
  const [consent, setConsent] = useState(false);
  const valid = name.trim() && phone.replace(/\D/g, '').length >= 10 && address.trim();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New customer"
      actions={
        <Button
          disabled={!valid}
          onClick={() => {
            const id = createQuickLead({ name: name.trim(), phone: phone.trim(), address: address.trim(), state, propertyType, whatsappConsent: consent });
            onClose();
            onCreated(id);
          }}
        >
          Start survey
        </Button>
      }
    >
      <TextField id="ql-name" label="Name or business" value={name} onChange={setName} />
      <TextField id="ql-phone" label="Phone" type="tel" inputMode="tel" value={phone} onChange={setPhone} placeholder="0803 123 4567" />
      <TextField id="ql-address" label="Address" value={address} onChange={setAddress} />
      <div style={{ display: 'flex', gap: 12 }}>
        <SelectField id="ql-state" label="State" value={state} onChange={setState} options={Object.keys(sunHoursByState)} style={{ flex: 1 }} />
        <SelectField id="ql-type" label="Property" value={propertyType} onChange={setPropertyType} options={['Home', 'Shop', 'Office', 'Clinic', 'School', 'Other'] as const} style={{ flex: 1 }} />
      </div>
      <label style={{ display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }} className="t-body">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 20, height: 20, margin: 0, accentColor: 'var(--primary)' }} />
        Customer agrees to updates on WhatsApp
      </label>
    </Dialog>
  );
}

const photoKinds: { kind: PhotoKind; label: string }[] = [
  { kind: 'roof', label: 'Roof' },
  { kind: 'db', label: 'DB board' },
  { kind: 'wiring', label: 'Wiring' },
];

function SurveyEditor({ survey }: { survey: Survey }) {
  const navigate = useNavigate();
  const lead = useDb((d) => d.leads.find((l) => l.id === survey.leadId));
  const [addOpen, setAddOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const locked = survey.status === 'submitted';
  const size = effectiveSize(survey.recommended, survey.override);
  const overridden = !!survey.override && Object.keys(survey.override).length > 0;
  const change = (id: string, delta: number) =>
    editSurvey(survey.id, (s) => {
      const a = s.appliances.find((x) => x.id === id)!;
      a.qty = Math.max(0, a.qty + delta);
      if (a.qty === 0) s.appliances = s.appliances.filter((x) => x.id !== id);
    });

  return (
    <PhoneScreen>
      <AppBar
        title={lead?.name ?? 'Site survey'}
        leading={{ to: '/tech', icon: 'close', label: 'Close survey' }}
        trailing={
          !locked ? (
            <Link to="/tech" className="btn btn--text" style={{ height: 40, padding: '0 12px', fontSize: 15 }}>
              Save draft
            </Link>
          ) : undefined
        }
      />

      <main className="phone__scroll" style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="stack" style={{ padding: '8px 4px 0', gap: 8 }}>
          <span className="t-small muted">{locked ? 'Submitted to office' : 'Draft · saved on this phone'}</span>
          <h1 className="t-display">What will they power?</h1>
        </div>

        <section aria-label="Result" className="card card--pad stack" style={{ gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <Stat label="Peak load" value={`${survey.peakW.toLocaleString('en-NG')} W`} size={24} />
            <Stat label="Daily energy" value={`${(survey.dailyWh / 1000).toFixed(1)} kWh`} size={24} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <SelectField
              id="state"
              label={`Location · ${survey.sunHours} sun hours`}
              value={survey.state}
              onChange={(v) =>
                !locked &&
                editSurvey(survey.id, (s) => {
                  s.state = v;
                  s.sunHours = sunHoursByState[v];
                })
              }
              options={Object.keys(sunHoursByState)}
            />
            <TextField
              id="backup"
              label="Backup hours wanted"
              type="number"
              inputMode="numeric"
              min={1}
              value={survey.backupHours}
              onChange={(v) => !locked && editSurvey(survey.id, (s) => (s.backupHours = Math.max(1, Math.min(48, Number(v) || 1))))}
            />
          </div>
          <div className="stack" style={{ padding: '12px 16px', borderRadius: 12, background: 'var(--primary-tint)', color: 'var(--on-primary-tint)', gap: 2 }} aria-live="polite">
            <span className="t-overline" style={{ color: 'inherit' }}>
              {overridden ? 'Your system' : 'Recommended'}
            </span>
            <span className="t-body" style={{ fontWeight: 500 }}>
              {size.kva} kVA inverter · {size.batteryKwh} kWh battery · {size.panels} panels
            </span>
            {!locked && (
              <button type="button" onClick={() => setSizeOpen(true)} style={{ alignSelf: 'flex-start', background: 'none', border: 0, padding: '8px 0 0', color: 'var(--primary)', fontSize: 14, fontWeight: 500 }}>
                {overridden ? 'Edit or reset' : 'Change sizes'}
              </button>
            )}
          </div>
        </section>

        <section aria-labelledby="appl" className="stack" style={{ gap: 8 }}>
          <h2 id="appl" className="t-section" style={{ padding: '0 4px' }}>
            Appliances
          </h2>
          <div className="card" style={{ padding: '4px 16px 4px 20px' }}>
            {survey.appliances.length === 0 && <p className="t-small muted">Add what the customer wants to run on solar.</p>}
            {survey.appliances.map((a) => (
              <div key={a.id} className="row" style={{ gap: 12, minHeight: 64, padding: 0 }}>
                <div className="row__main">
                  <span>{a.name}</span>
                  <span className="t-small muted">
                    {a.watts} W each · {a.hours} h a day
                  </span>
                </div>
                {!locked && (
                  <button type="button" aria-label={`Fewer ${a.name}`} className="icon-btn icon-btn--outline" onClick={() => change(a.id, -1)}>
                    <Icon name="remove" size={18} />
                  </button>
                )}
                <span style={{ width: 24, textAlign: 'center', fontSize: 16, fontWeight: 500 }}>{a.qty}</span>
                {!locked && (
                  <button type="button" aria-label={`More ${a.name}`} className="icon-btn icon-btn--outline" onClick={() => change(a.id, 1)}>
                    <Icon name="add" size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!locked && (
            <button type="button" className="btn btn--text" style={{ height: 48, alignSelf: 'flex-start' }} onClick={() => setAddOpen(true)}>
              <Icon name="add" size={20} />
              Add appliance
            </button>
          )}
        </section>

        <section aria-labelledby="sphotos" className="stack" style={{ gap: 8 }}>
          <h2 id="sphotos" className="t-section" style={{ padding: '0 4px' }}>
            Photos
          </h2>
          {photoKinds.map(({ kind, label }) => {
            const photos = survey.photos.filter((p) => p.kind === kind);
            return (
              <div key={kind} className="stack" style={{ gap: 8 }}>
                <span className="t-small muted" style={{ padding: '0 4px' }}>
                  {label}
                  {photos[0] && ` · ${new Date(photos[0].takenAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${formatGps(photos[0].gps)}`}
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  {photos.map((p, i) => (
                    <PhotoThumb key={p.id} photo={p} label={`${label} photo ${i + 1}`} onRemove={locked ? undefined : () => editSurvey(survey.id, (s) => (s.photos = s.photos.filter((x) => x.id !== p.id)))} />
                  ))}
                  {!locked && <PhotoInput kind={kind} label={label} onPhoto={(p) => editSurvey(survey.id, (s) => s.photos.push(p))} />}
                </div>
              </div>
            );
          })}
        </section>

        <SyncBanner />
      </main>

      {!locked && (
        <div className="phone__footer">
          <Button
            size="xl"
            block
            disabled={survey.appliances.length === 0}
            onClick={() => {
              submitSurvey(survey.id);
              navigate('/tech');
            }}
          >
            Send to office for quote
          </Button>
        </div>
      )}

      <AddApplianceDialog open={addOpen} onClose={() => setAddOpen(false)} onAdd={(a) => addAppliance(survey.id, a)} />
      <SizeDialog open={sizeOpen} onClose={() => setSizeOpen(false)} survey={survey} />
    </PhoneScreen>
  );
}

function AddApplianceDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (a: { name: string; watts: number; hours: number; qty: number }) => void }) {
  const [preset, setPreset] = useState(appliancePresets[0].name);
  const [name, setName] = useState('');
  const [watts, setWatts] = useState(String(appliancePresets[0].watts));
  const [hours, setHours] = useState(String(appliancePresets[0].hours));
  const [qty, setQty] = useState('1');
  const custom = preset === '__custom';

  const choose = (v: string) => {
    setPreset(v);
    const p = appliancePresets.find((x) => x.name === v);
    if (p) {
      setWatts(String(p.watts));
      setHours(String(p.hours));
    }
  };
  const finalName = custom ? name.trim() : preset;
  const valid = finalName && Number(watts) > 0 && Number(hours) > 0 && Number(qty) > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add appliance"
      actions={
        <Button
          disabled={!valid}
          onClick={() => {
            onAdd({ name: finalName, watts: Number(watts), hours: Number(hours), qty: Math.round(Number(qty)) });
            setQty('1');
            setName('');
            onClose();
          }}
        >
          Add
        </Button>
      }
    >
      <SelectField id="ap-preset" label="Appliance" value={preset} onChange={choose} options={[...appliancePresets.map((p) => p.name), { value: '__custom', label: 'Other (type it in)' }]} />
      {custom && <TextField id="ap-name" label="Name" value={name} onChange={setName} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <TextField id="ap-w" label="Watts each" type="number" inputMode="numeric" value={watts} onChange={setWatts} />
        <TextField id="ap-h" label="Hours a day" type="number" inputMode="decimal" step="0.5" value={hours} onChange={setHours} />
        <TextField id="ap-q" label="How many" type="number" inputMode="numeric" value={qty} onChange={setQty} />
      </div>
    </Dialog>
  );
}

/** E3-2: override the recommended sizes; blank means use the recommendation. */
function SizeDialog({ open, onClose, survey }: { open: boolean; onClose: () => void; survey: Survey }) {
  const rec = survey.recommended;
  const [vals, setVals] = useState<Record<'kva' | 'batteryKwh' | 'panels', string>>({ kva: '', batteryKwh: '', panels: '' });
  useEffect(() => {
    if (open) setVals({ kva: String(survey.override?.kva ?? ''), batteryKwh: String(survey.override?.batteryKwh ?? ''), panels: String(survey.override?.panels ?? '') });
  }, [open, survey.override]);

  const fields: { key: 'kva' | 'batteryKwh' | 'panels'; label: string }[] = [
    { key: 'kva', label: `Inverter kVA (suggested ${rec.kva})` },
    { key: 'batteryKwh', label: `Battery kWh (suggested ${rec.batteryKwh})` },
    { key: 'panels', label: `Panels of ${rec.panelWatts} W (suggested ${rec.panels})` },
  ];

  const save = (clear = false) => {
    editSurvey(survey.id, (s) => {
      const o: Partial<SystemSize> = {};
      if (!clear) for (const f of fields) if (vals[f.key] !== '' && Number(vals[f.key]) > 0) o[f.key] = Number(vals[f.key]);
      s.override = Object.keys(o).length ? o : undefined;
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="System size"
      actions={
        <>
          <Button variant="text" onClick={() => save(true)}>
            Use recommendation
          </Button>
          <Button onClick={() => save()}>Save</Button>
        </>
      }
    >
      {fields.map((f) => (
        <TextField key={f.key} id={`ov-${f.key}`} label={f.label} type="number" inputMode="decimal" value={vals[f.key]} placeholder={String(rec[f.key])} onChange={(v) => setVals({ ...vals, [f.key]: v })} />
      ))}
    </Dialog>
  );
}
