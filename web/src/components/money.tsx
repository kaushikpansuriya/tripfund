import type { ReactNode } from 'react';
import { money, moneySigned } from '../lib/format.ts';
import type { MemberBalance } from '../types.ts';
import { cx } from './ui.tsx';

export type Tone = 'added' | 'spent' | 'receive' | 'owe' | 'remain' | 'slate';

const TONE_TEXT: Record<Tone, string> = {
  added: 'text-added-700',
  spent: 'text-spent-700',
  receive: 'text-receive-700',
  owe: 'text-owe-700',
  remain: 'text-remain-700',
  slate: 'text-slate-900',
};

const TONE_BAR: Record<Tone, string> = {
  added: 'bg-added-500',
  spent: 'bg-spent-500',
  receive: 'bg-receive-500',
  owe: 'bg-owe-500',
  remain: 'bg-remain-500',
  slate: 'bg-slate-400',
};

export function StatCard({ label, value, tone, hint }: { label: string; value: ReactNode; tone: Tone; hint?: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <span className={cx('absolute inset-y-0 left-0 w-1', TONE_BAR[tone])} aria-hidden />
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cx('mt-1 text-xl font-bold tabular-nums sm:text-2xl', TONE_TEXT[tone])}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Net balance with colour: green = receives, orange = pays, grey = settled. */
export function NetAmount({ net, currency, className }: { net: number; currency: string; className?: string }) {
  return (
    <span className={cx('font-semibold tabular-nums', net > 0 ? 'text-receive-700' : net < 0 ? 'text-owe-700' : 'text-slate-500', className)}>
      {net === 0 ? money(0, currency) : moneySigned(net, currency)}
    </span>
  );
}

/** "John should receive ₹5,500" / "David needs to pay ₹3,000" / "Sarah is settled". */
export function balanceSentence(b: Pick<MemberBalance, 'name' | 'net'>, currency: string, you = false): string {
  const who = you ? 'You' : b.name;
  if (b.net > 0) return `${who} should receive ${money(b.net, currency)}`;
  if (b.net < 0) return `${who} ${you ? 'need' : 'needs'} to pay ${money(-b.net, currency)}`;
  return `${who} ${you ? 'are' : 'is'} settled up`;
}

/** Horizontal bar list, e.g. spending by category. */
export function BarList({ items, currency, tone = 'spent' }: { items: { key: string; label: ReactNode; amount: number }[]; currency: string; tone?: Tone }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.amount)));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.key}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-slate-700">{i.label}</span>
            <span className="font-medium tabular-nums">{money(i.amount, currency)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className={cx('h-2 rounded-full', TONE_BAR[tone])} style={{ width: `${Math.max(2, (Math.abs(i.amount) / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
