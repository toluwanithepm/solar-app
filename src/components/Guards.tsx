import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { can, type Permission } from '../data/domain';
import { useCurrentUser } from '../data/store';

/** Route guard: signed in and holding a permission (E11-1). Technicians are sent to their app, office roles to the dashboard. */
export function RequirePermission({ perm, children }: { perm: Permission; children: ReactNode }) {
  const user = useCurrentUser();
  const location = useLocation();
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  if (!can(user.role, perm)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

export const homeFor = (role: string) => (role === 'technician' ? '/tech' : '/office');

/** Renders children only for roles with the permission; used to hide costs, margins and edit controls. */
export function IfCan({ perm, children, fallback = null }: { perm: Permission; children: ReactNode; fallback?: ReactNode }) {
  const user = useCurrentUser();
  return <>{can(user?.role, perm) ? children : fallback}</>;
}

export function useCan(perm: Permission) {
  const user = useCurrentUser();
  return can(user?.role, perm);
}
