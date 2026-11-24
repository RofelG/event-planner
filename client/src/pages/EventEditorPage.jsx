import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { fromLocalInput, toLocalInput } from '../lib/format';
import { useApi } from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Button } from '../components/ui/Button';
import { Checkbox, Select, TextArea, TextInput } from '../components/ui/Field';
import { Alert, EmptyState, PageLoader } from '../components/ui/Feedback';

const blank = {
  name: '', description: '', location: '', start: '', end: '', capacity: '', cost: '0',
  typeId: '', visibility: 'public', groupIds: [], inviteIds: [],
};

function Section({ title, description, children }) {
  return (
    <section className="grid gap-6 border-b border-ink-100 py-8 first:pt-0 last:border-0 md:grid-cols-3">
      <div>
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        <p className="mt-1 text-sm text-ink-500">{description}</p>
      </div>
      <div className="space-y-5 md:col-span-2">{children}</div>
    </section>
  );
}

/** Searchable multi-select for invitees. */
function InviteePicker({ people, selected, onChange, error }) {
  const [query, setQuery] = useState('');
  const chosen = people.filter((p) => selected.includes(p.id));
  const matches = query.trim()
    ? people.filter((p) => !selected.includes(p.id) && p.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink-700">Invite individual people</p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people by name"
        aria-label="Search people to invite"
        className="h-10 w-full rounded-lg border border-ink-300 bg-white px-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
      {matches.length > 0 && (
        <ul className="anim-drop mt-1 max-h-56 overflow-auto rounded-lg border border-ink-200 bg-white shadow-pop">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                onClick={() => { onChange([...selected, p.id]); setQuery(''); }}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosen.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {chosen.map((p) => (
            <li key={p.id} className="anim-pop items-center gap-1.5 rounded-full bg-ink-100 py-1 pl-3 pr-1 text-sm text-ink-800">
              {p.name}
              <button
                type="button"
                className="rounded-full px-2 text-xs font-medium text-ink-500 hover:bg-ink-200 hover:text-ink-900"
                aria-label={`Remove ${p.name}`}
                onClick={() => onChange(selected.filter((id) => id !== p.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1.5 text-xs text-danger-700">{error}</p>}
    </div>
  );
}

/** Create (/manage/new) and edit (/manage/:id/edit) share this form. */
export function EventEditorPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { notify } = useToast();

  const types = useApi('/types');
  const groups = useApi('/groups');
  const people = useApi('/users');
  const existing = useApi(isEdit ? `/events/${id}` : null);

  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    setForm({
      name: e.name,
      description: e.description || '',
      location: e.location,
      start: toLocalInput(e.start),
      end: toLocalInput(e.end),
      capacity: String(e.capacity),
      cost: String(e.cost),
      typeId: String(e.type.id),
      visibility: e.visibility,
      groupIds: e.groupIds || [],
      inviteIds: e.inviteIds || [],
    });
  }, [existing.data]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    // Clear a field's server error as soon as the user edits it.
    setErrors((errs) => (errs[key] ? { ...errs, [key]: undefined } : errs));
  };
  const toggleGroup = (gid) =>
    setForm((f) => ({ ...f, groupIds: f.groupIds.includes(gid) ? f.groupIds.filter((g) => g !== gid) : [...f.groupIds, gid] }));

  const audienceSummary = useMemo(() => {
    if (form.visibility === 'public') return 'Every signed-in user can see and join this event.';
    const n = form.groupIds.length + form.inviteIds.length;
    if (n === 0) return 'No audience selected yet: only you and admins will see this event.';
    return 'Only members of the selected groups and the invited people (plus you and admins) can see this event.';
  }, [form.visibility, form.groupIds, form.inviteIds]);

  if (isEdit && existing.loading) return <PageLoader label="Loading event" />;
  if (isEdit && existing.error) {
    return (
      <EmptyState title={existing.error.status === 404 ? 'Event not found' : 'Event could not be loaded'} action={<Link to="/manage" className="text-sm font-medium text-brand-700 hover:underline">Back to Manage events</Link>}>
        {existing.error.status === 404 ? 'It may have been deleted, or you may not have access to it.' : existing.error.message}
      </EmptyState>
    );
  }
  if (isEdit && existing.data && !existing.data.permissions.edit) {
    return <EmptyState title="You cannot edit this event">Only the organizer, planners in a group it is shared with, or an admin can make changes.</EmptyState>;
  }

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage('');
    const body = {
      ...form,
      start: fromLocalInput(form.start),
      end: fromLocalInput(form.end),
      capacity: form.capacity === '' ? undefined : Number(form.capacity),
      cost: form.cost === '' ? undefined : Number(form.cost),
      typeId: form.typeId === '' ? undefined : Number(form.typeId),
    };
    try {
      const saved = await api(isEdit ? `/events/${id}` : '/events', { method: isEdit ? 'PUT' : 'POST', body });
      notify(isEdit ? `${saved.name} was updated.` : `${saved.name} was created.`);
      navigate('/manage');
    } catch (err) {
      setErrors(err.fields || {});
      setMessage(err.message);
      setSaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/manage" className="text-sm font-medium text-brand-700 hover:underline">Back to Manage events</Link>
      <h1 className="mt-3 text-2xl font-semibold text-ink-900 sm:text-3xl">{isEdit ? 'Edit event' : 'Create an event'}</h1>
      <p className="mt-1 text-sm text-ink-500">
        {isEdit ? 'Changes are visible to attendees as soon as you save.' : 'Fill in the details and choose who can see it.'}
      </p>

      <form onSubmit={submit} noValidate className="mt-8 rounded-xl border border-ink-200 bg-white p-6 shadow-card sm:p-8">
        {message && <div className="mb-6"><Alert>{message}</Alert></div>}

        <Section title="Details" description="What attendees see in the catalogue.">
          <TextInput label="Event name" value={form.name} onChange={set('name')} error={errors.name} maxLength={200} required />
          <Select label="Event type" value={form.typeId} onChange={set('typeId')} error={errors.typeId} required>
            <option value="">Choose a type</option>
            {(types.data || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <TextArea label="Description" value={form.description} onChange={set('description')} error={errors.description} maxLength={5000} hint="Optional. Agenda, what to bring, parking, and so on." />
        </Section>

        <Section title="Date and place" description="Times are shown in each attendee's local time zone.">
          <div className="grid gap-5 sm:grid-cols-2">
            <TextInput label="Starts" type="datetime-local" value={form.start} onChange={set('start')} error={errors.start} required />
            <TextInput label="Ends" type="datetime-local" value={form.end} min={form.start || undefined} onChange={set('end')} error={errors.end} required />
          </div>
          <TextInput label="Location" value={form.location} onChange={set('location')} error={errors.location} maxLength={255} required />
        </Section>

        <Section title="Seats and cost" description="Registration closes automatically when every seat is taken.">
          <div className="grid gap-5 sm:grid-cols-2">
            <TextInput label="Capacity" type="number" min="1" step="1" inputMode="numeric" value={form.capacity} onChange={set('capacity')} error={errors.capacity} required />
            <TextInput label="Cost (USD)" type="number" min="0" step="0.01" inputMode="decimal" value={form.cost} onChange={set('cost')} error={errors.cost} hint="Use 0 for a free event." required />
          </div>
        </Section>

        <Section title="Who can see it" description="Restricted events are hidden from everyone outside the chosen audience.">
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Visibility</legend>
            {[
              { value: 'public', label: 'Public', text: 'All signed-in users' },
              { value: 'restricted', label: 'Restricted', text: 'Selected groups and invited people' },
            ].map((opt) => (
              <label
                key={opt.value}
                className={`anim-select cursor-pointer rounded-lg border p-4 transition-colors ${form.visibility === opt.value ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-ink-200 hover:border-ink-300'}`}
              >
                <input type="radio" name="visibility" value={opt.value} checked={form.visibility === opt.value} onChange={set('visibility')} className="sr-only" />
                <span className="block text-sm font-semibold text-ink-900">{opt.label}</span>
                <span className="block text-sm text-ink-500">{opt.text}</span>
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-ink-600">{audienceSummary}</p>

          {form.visibility === 'restricted' && (
            <div className="anim-drop space-y-6 rounded-lg border border-ink-200 bg-ink-50 p-4">
              <div>
                <p className="mb-2 text-sm font-medium text-ink-700">Share with groups</p>
                {groups.data?.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {groups.data.map((g) => (
                      <Checkbox key={g.id} label={g.name} description={`${g.memberCount} members`} checked={form.groupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-ink-500">No groups exist yet. An admin can create them under Users and Groups.</p>
                )}
                {errors.groupIds && <p className="mt-1.5 text-xs text-danger-700">{errors.groupIds}</p>}
              </div>
              <InviteePicker people={people.data || []} selected={form.inviteIds} onChange={(ids) => setForm((f) => ({ ...f, inviteIds: ids }))} error={errors.inviteIds} />
            </div>
          )}
        </Section>

        <div className="flex justify-end gap-3 border-t border-ink-100 pt-6">
          <Button variant="secondary" onClick={() => navigate('/manage')} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEdit ? 'Save changes' : 'Create event'}</Button>
        </div>
      </form>
    </div>
  );
}
