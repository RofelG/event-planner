import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { useEventActions } from '../hooks/useEventActions';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { useOpenEditor } from '../hooks/useOpenEditor';
import { usePagedEvents } from '../hooks/usePagedEvents';
import { mergeLiveEvent } from '../lib/liveMerge';
import { LiveIndicator } from '../components/LiveIndicator';
import { EventCard, EventCardSkeleton } from '../components/EventCard';
import { AttendeesModal } from '../components/AttendeesModal';
import { ConfirmDialog } from '../components/ui/Modal';
import { Alert, EmptyState, Spinner } from '../components/ui/Feedback';
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

/**
 * Calls onVisible when the returned element scrolls within 600px of the
 * viewport. Re-arms whenever `deps` change, so a page that still leaves the
 * sentinel on screen triggers the next load.
 */
function useSentinel(onVisible, enabled, deps) {
  const ref = useRef(null);
  const latest = useRef(onVisible);
  latest.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && latest.current(), { rootMargin: '600px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
    // `deps` is spread in on purpose: re-observing fires the callback again if
    // the sentinel is still in view after a page loads.
  }, [enabled, ...deps]);
  return ref;
}

export function CataloguePage() {
  const { user, isVisitor, canCreate } = useAuth();
  const openEditor = useOpenEditor();
  const [typeId, setTypeId] = useState(null);
  const [search, setSearch] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [attendeesFor, setAttendeesFor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [hiding, setHiding] = useState(null);
  const q = useDebounced(search.trim());
  const filters = { typeId, q, mine: onlyMine };

  const types = useApi('/types');
  const events = usePagedEvents(filters);

  const replace = (updated) =>
    events.setItems((list) => mergeLiveEvent(list, updated, filters, { complete: !events.hasMore }));
  const drop = (id) => events.setItems((list) => list.filter((e) => e.id !== id));
  const actions = useEventActions({ onChange: replace, onRemove: drop });

  // Seats taken, edits, new and removed events arrive from the live stream.
  useLiveEvents((message) => {
    if (message.type === 'reconnected') events.reload();
    else if (message.type === 'remove') events.setItems((list) => list && list.filter((e) => e.id !== message.data.id));
    else if (message.type === 'event') {
      events.setItems((list) => list && mergeLiveEvent(list, message.data, filters, { complete: !events.hasMore }));
    }
  });

  const sentinel = useSentinel(events.loadMore, events.hasMore && !events.loadingMore, [events.items?.length]);

  const shown = events.items || [];
  const filtered = Boolean(typeId || q || onlyMine);

  let resultStatus = '';
  if (events.error) resultStatus = 'Events could not be loaded.';
  else if (events.loading) resultStatus = 'Loading events.';
  else if (events.loadingMore) resultStatus = 'Loading more events.';
  else if (events.items && shown.length === 0) resultStatus = filtered ? 'No events match your filters.' : 'No upcoming events yet.';
  else if (shown.length) {
    resultStatus = `Showing ${shown.length} event${shown.length === 1 ? '' : 's'}${events.hasMore ? '. Scroll for more.' : '.'}`;
  }

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
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink-900 sm:text-3xl">Event catalogue</h1>
            <LiveIndicator />
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {isVisitor ? 'Find an event and reserve your seat.' : `Welcome, ${user.first}. Find an event and reserve your seat.`}
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => openEditor()}
            className="press inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 dark:hover:bg-brand-600 dark:hover:brightness-90 sm:hidden"
          >
            Create event
          </button>
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
        {/* Visitors have not joined anything yet. */}
        {!isVisitor && (
          <label className="flex shrink-0 items-center gap-2 text-sm text-ink-700 lg:ml-auto">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
            Only events I joined
          </label>
        )}
      </div>

      {/* What screen readers announce: changes to the result set only. The
          cards are not a live region, because seat counts change several
          times a second in demo mode and each change would be read out. */}
      <p role="status" className="sr-only">{resultStatus}</p>

      <section className="mt-6" aria-busy={events.loading}>
        {events.error && (
          <Alert title="Events could not be loaded" action={<Button size="sm" variant="secondary" onClick={events.reload}>Try again</Button>}>
            {events.error.message}
          </Alert>
        )}

        {events.loading && !events.items && (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <EventCardSkeleton key={i} />)}
          </div>
        )}

        {events.items && shown.length === 0 && (
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
          <div key={events.dataKey} className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {shown.map((event, i) => (
              // Cards from a newly loaded page cascade from their own first card.
              <EventCard key={event.id} index={Math.max(0, i - events.pageStart)} event={event} actions={actions} onAttendees={setAttendeesFor} onDelete={setDeleting} onHide={setHiding} />
            ))}
          </div>
        )}

        {/* Infinite scroll: loads the next page as this comes into view. The
            button is the fallback for keyboard users and older browsers. */}
        {shown.length > 0 && (
          <div ref={sentinel} className="mt-8 flex justify-center text-sm text-ink-500">
            {events.hasMore ? (
              events.loadingMore ? (
                <span className="inline-flex items-center gap-2"><Spinner className="h-4 w-4" /> Loading more events</span>
              ) : (
                <Button variant="secondary" onClick={events.loadMore}>Load more events</Button>
              )
            ) : (
              <span>You have reached the end of the list.</span>
            )}
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
