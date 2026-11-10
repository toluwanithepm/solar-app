import '../../../styles/settings-auth.css';
import { useEffect, useRef, useState } from 'react';
import { useCan } from '../../../components/Guards';
import { Icon } from '../../../components/Icon';
import { Dialog, MoneyField, SelectField, TextField } from '../../../components/forms';
import { Button, Logo } from '../../../components/ui';
import { sunHoursByState } from '../../../data/domain';
import { supabase } from '../../../data/remote/sync';
import { saveCompany } from '../../../data/settingsActions';
import { isBackend, resetDemoData, useDb } from '../../../data/store';
import type { Company } from '../../../data/types';
import { compressImage } from '../../../lib/photos';

export function CompanySettings() {
  const saved = useDb((d) => d.company);
  const canEdit = useCan('manage.settings');
  const [c, setC] = useState<Company>(saved);
  const [status, setStatus] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Company>(k: K, v: Company[K]) => {
    setC({ ...c, [k]: v });
    setStatus('');
  };
  const num = (k: 'followUpDays' | 'serviceIntervalMonths' | 'defaultDepositPct' | 'defaultValidDays') => ({
    value: String(c[k]),
    onChange: (v: string) => set(k, Math.max(0, Number(v) || 0)),
  });
  const dirty = JSON.stringify(c) !== JSON.stringify(saved);

  return (
    <form
      className="stack"
      style={{ gap: 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        saveCompany(c);
        setStatus('Saved');
      }}
    >
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="card card--pad stack" style={{ gap: 20 }} aria-labelledby="co">
          <div className="stack" style={{ gap: 2 }}>
            <h2 id="co" className="t-section-lg">
              Company profile
            </h2>
            <span className="t-small muted">Your logo and name appear on quotes, payment links and handover reports.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {c.logoDataUrl ? <img src={c.logoDataUrl} alt="Company logo" className="set-logo" /> : <Logo />}
            <Button variant="tonal" size="sm" onClick={() => fileRef.current?.click()} disabled={!canEdit}>
              <Icon name="upload" size={18} />
              {c.logoDataUrl ? 'Change logo' : 'Upload logo'}
            </Button>
            {c.logoDataUrl && (
              <Button variant="text" size="sm" onClick={() => set('logoDataUrl', undefined)} disabled={!canEdit}>
                Remove
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) set('logoDataUrl', (await compressImage(f)).dataUrl);
              }}
            />
          </div>
          <div className="grid-auto">
            <TextField id="co-name" label="Company name" value={c.name} onChange={(v) => set('name', v)} required />
            <TextField id="co-phone" label="Phone" type="tel" value={c.phone} onChange={(v) => set('phone', v)} />
            <TextField id="co-addr" label="Address" value={c.address} onChange={(v) => set('address', v)} />
            <SelectField id="co-state" label="State" value={c.state} onChange={(v) => set('state', v)} options={Object.keys(sunHoursByState)} hint="Sets sun hours for system sizing" />
          </div>
        </section>

        <section className="card card--pad stack" style={{ gap: 20 }} aria-labelledby="bank">
          <div className="stack" style={{ gap: 2 }}>
            <h2 id="bank" className="t-section-lg">
              Bank details
            </h2>
            <span className="t-small muted">Shown to customers who pay by bank transfer.</span>
          </div>
          <div className="grid-auto">
            <TextField id="co-bank" label="Bank" value={c.bankName} onChange={(v) => set('bankName', v)} />
            <TextField id="co-acct" label="Account number" inputMode="numeric" value={c.accountNumber} onChange={(v) => set('accountNumber', v.replace(/\D/g, '').slice(0, 10))} />
            <TextField id="co-acname" label="Account name" value={c.accountName} onChange={(v) => set('accountName', v)} />
          </div>
        </section>

        <section className="card card--pad stack" style={{ gap: 20 }} aria-labelledby="def">
          <div className="stack" style={{ gap: 2 }}>
            <h2 id="def" className="t-section-lg">
              Quotes and follow-ups
            </h2>
            <span className="t-small muted">Defaults for new quotes, reminders and service visits.</span>
          </div>
          <div className="grid-auto">
            <MoneyField id="co-lab" label="Labour price" value={c.labourPrice} onChange={(v) => set('labourPrice', Math.max(0, v))} />
            <MoneyField id="co-tr" label="Transport price" value={c.transportPrice} onChange={(v) => set('transportPrice', Math.max(0, v))} />
            <TextField id="co-dep" label="Default deposit (%)" type="number" min={0} {...num('defaultDepositPct')} />
            <TextField id="co-valid" label="Quote valid for (days)" type="number" min={1} {...num('defaultValidDays')} />
            <TextField id="co-fu" label="Follow up quotes after (days)" type="number" min={1} {...num('followUpDays')} />
            <TextField id="co-svc" label="Service every (months)" type="number" min={1} {...num('serviceIntervalMonths')} hint="For new installations without a plan" />
          </div>
        </section>
      </fieldset>

      {canEdit && (
        <div className="set-actionbar">
          <Button type="submit" disabled={!dirty || !c.name.trim()}>
            Save changes
          </Button>
          {dirty && (
            <Button variant="text" onClick={() => setC(saved)}>
              Discard
            </Button>
          )}
          <span role="status" className="t-small success" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {status && <Icon name="checkCircle" size={16} />}
            {status}
          </span>
          <span style={{ flexGrow: 1 }} />
          {!isBackend && (
            <Button variant="text" onClick={() => setConfirmReset(true)}>
              Reset demo data
            </Button>
          )}
        </div>
      )}

      {isBackend && <EnquiryLink />}

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset demo data?"
        actions={
          <>
            <Button variant="text" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                resetDemoData();
                setConfirmReset(false);
                window.location.reload();
              }}
            >
              Reset
            </Button>
          </>
        }
      >
        <p className="t-body muted" style={{ margin: 0 }}>
          This replaces every lead, quote, job, payment and setting on this device with the sample data.
        </p>
      </Dialog>
    </form>
  );
}

/** E2-3: the firm's public enquiry form link, for its social media pages (backend mode). */
function EnquiryLink() {
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void supabase()
      .from('firms')
      .select('enquiry_token')
      .single()
      .then(({ data }) => setToken(String(data?.enquiry_token ?? '')));
  }, []);
  const url = token ? `${window.location.origin}/enquire/${token}` : '';
  return (
    <section className="card card--pad stack" style={{ gap: 16 }} aria-labelledby="enq">
      <div className="stack" style={{ gap: 2 }}>
        <h2 id="enq" className="t-section-lg">
          Enquiry form link
        </h2>
        <span className="t-small muted">Share this on your social media pages. Each enquiry becomes a new lead and notifies your team.</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <a href={url || undefined} target="_blank" rel="noreferrer" className="t-small" style={{ wordBreak: 'break-all', flex: '1 1 260px', padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        {url || 'Loading…'}
      </a>
        <Button
          variant="tonal"
          size="sm"
          disabled={!url}
          onClick={() => {
            navigator.clipboard?.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
    </section>
  );
}
