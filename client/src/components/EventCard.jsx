import { useNavigate } from 'react-router-dom';
import { formatCost, formatRange } from '../lib/format';
import { Button } from './ui/Button';
import { Badge } from './ui/Feedback';

function Detail({ label, children }) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-16 shrink-0 text-ink-500">{label}</dt>
      <dd className="text-ink-800">{children}</dd>
    </div>
  );
}

/**
 * Controls are driven by event.permissions, which the API computes per user.
 * Edit and Delete only render for the organizer, a planner in a group the event is shared with, or an admin.
 */
export function EventCard({ event, actions, onAttendees, onDelete }) {
  const navigate = useNavigate();
  const { permissions: can } = event;
  const pct = Math.min(100, Math.round((event.attendeeCount / event.capacity) * 100));
  const seatsLeft = event.capacity - event.attendeeCount;

  return (
    <article className="flex flex-col rounded-xl border border-ink-200 bg-white shadow-card transition-shadow hover:shadow-pop">
      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{event.type.name}</Badge>
          {event.visibility === 'restricted' && <Badge tone="warning">Restricted</Badge>}
          {event.isRegistered && <Badge tone="success">You are going</Badge>}
        </div>

        <h3 className="mt-3 text-lg font-semibold leading-snug text-ink-900">{event.name}</h3>
        {event.description && <p className="mt-1 line-clamp-2 text-sm text-ink-600">{event.description}</p>}

        <dl className="mt-4 space-y-1.5">
          <Detail label="When">{formatRange(event.start, event.end)}</Detail>
          <Detail label="Where">{event.location}</Detail>
          <Detail label="Cost">{formatCost(event.cost)}</Detail>
          <Detail label="Host">{event.organizer.name}</Detail>
        </dl>

        <div className="mt-auto pt-5">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-ink-600">{event.attendeeCount} of {event.capacity} seats taken</span>
            <span className={event.isFull ? 'font-medium text-warning-700' : 'text-ink-500'}>
              {event.isFull ? 'Full' : `${seatsLeft} left`}
            </span>
          </div>
          <div className={`capacity-bar ${event.isFull ? 'is-full' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Seats taken">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-5 py-3">
        {can.join && (
          <Button size="sm" onClick={() => actions.join(event)} loading={actions.isPending('join', event.id)}>Join event</Button>
        )}
        {can.leave && (
          <Button size="sm" variant="secondary" onClick={() => actions.leave(event)} loading={actions.isPending('leave', event.id)}>Leave event</Button>
        )}
        {!can.join && !can.leave && event.isFull && !event.isRegistered && (
          <span className="text-sm text-ink-500">No seats available</span>
        )}
        <Button size="sm" variant="ghost" onClick={() => onAttendees(event)}>View attendees</Button>

        {(can.edit || can.delete) && (
          <div className="ml-auto flex gap-1">
            {can.edit && (
              <Button size="sm" variant="ghost" onClick={() => navigate(`/manage/${event.id}/edit`)}>Edit</Button>
            )}
            {can.delete && (
              <Button size="sm" variant="danger-ghost" onClick={() => onDelete(event)}>Delete</Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card" aria-hidden="true">
      <div className="skeleton h-5 w-20" />
      <div className="skeleton mt-4 h-6 w-3/4" />
      <div className="skeleton mt-2 h-4 w-full" />
      <div className="mt-5 space-y-2">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-4 w-1/2" />
        <div className="skeleton h-4 w-1/3" />
      </div>
      <div className="skeleton mt-6 h-2 w-full" />
    </div>
  );
}
