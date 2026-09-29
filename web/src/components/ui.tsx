import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { ApiError } from '../lib/api.ts';
import { AlertIcon, XIcon } from './icons.tsx';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-remain-700 text-white hover:bg-remain-600 focus-visible:outline-remain-700 shadow-sm',
  secondary: 'bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'bg-spent-600 text-white hover:bg-spent-700 shadow-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  busy,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-sm' : 'px-4 py-2.5 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {busy && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function PageSpinner() {
  return (
    <div className="flex justify-center py-16 text-slate-400">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
const inputClass =
  'block w-full rounded-lg border-0 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-remain-600 disabled:bg-slate-100 sm:text-sm';

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-spent-600">{error}</p>}
    </div>
  );
}

export function Input({ label, error, hint, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: ReactNode }) {
  const id = useId();
  const input = <input id={id} {...props} className={cx(inputClass, error && 'ring-spent-500', className)} />;
  return label ? (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      {input}
    </Field>
  ) : (
    input
  );
}

export function Select({ label, error, hint, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string; hint?: ReactNode }) {
  const id = useId();
  const select = (
    <select id={id} {...props} className={cx(inputClass, 'pr-8', error && 'ring-spent-500', className)}>
      {children}
    </select>
  );
  return label ? (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      {select}
    </Field>
  ) : (
    select
  );
}

export function Textarea({ label, error, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  const id = useId();
  return (
    <Field label={label ?? ''} error={error} htmlFor={id}>
      <textarea id={id} rows={3} {...props} className={cx(inputClass, className)} />
    </Field>
  );
}

/** Amount input: text field with decimal keyboard and currency symbol. */
export function MoneyInput({
  label,
  value,
  onChange,
  symbol,
  error,
  hint,
  autoFocus,
  placeholder = '0.00',
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  symbol: string;
  error?: string;
  hint?: ReactNode;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const input = (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">{symbol}</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        className={cx(inputClass, 'pl-10 tabular-nums', error && 'ring-spent-500')}
      />
    </div>
  );
  return label ? (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      {input}
    </Field>
  ) : (
    input
  );
}

// ---------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------
export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 px-6 py-10 text-center">
      <p className="font-semibold text-slate-800">{title}</p>
      {text && <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ error, onClose }: { error: ApiError | string | null | undefined; onClose?: () => void }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-spent-50 p-3 text-sm text-spent-700 ring-1 ring-spent-100">
      <AlertIcon size={18} className="mt-0.5 shrink-0" />
      <p className="flex-1">{message}</p>
      {onClose && (
        <button type="button" onClick={onClose} className="text-spent-600 hover:text-spent-700" aria-label="Dismiss">
          <XIcon size={16} />
        </button>
      )}
    </div>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'added' | 'spent' | 'receive' | 'owe' | 'remain' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    added: 'bg-added-50 text-added-700',
    spent: 'bg-spent-50 text-spent-700',
    receive: 'bg-receive-50 text-receive-700',
    owe: 'bg-owe-50 text-owe-700',
    remain: 'bg-remain-50 text-remain-700',
  };
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const palette = ['bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-amber-100 text-amber-800', 'bg-emerald-100 text-emerald-700', 'bg-pink-100 text-pink-700', 'bg-indigo-100 text-indigo-700'];
  const color = palette[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % palette.length];
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm', color)}>
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal (bottom sheet on phones, centred dialog on larger screens)
// ---------------------------------------------------------------------------
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

/** A button that asks "Are you sure?" in a small dialog before running. */
export function ConfirmButton({
  children,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  variant = 'ghost',
  size = 'sm',
  className,
  ariaLabel,
}: {
  children: ReactNode;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown> | void;
  variant?: Variant;
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={ariaLabel}
      >
        {children}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onConfirm();
                  setOpen(false);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <div>{message}</div>
          <ErrorBanner error={error} />
        </div>
      </Modal>
    </>
  );
}

/** Segmented control, used for split methods and toggles. */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="grid rounded-lg bg-slate-100 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md px-2 py-1.5 text-sm font-medium transition',
            value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
          )}
          aria-pressed={value === o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
