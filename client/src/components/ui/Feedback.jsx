export function Spinner({ className = 'h-5 w-5' }) {
  return <span className={`spinner inline-block ${className}`} aria-hidden="true" />;
}

const alertTones = {
  error: 'border-danger-200 bg-danger-50 text-danger-800',
  success: 'border-success-200 bg-success-50 text-success-800',
  info: 'border-brand-200 bg-brand-50 text-brand-800',
  warning: 'border-warning-200 bg-warning-50 text-warning-800',
};

export function Alert({ tone = 'error', title, children, action }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${alertTones[tone]}`}>
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300 bg-white px-6 py-12 text-center">
      <p className="text-base font-semibold text-ink-900">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-ink-500" role="status">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  );
}

const badgeTones = {
  neutral: 'bg-ink-100 text-ink-700',
  brand: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200',
  success: 'bg-success-50 text-success-700 ring-1 ring-inset ring-success-200',
  warning: 'bg-warning-50 text-warning-800 ring-1 ring-inset ring-warning-200',
  danger: 'bg-danger-50 text-danger-700 ring-1 ring-inset ring-danger-200',
};

export function Badge({ tone = 'neutral', children }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}
