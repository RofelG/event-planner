import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Field';
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

export function AccountSettingsModal({ open, onClose }) {
  const { user, updateSettings } = useAuth();
  const { notify } = useToast();
  const [hideName, setHideName] = useState(Boolean(user?.hideName));
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  // Start from the saved value each time the dialog opens.
  useEffect(() => {
    if (open) {
      setHideName(Boolean(user?.hideName));
      setMessage('');
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
      onClose={onClose}
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
      </form>
    </Modal>
  );
}
