import '../../../styles/settings-auth.css';
import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Dialog, SelectField, TextField } from '../../../components/forms';
import { Badge, Button } from '../../../components/ui';
import { fmtDateTime, roleLabel } from '../../../data/domain';
import { saveStaff } from '../../../data/settingsActions';
import { isBackend, uid, update, useCurrentUser, useDb } from '../../../data/store';
import { signOutStaffEverywhere } from '../../../data/remote/sync';
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
                  {u.signedOutAt && <div className="t-caption faint">Signed out of all phones {fmtDateTime(u.signedOutAt)}</div>}
                </td>
                <td className="muted num">{u.phone}</td>
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

      {editing && (
        <StaffDialog
          user={editing}
          isNew={!users.some((u) => u.id === editing.id)}
          isMe={editing.id === me?.id}
          lastOwner={editing.role === 'owner' && owners <= 1}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function StaffDialog({ user, isNew, isMe, lastOwner, onClose }: { user: User; isNew: boolean; isMe: boolean; lastOwner: boolean; onClose: () => void }) {
  const [u, setU] = useState(user);
  const [wipe, setWipe] = useState<'idle' | 'confirm' | 'working' | 'done'>('idle');
  const [wipeError, setWipeError] = useState('');
  const signOutEverywhere = async () => {
    setWipe('working');
    setWipeError('');
    if (isBackend) {
      const { error } = await signOutStaffEverywhere(user.id);
      if (error) {
        setWipeError(error);
        setWipe('confirm');
        return;
      }
    } else {
      // Demo: record it the way the server would
      update((d) => {
        const x = d.users.find((y) => y.id === user.id);
        if (x) x.signedOutAt = new Date().toISOString();
      });
    }
    // Keep the stamp if the owner presses Save afterwards
    setU((x) => ({ ...x, signedOutAt: new Date().toISOString() }));
    setWipe('done');
  };
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
      {!isNew && !isMe && (
        <div className="stack" style={{ gap: 8, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
          <span className="t-section">Lost or stolen phone</span>
          {wipe === 'done' ? (
            <div className="notice notice--success" role="status">
              <Icon name="checkCircle" size={18} />
              <span>
                {user.name} is signed out everywhere. Their phones delete the job data saved on them as soon as they connect. They can sign in again on a new
                phone with a fresh code.
              </span>
            </div>
          ) : wipe === 'idle' ? (
            <>
              <span className="t-small muted">
                Signs {user.name} out of every phone and deletes the customer and job data saved on those phones. Anything they changed offline and haven't sent
                yet is lost.
              </span>
              <span>
                <Button variant="danger" size="sm" onClick={() => setWipe('confirm')}>
                  <Icon name="logout" size={16} />
                  Sign out of all phones
                </Button>
              </span>
            </>
          ) : (
            <div className="notice notice--danger" role="alert">
              <Icon name="warning" size={18} />
              <div className="stack" style={{ gap: 10 }}>
                <span>Sign {user.name} out of all phones now? Anything they haven't sent yet will be lost.</span>
                {wipeError && <span className="strong">{wipeError}</span>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button variant="danger" size="sm" disabled={wipe === 'working'} onClick={signOutEverywhere}>
                    {wipe === 'working' ? 'Signing out…' : 'Yes, sign out and wipe'}
                  </Button>
                  <Button variant="text" size="sm" disabled={wipe === 'working'} onClick={() => setWipe('idle')}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
