import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

/** Accessible dialog: focus moves in on open, Escape and backdrop close, focus returns on close. */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const titleId = useId();
  const panel = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const focusable = panel.current?.querySelector('input, select, textarea, button:not([data-close])');
    (focusable || panel.current)?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = size === 'lg' ? 'max-w-2xl' : size === 'sm' ? 'max-w-sm' : 'max-w-lg';

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center p-4 sm:items-center">
      <div className="anim-backdrop absolute inset-0 bg-ink-900/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`anim-dialog relative flex max-h-[90vh] w-full ${width} flex-col rounded-xl bg-white shadow-pop`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-6 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-ink-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} data-close aria-label="Close dialog">
            Close
          </Button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-3 border-t border-ink-100 px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', tone = 'danger', busy, onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-600">{children}</div>
    </Modal>
  );
}
