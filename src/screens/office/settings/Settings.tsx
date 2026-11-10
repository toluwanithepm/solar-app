import '../../../styles/settings-auth.css';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Icon, type IconName } from '../../../components/Icon';
import { OfficeShell } from '../../../components/OfficeShell';
import { PageHeader } from '../../../components/ui';
import { can, type Permission } from '../../../data/domain';
import { useCurrentUser } from '../../../data/store';
import { AuditLog } from './AuditLog';
import { Billing } from './Billing';
import { Checklists } from './Checklists';
import { CompanySettings } from './Company';
import { Messages } from './Messages';
import { PriceList } from './PriceList';
import { Staff } from './Staff';

const tabs: { path: string; label: string; icon: IconName; description: string; perm?: Permission }[] = [
  { path: 'company', label: 'Company', icon: 'settings', description: 'Profile, logo, bank details and quote defaults' },
  { path: 'prices', label: 'Price list', icon: 'money', description: 'Equipment and services with costs, prices and warranties' },
  { path: 'staff', label: 'Staff and roles', icon: 'people', description: 'Invite your team and control what each role can do', perm: 'manage.staff' },
  { path: 'billing', label: 'Subscription', icon: 'receipt', description: 'Your plan, technician seats and payments', perm: 'manage.billing' },
  { path: 'checklists', label: 'Checklists', icon: 'checkCircle', description: 'Steps technicians tick off for each job type' },
  { path: 'messages', label: 'Messages', icon: 'message', description: 'Every WhatsApp and SMS sent to customers and staff' },
  { path: 'audit', label: 'Audit log', icon: 'history', description: 'Who changed quotes, prices and payments, and when', perm: 'view.audit' },
];

export function Settings() {
  const user = useCurrentUser();
  const { pathname } = useLocation();
  const visible = tabs.filter((t) => !t.perm || can(user?.role, t.perm));
  const section = pathname.replace(/^\/office\/settings\/?/, '').split('/')[0];
  const current = tabs.find((t) => t.path === section);

  return (
    <OfficeShell>
      {current ? (
        <>
          <PageHeader title={current.label} subtitle={current.description} back={{ to: '/office/settings', label: 'Settings' }} />
          <nav aria-label="Settings sections" className="set-tabs">
            {visible.map((t) => (
              <NavLink key={t.path} to={`/office/settings/${t.path}`} className="set-tabs__item">
                {t.label}
              </NavLink>
            ))}
          </nav>
        </>
      ) : (
        <PageHeader title="Settings" subtitle="Manage your company, team, prices and subscription." />
      )}
      <Routes>
        <Route
          index
          element={
            <nav aria-label="Settings sections" className="set-grid">
              {visible.map((t) => (
                <Link key={t.path} to={`/office/settings/${t.path}`} className="card set-card">
                  <span className="set-card__icon" aria-hidden="true">
                    <Icon name={t.icon} size={20} />
                  </span>
                  <span className="set-card__text">
                    <span className="t-section">{t.label}</span>
                    <span className="t-small muted">{t.description}</span>
                  </span>
                  <span className="set-card__chev" aria-hidden="true" style={{ display: 'inline-flex' }}>
                    <Icon name="chevronRight" size={18} />
                  </span>
                </Link>
              ))}
            </nav>
          }
        />
        <Route path="company" element={<CompanySettings />} />
        <Route path="prices" element={<PriceList />} />
        <Route path="staff" element={<Guarded perm="manage.staff"><Staff /></Guarded>} />
        <Route path="billing" element={<Guarded perm="manage.billing"><Billing /></Guarded>} />
        <Route path="checklists" element={<Checklists />} />
        <Route path="messages" element={<Messages />} />
        <Route path="audit" element={<Guarded perm="view.audit"><AuditLog /></Guarded>} />
        <Route path="*" element={<Navigate to="/office/settings" replace />} />
      </Routes>
    </OfficeShell>
  );
}

function Guarded({ perm, children }: { perm: Permission; children: React.ReactNode }) {
  const user = useCurrentUser();
  return can(user?.role, perm) ? <>{children}</> : <p className="t-body muted">Only the owner can see this.</p>;
}
