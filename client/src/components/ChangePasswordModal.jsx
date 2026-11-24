import { useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { TextInput } from './ui/Field';
import { Alert } from './ui/Feedback';

const empty = { current: '', password: '', confirm: '' };

export function ChangePasswordModal({ open, onClose }) {
  const { notify } = useToast();
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => {
    setForm(empty);
    setErrors({});
    setMessage('');
    onClose();
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage('');
    try {
      await api('/auth/password', { method: 'PUT', body: form });
      notify('Password updated. Other sessions have been signed out.');
      close();
    } catch (err) {
      setErrors(err.fields || {});
      if (!err.fields || !Object.keys(err.fields).length) setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Change password"
      description="Use at least 10 characters, including a letter and a number."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>Cancel</Button>
          <Button type="submit" form="change-password" loading={saving}>Update password</Button>
        </>
      }
    >
      <form id="change-password" onSubmit={submit} className="space-y-4" noValidate>
        {message && <Alert>{message}</Alert>}
        <TextInput label="Current password" type="password" autoComplete="current-password" value={form.current} onChange={set('current')} error={errors.current} required />
        <TextInput label="New password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} required />
        <TextInput label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} required />
      </form>
    </Modal>
  );
}
