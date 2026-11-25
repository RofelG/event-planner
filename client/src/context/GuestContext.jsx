import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/Field';
import { Alert } from '../components/ui/Feedback';

const GuestContext = createContext(null);
const FORM_ID = 'guest-name-form';

/**
 * Demo mode: visitors have no account. The first time they join or create an
 * event, ensureSignedIn() asks for their name and turns them into a guest.
 * Everyone else passes straight through.
 */
export function GuestProvider({ children }) {
  const { isVisitor, becomeGuest, demo } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(null);

  /** Resolves true once there is a session to act with, false if the visitor cancels. */
  const ensureSignedIn = useCallback(
    (why = 'join events') => {
      if (!isVisitor) return Promise.resolve(true);
      setReason(why);
      setOpen(true);
      return new Promise((resolve) => {
        pending.current = resolve;
      });
    },
    [isVisitor]
  );

  const finish = (ok) => {
    setOpen(false);
    setName('');
    setError('');
    setMessage('');
    pending.current?.(ok);
    pending.current = null;
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await becomeGuest(name);
      finish(true);
    } catch (err) {
      if (err.fields?.name) setError(err.fields.name);
      else setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <GuestContext.Provider value={ensureSignedIn}>
      {children}
      <Modal
        open={open}
        onClose={() => !saving && finish(false)}
        size="sm"
        title="What's your name?"
        description={`So others can see who is coming. You can then ${reason}.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => finish(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" form={FORM_ID} loading={saving}>Continue</Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-4">
          {message && <Alert>{message}</Alert>}
          <TextInput
            label="Your name"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            error={error}
            maxLength={60}
            autoComplete="name"
            required
          />
          <p className="text-xs text-ink-500">
            This is a demo: no account or password needed. Your name, sign-ups and events are removed after {demo.ttlHours} hours.
          </p>
        </form>
      </Modal>
    </GuestContext.Provider>
  );
}

/** Returns ensureSignedIn(reason): Promise<boolean>. */
export function useEnsureSignedIn() {
  const ctx = useContext(GuestContext);
  if (!ctx) throw new Error('useEnsureSignedIn must be used inside <GuestProvider>');
  return ctx;
}
