import { useApi } from '../hooks/useApi';
import { initials } from '../lib/format';
import { Modal } from './ui/Modal';
import { Alert, EmptyState, Spinner } from './ui/Feedback';

export function AttendeesModal({ event, onClose }) {
  const { data, error, loading } = useApi(event ? `/events/${event.id}/attendees` : null);

  return (
    <Modal
      open={Boolean(event)}
      onClose={onClose}
      title="Who is attending"
      description={event ? `${event.name} - ${event.attendeeCount} of ${event.capacity} seats taken` : ''}
    >
      {loading && (
        <div className="flex items-center gap-3 py-6 text-sm text-ink-500"><Spinner /> Loading attendees</div>
      )}
      {error && <Alert>{error.message}</Alert>}
      {data && data.length === 0 && <EmptyState title="No one has signed up yet">Be the first to reserve a seat.</EmptyState>}
      {data && data.length > 0 && (
        <ul className="divide-y divide-ink-100">
          {data.map((person, i) => (
            <li key={person.id} className="anim-row flex items-center gap-3 py-2.5" style={{ '--stagger': i }}>
              {person.private ? (
                // Neutral placeholder: no initials, so nothing hints at who it is.
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-400" aria-hidden="true">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7z" /></svg>
                </span>
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-700">
                  {initials(person.name)}
                </span>
              )}
              <span className={person.private ? 'text-sm italic text-ink-500' : 'text-sm text-ink-800'}>{person.name}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
