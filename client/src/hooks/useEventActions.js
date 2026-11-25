import { useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useEnsureSignedIn } from '../context/GuestContext';

/**
 * Join / leave / delete actions shared by the catalogue and the manage page.
 * `onChange(updatedEvent)` receives the server's fresh copy (with recalculated
 * permissions); `onRemove(id)` fires after a delete.
 */
export function useEventActions({ onChange, onRemove }) {
  const { notify } = useToast();
  const ensureSignedIn = useEnsureSignedIn();
  const [pending, setPending] = useState(null); // `${action}:${id}`

  const run = async (key, fn) => {
    setPending(key);
    try {
      await fn();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setPending(null);
    }
  };

  return {
    isPending: (action, id) => pending === `${action}:${id}`,
    join: async (event) => {
      // Demo visitors give their name first (before the button shows as busy);
      // cancelling the prompt does nothing.
      if (!(await ensureSignedIn('join events'))) return;
      await run(`join:${event.id}`, async () => {
        onChange(await api(`/events/${event.id}/registration`, { method: 'POST' }));
        notify(`You are registered for ${event.name}.`);
      });
    },
    leave: (event) =>
      run(`leave:${event.id}`, async () => {
        onChange(await api(`/events/${event.id}/registration`, { method: 'DELETE' }));
        notify(`You left ${event.name}.`, 'info');
      }),
    remove: (event) =>
      run(`delete:${event.id}`, async () => {
        await api(`/events/${event.id}`, { method: 'DELETE' });
        onRemove(event.id);
        notify(`${event.name} was deleted.`, 'info');
      }),
  };
}
