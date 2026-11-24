import { useId } from 'react';

const control =
  'block w-full rounded-lg border bg-surface px-3 text-sm text-ink-900 shadow-sm placeholder:text-ink-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-50 disabled:text-ink-500';
const border = (error) => (error ? 'border-danger-400' : 'border-ink-300');

/** Label + control + hint/error, wired together for screen readers. */
export function Field({ label, hint, error, required, children, className = '' }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-700">
          {label}
          {required && <span className="ml-0.5 text-danger-600" aria-hidden="true">*</span>}
        </label>
      )}
      {children({ id, 'aria-invalid': Boolean(error) || undefined, 'aria-describedby': describedBy, required })}
      {error ? (
        <p id={`${id}-error`} className="anim-hint mt-1.5 text-xs text-danger-700">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ label, hint, error, required, className, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(a11y) => <input className={`${control} ${border(error)} h-10`} {...a11y} {...props} />}
    </Field>
  );
}

export function TextArea({ label, hint, error, required, className, rows = 4, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(a11y) => <textarea rows={rows} className={`${control} ${border(error)} py-2`} {...a11y} {...props} />}
    </Field>
  );
}

export function Select({ label, hint, error, required, className, children, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(a11y) => (
        <select className={`${control} ${border(error)} h-10 pr-8`} {...a11y} {...props}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({ label, description, className = '', ...props }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 ${className}`}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 accent-brand-600 focus:ring-brand-500"
        {...props}
      />
      <span className="text-sm">
        <span className="font-medium text-ink-800">{label}</span>
        {description && <span className="block text-ink-500">{description}</span>}
      </span>
    </label>
  );
}
