import { useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';

/**
 * Join / leave / delete actions shared by the catalogue and the manage page.
 * `onChange(updatedEvent)` receives the server's fresh copy (with recalculated
 * permissions); `onRemove(id)` fires after a delete.
 */
export function useEventActions({ onChange, onRemove }) {
  const { notify } = useToast();
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
    join: (event) =>
      run(`join:${event.id}`, async () => {
        onChange(await api(`/events/${event.id}/registration`, { method: 'POST' }));
        notify(`You are registered for ${event.name}.`);
      }),
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
