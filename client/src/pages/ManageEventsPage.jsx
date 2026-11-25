import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { useEventActions } from '../hooks/useEventActions';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { formatRange, hasEnded } from '../lib/format';
import { AttendeesModal } from '../components/AttendeesModal';
import { ConfirmDialog } from '../components/ui/Modal';
import { Alert, Badge, EmptyState, PageLoader } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const linkButton = 'press inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 dark:hover:bg-brand-600 dark:hover:brightness-90';

/** Planner/admin dashboard: every event the caller is allowed to manage. */
export function ManageEventsPage() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  // Opens the editor as a modal over this page (see App.jsx).
  const modal = { background: location };
  const [includePast, setIncludePast] = useState(false);
  const [attendeesFor, setAttendeesFor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [hiding, setHiding] = useState(null);
  const events = useApi(`/events?manageable=true${includePast ? '&past=true' : ''}`);
  const actions = useEventActions({
    // Hide and unhide return the updated event; swap it into its row.
    onChange: (updated) => events.setData((list) => list && list.map((e) => (e.id === updated.id ? updated : e))),
    onRemove: (id) => events.setData((list) => list.filter((e) => e.id !== id)),
  });

  // Live changes update the table in place: seat counts and edits replace
  // their row, and removals (or losing the right to manage) drop it. Only an
  // event that is new to this table, or a reconnect, needs the server's list,
  // and a burst of those is folded into one reload. Reloading on every
  // message would refetch the table several times a second in demo mode.
  const reloadTimer = useRef(null);
  // Always the current reload, so a timer set before "Include past events"
  // changed cannot refetch the old list.
  const reloadLatest = useRef(events.reload);
  reloadLatest.current = events.reload;
  const reloadSoon = () => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => reloadLatest.current(), 600);
  };
  useEffect(() => () => clearTimeout(reloadTimer.current), []);

  useLiveEvents((message) => {
    if (message.type === 'reconnected') return reloadSoon();
    if (message.type === 'remove') {
      return events.setData((list) => list && list.filter((e) => e.id !== message.data.id));
    }
    if (message.type !== 'event') return undefined;
    const event = message.data;
    if (events.data?.some((e) => e.id === event.id)) {
      return events.setData((list) =>
        event.permissions.edit ? list.map((e) => (e.id === event.id ? event : e)) : list.filter((e) => e.id !== event.id)
      );
    }
    if (event.permissions.edit) reloadSoon();
    return undefined;
  });

  const confirmDelete = async () => {
    await actions.remove(deleting);
    setDeleting(null);
  };

  const confirmHide = async () => {
    await actions.hide(hiding);
    setHiding(null);
  };

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900 sm:text-3xl">Manage events</h1>
          <p className="mt-1 text-sm text-ink-500">
            {isAdmin ? 'As an admin you can edit or delete any event.' : 'Events you organize or that are shared with your groups. Create new events or update existing ones.'}
          </p>
        </div>
        <Link to="/manage/new" state={modal} className={linkButton}>Create event</Link>
      </div>

      <label className="mt-6 flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} />
        Include past events
      </label>

      <div className="mt-4">
        {events.error && <Alert title="Events could not be loaded">{events.error.message}</Alert>}
        {events.loading && !events.data && <PageLoader label="Loading your events" />}
        {events.data && events.data.length === 0 && (
          <EmptyState title="You have no events yet" action={<Link to="/manage/new" state={modal} className={linkButton}>Create your first event</Link>}>
            Events you create appear here, where you can edit them, review attendees or delete them.
          </EmptyState>
        )}

        {events.data && events.data.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-card">
            <table className="min-w-full divide-y divide-ink-200 text-sm">
              <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Event</th>
                  <th scope="col" className="hidden px-4 py-3 md:table-cell">When</th>
                  <th scope="col" className="hidden px-4 py-3 sm:table-cell">Seats</th>
                  <th scope="col" className="hidden px-4 py-3 lg:table-cell">Audience</th>
                  <th scope="col" className="px-4 py-3 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {events.data.map((e, i) => (
                  <tr key={e.id} style={{ '--stagger': i }} className={`anim-row ${hasEnded(e) ? 'bg-ink-50/60 text-ink-500' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-900">{e.name}</p>
                      <p className="text-xs text-ink-500">{e.type.name} - {e.location}{isAdmin ? ` - Host: ${e.organizer.name}` : ''}</p>
                      {(hasEnded(e) || e.hidden) && (
                        <span className="mt-1 flex gap-1">
                          {hasEnded(e) && <Badge>Ended</Badge>}
                          {e.hidden && <Badge tone="danger">Hidden</Badge>}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-ink-700 md:table-cell">{formatRange(e.start, e.end)}</td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <button type="button" className="text-brand-700 hover:underline" onClick={() => setAttendeesFor(e)}>
                        {e.attendeeCount} / {e.capacity}
                      </button>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      {e.visibility === 'public' ? (
                        <Badge tone="success">Public</Badge>
                      ) : (
                        <span className="flex flex-col items-start gap-1">
                          <Badge tone="warning">Restricted</Badge>
                          <span className="text-xs text-ink-500">{plural(e.groupIds.length, 'group')}, {e.inviteIds.length} invited</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {e.permissions.hide && (
                          <Button size="sm" variant="ghost" onClick={() => setHiding(e)}>Hide</Button>
                        )}
                        {e.permissions.unhide && (
                          <Button size="sm" variant="ghost" onClick={() => actions.unhide(e)} loading={actions.isPending('unhide', e.id)}>Unhide</Button>
                        )}
                        {e.permissions.edit && (
                          <Link to={`/manage/${e.id}/edit`} state={modal} className="press inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900">Edit</Link>
                        )}
                        {e.permissions.delete && (
                          <Button size="sm" variant="danger-ghost" onClick={() => setDeleting(e)}>Delete</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AttendeesModal event={attendeesFor} onClose={() => setAttendeesFor(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this event?"
        confirmLabel="Delete event"
        busy={deleting && actions.isPending('delete', deleting.id)}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      >
        <strong className="text-ink-900">{deleting?.name}</strong> will be removed from the catalogue for everyone,
        including the {deleting?.attendeeCount} registered attendees.
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(hiding)}
        title="Hide this event?"
        confirmLabel="Hide event"
        busy={hiding && actions.isPending('hide', hiding.id)}
        onConfirm={confirmHide}
        onCancel={() => setHiding(null)}
      >
        <strong className="text-ink-900">{hiding?.name}</strong> will disappear for everyone except admins,
        including its organizer. Nothing is deleted, and you can unhide it later.
      </ConfirmDialog>
    </div>
  );
}
