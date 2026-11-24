import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { useEventActions } from '../hooks/useEventActions';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { mergeLiveEvent } from '../lib/liveMerge';
import { LiveIndicator } from '../components/LiveIndicator';
import { EventCard, EventCardSkeleton } from '../components/EventCard';
import { AttendeesModal } from '../components/AttendeesModal';
import { ConfirmDialog } from '../components/ui/Modal';
import { Alert, EmptyState } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';

function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const chip = (active) =>
  `press anim-select shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium ${
    active ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-surface text-ink-700 hover:border-ink-300 hover:bg-ink-50'
  }`;

export function CataloguePage() {
  const { user, isPlanner } = useAuth();
  const location = useLocation();
  const [typeId, setTypeId] = useState(null);
  const [search, setSearch] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [attendeesFor, setAttendeesFor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const q = useDebounced(search.trim());

  const types = useApi('/types');
  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (typeId) params.set('type', typeId);
    if (q) params.set('q', q);
    const s = params.toString();
    return `/events${s ? `?${s}` : ''}`;
  }, [typeId, q]);
  const events = useApi(path);

  const replace = (updated) => events.setData((list) => list.map((e) => (e.id === updated.id ? updated : e)));
  const drop = (id) => events.setData((list) => list.filter((e) => e.id !== id));
  const actions = useEventActions({ onChange: replace, onRemove: drop });

  // Seats taken, edits, new and removed events arrive from the live stream.
  useLiveEvents((message) => {
    if (message.type === 'reconnected') events.reload();
    else if (message.type === 'remove') events.setData((list) => list && list.filter((e) => e.id !== message.data.id));
    else if (message.type === 'event') events.setData((list) => list && mergeLiveEvent(list, message.data, { typeId, q }));
  });

  const shown = (events.data || []).filter((e) => !onlyMine || e.isRegistered);
  const filtered = Boolean(typeId || q || onlyMine);

  const confirmDelete = async () => {
    await actions.remove(deleting);
    setDeleting(null);
  };

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink-900 sm:text-3xl">Event catalogue</h1>
            <LiveIndicator />
          </div>
          <p className="mt-1 text-sm text-ink-500">Welcome, {user.first}. Find an event and reserve your seat.</p>
        </div>
        {isPlanner && (
          <Link to="/manage/new" state={{ background: location }} className="press inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 dark:hover:bg-brand-600 dark:hover:brightness-90 sm:hidden">
            Create event
          </Link>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative lg:w-80">
          <span className="sr-only">Search events</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, place or description"
            className="h-10 w-full rounded-lg border border-ink-300 bg-surface px-3 text-sm shadow-sm placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </label>
        <div className="chip-row -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:min-w-0 lg:flex-1 lg:flex-wrap lg:px-0" role="group" aria-label="Filter by event type">
          <button type="button" className={chip(!typeId)} aria-pressed={!typeId} onClick={() => setTypeId(null)}>All types</button>
          {(types.data || []).map((t) => (
            <button key={t.id} type="button" className={chip(typeId === t.id)} aria-pressed={typeId === t.id} onClick={() => setTypeId(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-ink-700 lg:ml-auto">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          Only events I joined
        </label>
      </div>

      <section className="mt-6" aria-live="polite" aria-busy={events.loading}>
        {events.error && (
          <Alert title="Events could not be loaded" action={<Button size="sm" variant="secondary" onClick={events.reload}>Try again</Button>}>
            {events.error.message}
          </Alert>
        )}

        {events.loading && !events.data && (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <EventCardSkeleton key={i} />)}
          </div>
        )}

        {events.data && shown.length === 0 && (
          <EmptyState
            title={filtered ? 'No events match your filters' : 'No upcoming events yet'}
            action={filtered && (
              <Button variant="secondary" onClick={() => { setTypeId(null); setSearch(''); setOnlyMine(false); }}>Clear filters</Button>
            )}
          >
            {filtered ? 'Try a different type or search term.' : 'Check back soon. New events appear here as soon as they are published.'}
          </EmptyState>
        )}

        {shown.length > 0 && (
          // Keyed by the result set, so the cards cascade in again when a new
          // filter result lands, not while the old list is still showing.
          <div key={`${events.dataPath}|${onlyMine}`} className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {shown.map((event, i) => (
              <EventCard key={event.id} index={i} event={event} actions={actions} onAttendees={setAttendeesFor} onDelete={setDeleting} />
            ))}
          </div>
        )}
      </section>

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
    </div>
  );
}
