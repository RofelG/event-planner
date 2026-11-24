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
          {data.map((person) => (
            <li key={person.id} className="flex items-center gap-3 py-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-700">
                {initials(person.name)}
              </span>
              <span className="text-sm text-ink-800">{person.name}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
