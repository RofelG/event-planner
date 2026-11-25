import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from './ui/Modal';
import { Button } from './ui/Button';
import { Checkbox, TextInput } from './ui/Field';
import { Alert } from './ui/Feedback';

/** One titled block of the dialog. Add further sections (for example "Account") as siblings. */
function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {children}
    </section>
  );
}

function PrivacySection({ hideName, onChange }) {
  return (
    <Section title="Privacy">
      <Checkbox
        label="Hide my name in attendee lists"
        description="Other attendees see you as Private attendee. Organizers and admins still see your name."
        checked={hideName}
        onChange={(e) => onChange(e.target.checked)}
      />
    </Section>
  );
}

/** Account deletion: a danger button that opens a confirmation (with a password for normal accounts). */
/** confirming/setConfirming come from the parent so it can ignore Escape while the confirm is open. */
function AccountSection({ onClose, confirming, setConfirming }) {
  const { isGuest, demo, deleteAccount } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);

  const cancel = () => {
    setConfirming(false);
    setPassword('');
    setError('');
    setFieldError('');
  };

  const confirm = async () => {
    setBusy(true);
    setError('');
    setFieldError('');
    try {
      await deleteAccount(isGuest ? { confirm: true } : { password });
      onClose();
      // In demo mode the catalogue stays open to visitors.
      navigate(demo.enabled ? '/' : '/login', { replace: true });
      notify('Your account has been deleted.');
    } catch (err) {
      setFieldError(err.fields?.password || err.fields?.confirm || '');
      // A field error is shown by the input; otherwise (409, network) show the message.
      if (!err.fields?.password) setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Account">
      <p className="text-sm text-ink-600">Delete your account and personal details. This cannot be undone.</p>
      <Button type="button" variant="danger" onClick={() => setConfirming(true)}>Delete my account</Button>
      <ConfirmDialog
        open={confirming}
        title="Delete your account?"
        confirmLabel="Delete my account"
        busy={busy}
        onConfirm={confirm}
        onCancel={cancel}
      >
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <ul className="list-disc space-y-1 pl-5">
            <li>Upcoming events you organize are handed over to an admin.</li>
            <li>Your sign-ups, waitlist places and group memberships are removed.</li>
            <li>Your name and email are erased and you are signed out everywhere.</li>
            <li>This cannot be undone.</li>
          </ul>
          {!isGuest && (
            <TextInput
              label="Confirm with your password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fieldError}
            />
          )}
        </div>
      </ConfirmDialog>
    </Section>
  );
}

export function AccountSettingsModal({ open, onClose }) {
  const { user, updateSettings } = useAuth();
  const { notify } = useToast();
  const [hideName, setHideName] = useState(Boolean(user?.hideName));
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  // While the delete confirmation is open, Escape belongs to it: both dialogs
  // listen for Escape, and this one must not close underneath it.
  const [confirming, setConfirming] = useState(false);
  const close = () => {
    if (!confirming) onClose();
  };

  // Start from the saved value each time the dialog opens.
  useEffect(() => {
    if (open) {
      setHideName(Boolean(user?.hideName));
      setMessage('');
      setConfirming(false);
    }
  }, [open, user?.hideName]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await updateSettings({ hideName });
      notify('Settings saved.');
      onClose();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Account settings"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="account-settings" loading={saving}>Save</Button>
        </>
      }
    >
      <form id="account-settings" onSubmit={submit} className="space-y-6" noValidate>
        {message && <Alert>{message}</Alert>}
        <PrivacySection hideName={hideName} onChange={setHideName} />
        <AccountSection onClose={onClose} confirming={confirming} setConfirming={setConfirming} />
      </form>
    </Modal>
  );
}
