import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/Field';
import { Alert, PageLoader } from '../components/ui/Feedback';

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-ink-50 px-4 py-12">
      <div className="anim-drop mb-8 flex items-center gap-3">
        <img src="/logo.svg" alt="" className="h-10 w-10 dark:invert dark:hue-rotate-180" />
        <span className="text-xl font-semibold text-ink-900">Event Planner</span>
      </div>
      <div className="anim-bounce-in w-full max-w-md rounded-2xl border border-ink-200 bg-surface p-8 shadow-card" style={{ '--stagger': 1 }}>
        <h1 className="text-2xl font-semibold text-ink-900">{title}</h1>
        <p className="mt-1 text-sm text-ink-500">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
      <p className="anim-bounce-in mt-6 text-sm text-ink-600" style={{ '--stagger': 3 }}>{footer}</p>
    </div>
  );
}

function useForm(initial) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const run = async (fn) => {
    setBusy(true);
    setErrors({});
    setMessage('');
    try {
      await fn();
    } catch (err) {
      setErrors(err.fields || {});
      if (!err.fields || !Object.keys(err.fields).length) setMessage(err.message);
      setBusy(false);
    }
  };
  return { form, set, errors, message, busy, run };
}

export function LoginPage() {
  const { signedIn, status, expired, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { form, set, errors, message, busy, run } = useForm({ email: '', password: '' });
  const destination = location.state?.from?.pathname || '/';

  if (status === 'loading') return <PageLoader />;
  if (signedIn) return <Navigate to={destination} replace />;

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await login(form.email, form.password);
      navigate(destination, { replace: true });
    });
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Sign in to browse and join events."
      footer={<>New here? <Link to="/register" className="font-medium text-brand-700 hover:underline">Create an account</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {location.state?.notice && <Alert tone="success">{location.state.notice}</Alert>}
        {expired && !message && <Alert tone="info">Your session expired. Please sign in again.</Alert>}
        {message && <Alert>{message}</Alert>}
        <TextInput label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} required autoFocus />
        <TextInput label="Password" type="password" autoComplete="current-password" value={form.password} onChange={set('password')} error={errors.password} required />
        <div className="text-right text-sm">
          <Link to="/forgot-password" className="font-medium text-brand-700 hover:underline">Forgot your password?</Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { form, set, errors, message, busy, run } = useForm({ email: '' });
  const [sent, setSent] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/auth/forgot', { method: 'POST', body: { email: form.email } });
      setSent(true);
    });
  };

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we will send you a link to choose a new one."
      footer={<>Remembered it? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></>}
    >
      {sent ? (
        // Same wording whether or not the account exists.
        <Alert tone="success">If an account exists for that email, a reset link is on its way. The link works for 30 minutes.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {message && <Alert>{message}</Alert>}
          <TextInput label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} required autoFocus />
          <Button type="submit" size="lg" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const { form, set, errors, message, busy, run } = useForm({ password: '', confirm: '' });

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/auth/reset', { method: 'POST', body: { token, password: form.password, confirm: form.confirm } });
      navigate('/login', { replace: true, state: { notice: 'Your password was changed. Sign in with your new password.' } });
    });
  };

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Pick a new password for your account. You will be signed out everywhere."
      footer={<Link to="/login" className="font-medium text-brand-700 hover:underline">Back to sign in</Link>}
    >
      {!token ? (
        <Alert>
          This reset link is incomplete. <Link to="/forgot-password" className="font-medium underline">Request a new one</Link>.
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {message && (
            <Alert>
              {message} <Link to="/forgot-password" className="font-medium underline">Request a new link</Link>
            </Alert>
          )}
          <TextInput
            label="New password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            error={errors.password}
            hint="At least 10 characters, including a letter and a number."
            required
            autoFocus
          />
          <TextInput label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} required />
          <Button type="submit" size="lg" className="w-full" loading={busy}>Change password</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function RegisterPage() {
  const { signedIn, status, register } = useAuth();
  const navigate = useNavigate();
  const { form, set, errors, message, busy, run } = useForm({ first: '', last: '', email: '', password: '' });

  if (status === 'loading') return <PageLoader />;
  if (signedIn) return <Navigate to="/" replace />;

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await register(form);
      navigate('/', { replace: true });
    });
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Join to reserve your seat at upcoming events."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {message && <Alert>{message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="First name" autoComplete="given-name" value={form.first} onChange={set('first')} error={errors.first} required autoFocus />
          <TextInput label="Last name" autoComplete="family-name" value={form.last} onChange={set('last')} error={errors.last} required />
        </div>
        <TextInput label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} required />
        <TextInput
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          hint="At least 10 characters, including a letter and a number."
          required
        />
        <Button type="submit" size="lg" className="w-full" loading={busy}>Create account</Button>
      </form>
    </AuthShell>
  );
}
