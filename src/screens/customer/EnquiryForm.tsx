import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { SelectField, TextArea, TextField } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { PhoneScreen } from '../../components/PhoneScreen';
import { Button } from '../../components/ui';
import { sunHoursByState } from '../../data/domain';
import { createLead } from '../../data/salesActions';
import type { EnquireResponse, FirmResponse } from '../../../supabase/functions/_shared/contract';
import { fromRemote } from '../../data/remote/mapping';
import { callPublic } from '../../data/remote/publicApi';
import { isBackend, useDb } from '../../data/store';
import type { Company, PropertyType } from '../../data/types';
import { ConsentCheckbox } from '../office/Leads';
import { BrandHeader } from './CustomerQuote';

const propertyTypes: PropertyType[] = ['Home', 'Shop', 'Office', 'Clinic', 'School', 'Other'];

/** E2-3: public enquiry form for the firm's social media pages. Creates a New lead and notifies staff. */
export function EnquiryForm() {
  const { firmToken } = useParams();
  const localCompany = useDb((d) => d.company);
  // Backend mode: the form link carries the firm's enquiry token (/enquire/<token>)
  const [remote, setRemote] = useState<{ company?: Company; state: 'loading' | 'ready' | 'invalid' }>({ state: isBackend ? 'loading' : 'ready' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isBackend) return;
    if (!firmToken) return setRemote({ state: 'invalid' });
    callPublic<FirmResponse>({ action: 'firm', firmToken })
      .then((r) => {
        const firmId = String(r.tables.firms[0]?.id ?? '');
        const company = fromRemote(r.tables, { firmId, staffId: '', role: 'viewer' }, (b, p) => r.files[`${b}/${p}`] ?? '').company;
        setRemote({ company, state: 'ready' });
      })
      .catch(() => setRemote({ state: 'invalid' }));
  }, [firmToken]);
  const company = isBackend ? (remote.company ?? localCompany) : localCompany;
  const [f, setF] = useState({ name: '', phone: '', location: '', state: 'Lagos', propertyType: 'Home' as PropertyType, notes: '', whatsappConsent: false });
  const [done, setDone] = useState(false);
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const valid = f.name.trim() && f.phone.replace(/\D/g, '').length >= 10 && f.location.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    if (isBackend) {
      setBusy(true);
      setError('');
      try {
        await callPublic<EnquireResponse>({ action: 'enquire', firmToken: firmToken!, name: f.name.trim(), phone: f.phone.trim(), location: f.location.trim(), propertyType: f.propertyType, whatsappConsent: f.whatsappConsent, notes: f.notes || undefined });
        setDone(true);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    createLead({ name: f.name.trim(), phone: f.phone.trim(), location: f.location.trim(), address: f.location.trim(), state: f.state, source: 'Web form', propertyType: f.propertyType, notes: f.notes || undefined, whatsappConsent: f.whatsappConsent }, true);
    setDone(true);
  };

  if (remote.state !== 'ready') {
    return (
      <PhoneScreen fixed={false}>
        <main style={{ padding: '64px 20px' }} className="stack" role="status">
          {remote.state === 'loading' ? (
            <span className="t-body muted">Loading…</span>
          ) : (
            <>
              <h1 className="t-display">This form link isn't valid</h1>
              <p className="t-body muted">Ask the installer for their current enquiry link.</p>
            </>
          )}
        </main>
      </PhoneScreen>
    );
  }

  return (
    <PhoneScreen fixed={false}>
      <BrandHeader company={company} />
      {done ? (
        <main style={{ padding: '48px 20px', display: 'flex', flexDirection: 'column', gap: 12 }} aria-live="polite">
          <Icon name="checkCircle" size={40} color="var(--success)" />
          <h1 className="t-display">Thank you, {f.name.split(' ')[0]}</h1>
          <p className="t-body muted" style={{ margin: 0 }}>
            {company.name} has your request and will call you on {f.phone} to arrange a free site survey.
          </p>
        </main>
      ) : (
        <form onSubmit={submit} style={{ padding: '32px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="stack" style={{ padding: '0 4px', gap: 8 }}>
            <h1 className="t-display">Get a solar quote</h1>
            <span className="t-body muted">Tell us a little about your place. We'll call you to book a free site survey.</span>
          </div>
          <div className="card stack" style={{ padding: 20, gap: 16 }}>
            <TextField id="enq-name" label="Your name" value={f.name} onChange={set('name')} required />
            <TextField id="enq-phone" label="Phone number" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="0803 123 4567" required />
            <TextField id="enq-loc" label="Area or address" value={f.location} onChange={set('location')} placeholder="e.g. Allen Avenue, Ikeja" required />
            <SelectField id="enq-state" label="State" value={f.state} onChange={set('state')} options={Object.keys(sunHoursByState)} />
            <SelectField id="enq-prop" label="Type of property" value={f.propertyType} onChange={set('propertyType')} options={propertyTypes} />
            <TextArea id="enq-notes" label="What do you want to power? (optional)" value={f.notes} onChange={set('notes')} placeholder="e.g. Fridge, fans, TV and lights during NEPA outages" />
            <ConsentCheckbox checked={f.whatsappConsent} onChange={set('whatsappConsent')} label={`Send me my quote and updates on WhatsApp`} />
          </div>
          <span className="t-small muted" style={{ padding: '0 4px' }}>
            {company.name} uses your details only to respond to this request. Ask any time and we'll delete them.
          </span>
          {error && (
            <span role="alert" className="t-small danger" style={{ padding: '0 4px' }}>
              {error}
            </span>
          )}
          <Button type="submit" size="xl" disabled={!valid || busy}>
            {busy ? 'Sending…' : 'Send request'}
          </Button>
        </form>
      )}
    </PhoneScreen>
  );
}
