import { Spinner } from './Feedback';

const variants = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300',
  secondary: 'border border-ink-300 bg-white text-ink-700 hover:bg-ink-50 disabled:text-ink-400',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 disabled:text-ink-300',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 disabled:bg-danger-300',
  'danger-ghost': 'text-danger-700 hover:bg-danger-50 disabled:text-danger-300',
};

const sizes = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
};

export function Button({ variant = 'primary', size = 'md', loading = false, className = '', children, disabled, ...props }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}
