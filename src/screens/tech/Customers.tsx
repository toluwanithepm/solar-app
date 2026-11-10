import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { PhoneScreen, SyncBanner, TechBottomNav } from '../../components/PhoneScreen';
import { Button, EmptyState } from '../../components/ui';
import { mapsLink, whatsappLink } from '../../data/domain';
import { useCurrentUser, useDb } from '../../data/store';
import { AccountButton } from './parts';

/** Customers the technician has worked for or is booked with. No prices are shown (NFR-10). */
export function TechCustomers() {
  const user = useCurrentUser();
  const jobs = useDb((d) => d.jobs);
  const leads = useDb((d) => d.leads);
  const installations = useDb((d) => d.installations);
  const [q, setQ] = useState('');

  const ids = new Set(jobs.filter((j) => user && j.assigneeIds.includes(user.id)).map((j) => j.leadId));
  const list = leads
    .filter((l) => ids.has(l.id) && (!q || `${l.name} ${l.location} ${l.phone}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <PhoneScreen>
      <header className="p-head">
        <div className="p-head__title">
          <h1 className="t-display">Customers</h1>
        </div>
        <AccountButton />
      </header>
      <SyncBanner inset />
      <div style={{ padding: '0 16px 12px', flexShrink: 0 }}>
        <label className="p-search">
          <Icon name="search" size={20} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, area or phone" aria-label="Search customers" />
        </label>
      </div>
      <main className="phone__scroll p-main" style={{ gap: 12 }}>
        {list.length === 0 && <div className="card">{q ? <EmptyState title="No matches">Try a different name, area or phone number.</EmptyState> : <EmptyState title="No customers yet">Customers from your jobs show here.</EmptyState>}</div>}
        {list.map((l) => {
          const ins = installations.find((i) => i.leadId === l.id);
          return (
            <section key={l.id} className="card card--pad stack" style={{ gap: 12 }} aria-label={l.name}>
              <div className="stack" style={{ gap: 2 }}>
                <span className="t-section-lg">{l.name}</span>
                <span className="t-small muted">{l.address}</span>
                {ins && (
                  <span className="t-small faint">
                    System installed {new Date(ins.installedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} · {ins.items.length} items · next service{' '}
                    {new Date(ins.nextServiceAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="tonal" size="md" href={`tel:${l.phone}`}>
                  <Icon name="phone" size={20} />
                  Call
                </Button>
                {l.whatsappConsent && (
                  <Button variant="tonal" size="md" href={whatsappLink(l.phone, `Hello ${l.name}, `)}>
                    <Icon name="whatsapp" size={20} />
                    WhatsApp
                  </Button>
                )}
                <Button variant="tonal" size="md" href={mapsLink(l.address)}>
                  <Icon name="directions" size={20} />
                  Directions
                </Button>
                {(l.stage === 'New' || l.stage === 'Surveyed') && (
                  <Button variant="text" size="md" to={`/tech/survey/new?leadId=${l.id}`}>
                    Survey
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </main>
      <TechBottomNav />
    </PhoneScreen>
  );
}
