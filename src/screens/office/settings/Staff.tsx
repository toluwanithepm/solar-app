import '../../../styles/settings-auth.css';
import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Dialog, SelectField, TextField } from '../../../components/forms';
import { Badge, Button } from '../../../components/ui';
import { roleLabel } from '../../../data/domain';
import { saveStaff } from '../../../data/settingsActions';
import { uid, useCurrentUser, useDb } from '../../../data/store';
import type { Role, User } from '../../../data/types';

const roles: Role[] = ['owner', 'office', 'technician', 'viewer'];

const matrix: [string, Record<Role, boolean>][] = [
  ['Office dashboard and reports', { owner: true, office: true, technician: false, viewer: true }],
  ['Leads, quotes and scheduling', { owner: true, office: true, technician: false, viewer: false }],
  ['Record cash and bank payments', { owner: true, office: true, technician: false, viewer: false }],
  ['See costs and margins', { owner: true, office: false, technician: false, viewer: false }],
  ['Edit the price list', { owner: true, office: false, technician: false, viewer: false }],
  ['Approve payments', { owner: true, office: false, technician: false, viewer: false }],
  ['Staff, subscription and audit log', { owner: true, office: false, technician: false, viewer: false }],
  ['Technician app: jobs, surveys, sign-off', { owner: true, office: false, technician: true, viewer: false }],
];

export function Staff() {
  const users = useDb((d) => d.users);
  const me = useCurrentUser();
  const [editing, setEditing] = useState<User | null>(null);
  const owners = users.filter((u) => u.role === 'owner' && u.active).length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" aria-labelledby="st">
        <div className="card__head">
          <div className="stack" style={{ gap: 2 }}>
            <h2 id="st" className="t-section-lg">
              Staff
            </h2>
            <span className="t-small muted">{users.filter((u) => u.active).length} active</span>
          </div>
          <Button size="sm" onClick={() => setEditing({ id: uid('u_'), name: '', phone: '', role: 'technician', title: '', active: true })}>
            <Icon name="add" size={18} />
            Add staff
          </Button>
        </div>
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Phone</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ opacity: u.active ? 1 : 0.6 }}>
                <td>
                  <span className="strong">{u.name}</span>
                  {u.id === me?.id && <span className="muted"> (you)</span>}
                  <div className="t-caption faint">{u.title}</div>
                </td>
                <td className="muted num" style={{ textAlign: 'left' }}>{u.phone}</td>
                <td>{roleLabel[u.role]}</td>
                <td>{u.active ? <Badge tone="green">Active</Badge> : <Badge>Deactivated</Badge>}</td>
                <td className="num">
                  <button type="button" className="icon-btn" aria-label={`Edit ${u.name}`} onClick={() => setEditing(u)} style={{ width: 32, height: 32 }}>
                    <Icon name="edit" size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <section className="card" aria-labelledby="perm">
        <div className="card__head">
          <div className="stack" style={{ gap: 2 }}>
            <h2 id="perm" className="t-section-lg">
              What each role can do
            </h2>
            <span className="t-small muted">Technicians never receive cost or margin data on their phones.</span>
          </div>
        </div>
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Permission</th>
              {roles.map((r) => (
                <th key={r} scope="col" style={{ textAlign: 'center' }}>
                  {roleLabel[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map(([label, allowed]) => (
              <tr key={label}>
                <td>{label}</td>
                {roles.map((r) => (
                  <td key={r} style={{ textAlign: 'center' }}>
                    {allowed[r] ? (
                      <span role="img" aria-label="Yes" style={{ display: 'inline-flex' }}>
                        <Icon name="check" size={18} color="var(--success)" />
                      </span>
                    ) : (
                      <span className="faint" aria-label="No">
                        —
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      {editing && <StaffDialog user={editing} isNew={!users.some((u) => u.id === editing.id)} lastOwner={editing.role === 'owner' && owners <= 1} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StaffDialog({ user, isNew, lastOwner, onClose }: { user: User; isNew: boolean; lastOwner: boolean; onClose: () => void }) {
  const [u, setU] = useState(user);
  const phoneOk = /^0[789][01]\d{8}$/.test(u.phone.replace(/\s/g, ''));
  const valid = u.name.trim() && phoneOk;
  const save = (next: User) => {
    saveStaff(next);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Add staff' : `Edit ${user.name}`}
      actions={
        <>
          {!isNew && !lastOwner && (
            <Button variant="text" onClick={() => save({ ...u, active: !u.active })}>
              {u.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          )}
          <Button disabled={!valid} onClick={() => save({ ...u, name: u.name.trim(), phone: u.phone.replace(/\s/g, ''), title: u.title.trim() || roleLabel[u.role] })}>
            {isNew ? 'Add and send invite' : 'Save'}
          </Button>
        </>
      }
    >
      <TextField id="sf-name" label="Full name" value={u.name} onChange={(v) => setU({ ...u, name: v })} />
      <TextField id="sf-phone" label="Phone number" type="tel" inputMode="tel" value={u.phone} onChange={(v) => setU({ ...u, phone: v })} hint={u.phone && !phoneOk ? 'Use an 11-digit Nigerian mobile number, e.g. 08031234567' : 'They sign in with this number and a one-time code'} />
      <SelectField id="sf-role" label="Role" value={u.role} onChange={(r) => setU({ ...u, role: r })} options={roles.filter((r) => !lastOwner || r === 'owner').map((r) => ({ value: r, label: roleLabel[r] }))} />
      <TextField id="sf-title" label="Job title" value={u.title} onChange={(v) => setU({ ...u, title: v })} placeholder="e.g. Installer" />
      {lastOwner && <span className="t-small muted">This is the only owner, so the role can't change.</span>}
    </Dialog>
  );
}
