import { CURRENCIES, formatMoney, parseMoney, toDecimalString } from '../../../packages/engine/src/index.ts';

export { CURRENCIES, parseMoney, toDecimalString };

export const money = (minor: number, currency: string) => formatMoney(minor, currency, { hideZeroDecimals: true });
export const moneyExact = (minor: number, currency: string) => formatMoney(minor, currency);
export const moneySigned = (minor: number, currency: string) => formatMoney(minor, currency, { signed: true, hideZeroDecimals: true });

export const minorUnits = (currency: string) => CURRENCIES[currency]?.minorUnits ?? 2;

/** "2026-09-10" → "10 Sep 2026" (no timezone shifts). */
export function formatDate(value: string | null | undefined, options: { withYear?: boolean; withWeekday?: boolean } = {}): string {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: options.withYear === false ? undefined : 'numeric',
    weekday: options.withWeekday ? 'short' : undefined,
    timeZone: 'UTC',
  }).format(date);
}

export function formatDateRange(start: string | null, end: string | null): string {
  if (start && end) return start === end ? formatDate(start) : `${formatDate(start, { withYear: start.slice(0, 4) !== end.slice(0, 4) })} – ${formatDate(end)}`;
  if (start) return `From ${formatDate(start)}`;
  if (end) return `Until ${formatDate(end)}`;
  return '';
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'debit_card', label: 'Debit card' },
  { value: 'other', label: 'Other' },
];

export const paymentMethodLabel = (value: string) => PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;

export const SPLIT_LABELS: Record<string, string> = {
  equal: 'Equal',
  exact: 'Custom amounts',
  percentage: 'Percentage',
  shares: 'Shares',
};

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}
