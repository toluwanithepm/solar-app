import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import '../../styles/office-ops.css';
import { Icon } from '../../components/Icon';
import { OfficeShell } from '../../components/OfficeShell';
import { Badge, EmptyState, PageHeader, Segmented } from '../../components/ui';
import { DAY, categoryLabel, fmtDate } from '../../data/domain';
import { useDb } from '../../data/store';

type Tab = 'register' | 'warranties';

export function Installations() {
  const db = useDb();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'warranties' ? 'warranties' : 'register';
  const [q, setQ] = useState('');
  const now = Date.now();
  const lead = (id: string) => db.leads.find((l) => l.id === id);
  const techNames = (ids: string[]) => ids.map((id) => db.users.find((u) => u.id === id)?.name.split(' ')[0] ?? '?').join(', ');
  const needle = q.trim().toLowerCase();

  const installs = [...db.installations]
    .filter((i) => !needle || lead(i.leadId)?.name.toLowerCase().includes(needle) || i.site.toLowerCase().includes(needle) || i.items.some((it) => it.serial?.toLowerCase().includes(needle)))
    .sort((a, b) => b.installedAt.localeCompare(a.installedAt));

  const expiring = db.installations
    .flatMap((i) => i.items.map((it) => ({ ins: i, it, days: Math.ceil((new Date(it.warrantyEndsAt).getTime() - now) / DAY) })))
    .filter((x) => x.days >= 0 && x.days <= 90)
    .filter((x) => !needle || lead(x.ins.leadId)?.name.toLowerCase().includes(needle) || x.it.serial?.toLowerCase().includes(needle))
    .sort((a, b) => a.days - b.days);

  return (
    <OfficeShell>
      <PageHeader title="Equipment register" subtitle={`${db.installations.length} systems installed · ${db.installations.reduce((s, i) => s + i.items.length, 0)} items under record`} />
      <div className="ops-filters">
        <Segmented
          kind="tab"
          label="Register view"
          value={tab}
          onChange={(t) => setParams(t === 'register' ? {} : { tab: t })}
          options={[
            { id: 'register', name: 'Installations' },
            { id: 'warranties', name: `Warranties ending · ${expiring.length}` },
          ]}
        />
        <label className="ops-search">
          <Icon name="search" size={16} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, site or serial" aria-label="Search customer, site or serial" />
        </label>
      </div>

      {tab === 'register' ? (
        <section className="card" aria-label="Installations">
          {installs.length === 0 ? (
            <EmptyState title="No installations found">{needle ? 'Try a different name, site or serial number.' : 'Systems are added here when an installation job is completed.'}</EmptyState>
          ) : (
            <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Site</th>
                  <th scope="col">Installed</th>
                  <th scope="col">Technicians</th>
                  <th scope="col" className="num">
                    Items
                  </th>
                  <th scope="col">Next service</th>
                  <th scope="col">Plan</th>
                </tr>
              </thead>
              <tbody>
                {installs.map((i) => {
                  const due = (new Date(i.nextServiceAt).getTime() - now) / DAY;
                  const serialHit = needle ? i.items.find((it) => it.serial?.toLowerCase().includes(needle)) : undefined;
                  return (
                    <tr key={i.id} className="row-link" onClick={() => navigate(`/office/installations/${i.id}`)}>
                      <td>
                        <Link to={`/office/installations/${i.id}`} className="cell-link">
                          {lead(i.leadId)?.name}
                        </Link>
                        {serialHit && (
                          <div className="t-caption faint">
                            Serial <span className="mono">{serialHit.serial}</span>
                          </div>
                        )}
                      </td>
                      <td className="muted">{i.site}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.installedAt)}</td>
                      <td className="muted">{techNames(i.technicianIds)}</td>
                      <td className="num">{i.items.length}</td>
                      <td>{due < 0 ? <Badge tone="red">Overdue</Badge> : due <= 7 ? <Badge tone="amber">{fmtDate(i.nextServiceAt)}</Badge> : fmtDate(i.nextServiceAt)}</td>
                      <td className="muted">{db.plans.find((p) => p.id === i.planId)?.name ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </section>
      ) : (
        <section className="card" aria-label="Warranties ending in the next 90 days">
          {expiring.length === 0 ? (
            <EmptyState title="No warranties end in the next 90 days" />
          ) : (
            <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Item</th>
                  <th scope="col">Serial</th>
                  <th scope="col">Warranty ends</th>
                  <th scope="col" className="num">
                    Days left
                  </th>
                </tr>
              </thead>
              <tbody>
                {expiring.map(({ ins, it, days }) => (
                  <tr key={it.id} className="row-link" onClick={() => navigate(`/office/installations/${ins.id}`)}>
                    <td>
                      <Link to={`/office/installations/${ins.id}`} className="cell-link">
                        {lead(ins.leadId)?.name}
                      </Link>
                    </td>
                    <td>
                      {it.label}
                      <div className="t-caption faint">{categoryLabel[it.category]}</div>
                    </td>
                    <td className="mono">{it.serial ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(it.warrantyEndsAt)}</td>
                    <td className="num">{days <= 30 ? <Badge tone="red">{days} days</Badge> : <Badge tone="amber">{days} days</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>
      )}
    </OfficeShell>
  );
}
