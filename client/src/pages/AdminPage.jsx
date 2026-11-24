import { useState } from 'react';
import { api } from '../lib/api';
import { roleLabel } from '../lib/format';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button } from '../components/ui/Button';
import { Checkbox, Select, TextInput } from '../components/ui/Field';
import { Alert, Badge, EmptyState, PageLoader } from '../components/ui/Feedback';
import { ConfirmDialog, Modal } from '../components/ui/Modal';

function EditUserModal({ person, groups, isSelf, onClose, onSaved }) {
  const { notify } = useToast();
  const [role, setRole] = useState(person?.role);
  const [active, setActive] = useState(person?.active);
  const [groupIds, setGroupIds] = useState(person?.groupIds || []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const toggle = (id) => setGroupIds((ids) => (ids.includes(id) ? ids.filter((g) => g !== id) : [...ids, id]));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api(`/users/${person.id}`, { method: 'PUT', body: { role, active, groupIds } });
      notify(`${person.name} was updated.`);
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${person.name}`}
      description={person.email}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save changes</Button>
        </>
      }
    >
      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        <Select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={isSelf}
          hint={isSelf ? 'You cannot change your own role.' : 'Event Planners can create events and manage ones they organize or that are shared with their groups. Admins can manage everything.'}
        >
          <option value="user">Member</option>
          <option value="planner">Event Planner</option>
          <option value="admin">Admin</option>
        </Select>
        <Checkbox
          label="Account active"
          description={isSelf ? 'You cannot deactivate your own account.' : 'Inactive accounts cannot sign in and are signed out immediately.'}
          checked={active}
          disabled={isSelf}
          onChange={(e) => setActive(e.target.checked)}
        />
        <div>
          <p className="mb-2 text-sm font-medium text-ink-700">Groups</p>
          {groups.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {groups.map((g) => <Checkbox key={g.id} label={g.name} checked={groupIds.includes(g.id)} onChange={() => toggle(g.id)} />)}
            </div>
          ) : (
            <p className="text-sm text-ink-500">No groups yet. Create one in the Groups tab.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function UsersTab({ groups, reloadGroups }) {
  const { user } = useAuth();
  const people = useApi('/users');
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('');
  const groupName = Object.fromEntries(groups.map((g) => [g.id, g.name]));

  if (people.loading && !people.data) return <PageLoader label="Loading users" />;
  if (people.error) return <Alert>{people.error.message}</Alert>;

  const term = filter.trim().toLowerCase();
  const shown = people.data.filter((p) => !term || p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term));

  return (
    <>
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name or email"
        aria-label="Filter users"
        className="mb-4 h-10 w-full max-w-sm rounded-lg border border-ink-300 bg-white px-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
      <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
        <table className="min-w-full divide-y divide-ink-200 text-sm">
          <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              <th scope="col" className="px-4 py-3">Name</th>
              <th scope="col" className="px-4 py-3">Role</th>
              <th scope="col" className="hidden px-4 py-3 md:table-cell">Groups</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {shown.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-ink-900">{p.name}{p.id === user.id && <span className="ml-2 text-xs font-normal text-ink-500">(you)</span>}</p>
                  <p className="text-xs text-ink-500">{p.email}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={p.role === 'admin' ? 'danger' : p.role === 'planner' ? 'brand' : 'neutral'}>{roleLabel[p.role]}</Badge>
                    {!p.active && <Badge tone="warning">Inactive</Badge>}
                  </div>
                </td>
                <td className="hidden px-4 py-3 text-ink-600 md:table-cell">
                  {p.groupIds.length ? p.groupIds.map((g) => groupName[g]).filter(Boolean).join(', ') : <span className="text-ink-400">None</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-500">No users match that filter.</p>}
      </div>
      {editing && (
        <EditUserModal
          person={editing}
          groups={groups}
          isSelf={editing.id === user.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); people.reload(); reloadGroups(); }}
        />
      )}
    </>
  );
}

function GroupsTab({ groups }) {
  const { notify } = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [deleting, setDeleting] = useState(null);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const g = await api('/groups', { method: 'POST', body: { name } });
      groups.setData((list) => [...list, g].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      notify(`Group ${g.name} was created.`);
    } catch (err) {
      setError(err.fields?.name || err.message);
    } finally {
      setBusy(false);
    }
  };

  const rename = async (e) => {
    e.preventDefault();
    try {
      const g = await api(`/groups/${renaming.id}`, { method: 'PUT', body: { name: renaming.name } });
      groups.setData((list) => list.map((x) => (x.id === g.id ? { ...x, name: g.name } : x)));
      setRenaming(null);
      notify('Group renamed.');
    } catch (err) {
      notify(err.fields?.name || err.message, 'error');
    }
  };

  const remove = async () => {
    try {
      await api(`/groups/${deleting.id}`, { method: 'DELETE' });
      groups.setData((list) => list.filter((x) => x.id !== deleting.id));
      notify(`Group ${deleting.name} was deleted.`, 'info');
    } catch (err) {
      notify(err.message, 'error');
    }
    setDeleting(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <form onSubmit={create} className="h-fit space-y-4 rounded-xl border border-ink-200 bg-white p-5 shadow-card" noValidate>
        <h2 className="text-base font-semibold text-ink-900">New group</h2>
        <TextInput label="Group name" value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={100} required />
        <Button type="submit" loading={busy} disabled={!name.trim()}>Create group</Button>
        <p className="text-xs text-ink-500">Groups control who can see restricted events. Add people to groups from the Users tab.</p>
      </form>

      <div className="lg:col-span-2">
        {groups.data.length === 0 ? (
          <EmptyState title="No groups yet">Create a group to start sharing restricted events with it.</EmptyState>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200 bg-white shadow-card">
            {groups.data.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-5 py-3">
                {renaming?.id === g.id ? (
                  <form onSubmit={rename} className="flex flex-1 items-center gap-2">
                    <input
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                      aria-label="New group name"
                      className="h-9 flex-1 rounded-lg border border-ink-300 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                    <Button size="sm" type="submit">Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    <div className="flex-1">
                      <p className="font-medium text-ink-900">{g.name}</p>
                      <p className="text-xs text-ink-500">{g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: g.id, name: g.name })}>Rename</Button>
                    <Button size="sm" variant="danger-ghost" onClick={() => setDeleting(g)}>Delete</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog open={Boolean(deleting)} title="Delete this group?" confirmLabel="Delete group" onConfirm={remove} onCancel={() => setDeleting(null)}>
        Members of <strong className="text-ink-900">{deleting?.name}</strong> will lose access to restricted events
        that were shared only with this group.
      </ConfirmDialog>
    </div>
  );
}

export function AdminPage() {
  const [tab, setTab] = useState('users');
  const groups = useApi('/groups');

  const tabClass = (name) =>
    `border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
      tab === name ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'
    }`;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink-900 sm:text-3xl">Users and groups</h1>
      <p className="mt-1 text-sm text-ink-500">Assign roles and manage the groups used for restricted events.</p>

      <div className="mt-6 flex gap-6 border-b border-ink-200" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'users'} className={tabClass('users')} onClick={() => setTab('users')}>Users</button>
        <button type="button" role="tab" aria-selected={tab === 'groups'} className={tabClass('groups')} onClick={() => setTab('groups')}>Groups</button>
      </div>

      <div className="mt-6" role="tabpanel">
        {groups.error && <Alert>{groups.error.message}</Alert>}
        {!groups.data && !groups.error && <PageLoader />}
        {groups.data && tab === 'users' && <UsersTab groups={groups.data} reloadGroups={groups.reload} />}
        {groups.data && tab === 'groups' && <GroupsTab groups={groups} />}
      </div>
    </div>
  );
}
