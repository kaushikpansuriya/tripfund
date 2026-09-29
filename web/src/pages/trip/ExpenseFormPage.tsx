import { useEffect, useState, type FormEvent } from 'react';
import { computeShares, SplitError, type ShareResult } from '../../../../packages/engine/src/index.ts';
import { ArrowLeftIcon, CheckIcon } from '../../components/icons.tsx';
import { Avatar, Button, Card, cx, ErrorBanner, Input, MoneyInput, PageSpinner, Segmented, Select, Textarea } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { CURRENCIES, minorUnits, money, parseMoney, todayIso, toDecimalString } from '../../lib/format.ts';
import { Link, useRouter } from '../../lib/router.tsx';
import { useAction } from '../../lib/useApi.ts';
import type { Expense, SplitMethod } from '../../types.ts';
import { useTrip } from './TripContext.tsx';

const METHODS: { value: SplitMethod; label: string }[] = [
  { value: 'equal', label: 'Equal' },
  { value: 'exact', label: 'Amounts' },
  { value: 'percentage', label: '%' },
  { value: 'shares', label: 'Shares' },
];

const METHOD_HELP: Record<SplitMethod, string> = {
  equal: 'Everyone selected pays the same.',
  exact: 'Type the exact amount for each person.',
  percentage: 'Give each person a percentage. They must add up to 100%.',
  shares: 'Give each person a number of shares, e.g. 2 for a couple.',
};

export function ExpenseFormPage({ expenseId }: { expenseId?: string }) {
  const { trip, members, categories, me, base, refresh } = useTrip();
  const { navigate } = useRouter();
  const { busy, error, run } = useAction();
  const c = trip.currency;
  const units = minorUnits(c);
  const symbol = CURRENCIES[c]?.symbol ?? c;
  const activeIds = members.filter((m) => m.status === 'active').map((m) => m.id);

  const [loaded, setLoaded] = useState(!expenseId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<'expense' | 'refund'>('expense');
  const [title, setTitle] = useState('');
  const [amountText, setAmountText] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paidBy, setPaidBy] = useState(me.memberId);
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<SplitMethod>('equal');
  const [selected, setSelected] = useState<string[]>(activeIds);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showMore, setShowMore] = useState(false);

  // Edit mode: load the expense into the form.
  useEffect(() => {
    if (!expenseId) return;
    api
      .get<{ expense: Expense }>(`/trips/${trip.id}/expenses/${expenseId}`)
      .then(({ expense: e }) => {
        setKind(e.kind);
        setTitle(e.title);
        setAmountText(toDecimalString(e.amount, units));
        setCategoryId(e.categoryId ?? '');
        setPaidBy(e.paidByMemberId);
        setDate(e.date);
        setTime(e.time ?? '');
        setLocation(e.location ?? '');
        setNotes(e.notes ?? '');
        setMethod(e.splitMethod);
        setSelected(e.participants.map((p) => p.memberId));
        const v: Record<string, string> = {};
        for (const p of e.participants) {
          if (p.value === null) continue;
          v[p.memberId] = e.splitMethod === 'exact' ? toDecimalString(p.value, units) : String(p.value);
        }
        setValues(v);
        setShowMore(Boolean(e.time || e.location || e.notes));
        setLoaded(true);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [expenseId, trip.id, units]);

  const amount = parseMoney(amountText, units);
  // Participants in member order so the split is stable and predictable.
  const participants = members.filter((m) => selected.includes(m.id));

  const splitInput = participants.map((m) => {
    const raw = values[m.id] ?? '';
    let value: number | null = null;
    if (method === 'exact') value = parseMoney(raw || '0', units);
    else if (method === 'percentage') value = raw === '' ? 0 : Number(raw);
    else if (method === 'shares') value = raw === '' ? 1 : Number(raw);
    return { memberId: m.id, value };
  });

  // Live preview with the same engine the server uses.
  const preview = ((): { shares: Map<string, number> | null; problem: string | null } => {
    if (!amount) return { shares: null, problem: null };
    if (participants.length === 0) return { shares: null, problem: 'Select at least one person.' };
    if (method === 'exact' && splitInput.some((p) => p.value === null)) return { shares: null, problem: 'One of the amounts is not a valid number.' };
    try {
      const result: ShareResult[] = computeShares(amount, method, splitInput);
      return { shares: new Map(result.map((r) => [r.memberId, r.share])), problem: null };
    } catch (e) {
      if (e instanceof SplitError) {
        if (e.code === 'EXACT_SUM_MISMATCH') {
          const diff = Number(e.details.difference);
          return { shares: null, problem: diff > 0 ? `${money(diff, c)} still to assign.` : `${money(-diff, c)} too much assigned.` };
        }
        if (e.code === 'PERCENT_SUM_MISMATCH') {
          const actual = Number(e.details.actual);
          return { shares: null, problem: `Percentages add up to ${actual}%, not 100%.` };
        }
        return { shares: null, problem: e.message };
      }
      return { shares: null, problem: String(e) };
    }
  })();

  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const fillEvenly = () => {
    if (!amount || participants.length === 0) return;
    const equal = computeShares(amount, 'equal', participants.map((m) => ({ memberId: m.id })));
    const next = { ...values };
    if (method === 'exact') for (const s of equal) next[s.memberId] = toDecimalString(s.share, units);
    if (method === 'percentage') {
      const bp = computeShares(10000, 'equal', participants.map((m) => ({ memberId: m.id })));
      for (const s of bp) next[s.memberId] = (s.share / 100).toString();
    }
    setValues(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!amount || !preview.shares) return;
    const body = {
      kind,
      title,
      categoryId: categoryId || null,
      amount,
      paidByMemberId: paidBy,
      splitMethod: method,
      participants: splitInput,
      date,
      time: time || null,
      location: location || null,
      notes: notes || null,
    };
    const saved = await run(async () => {
      const r = expenseId
        ? await api.put<{ expense: Expense }>(`/trips/${trip.id}/expenses/${expenseId}`, body)
        : await api.post<{ expense: Expense }>(`/trips/${trip.id}/expenses`, body);
      await refresh();
      return r;
    });
    if (saved) navigate(`${base}/expenses`);
  };

  if (loadError) return <ErrorBanner error={loadError} />;
  if (!loaded) return <PageSpinner />;

  const fields = error?.fieldErrors() ?? {};
  const refund = kind === 'refund';
  const payerShare = preview.shares?.get(paidBy) ?? 0;

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to={`${base}/expenses`} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Back to expenses">
          <ArrowLeftIcon size={18} />
        </Link>
        <h2 className="text-lg font-semibold">{expenseId ? 'Edit' : 'Add'} {refund ? 'refund' : 'expense'}</h2>
      </div>

      <Card>
        <div className="space-y-4">
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'refund', label: 'Refund received' },
            ]}
          />
          <MoneyInput label="Amount" value={amountText} onChange={setAmountText} symbol={symbol} autoFocus={!expenseId} error={fields.amount ?? (amountText && !amount ? 'Enter a valid amount' : undefined)} />
          <Input
            label={refund ? 'What was refunded?' : 'What was it for?'}
            placeholder={refund ? 'Hotel night cancelled' : 'Dinner at the beach shack'}
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={fields.title}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label={refund ? 'Received by' : 'Paid by'} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.id === me.memberId ? ' (you)' : ''}
                  {m.status === 'left' ? ' – left' : ''}
                </option>
              ))}
            </Select>
            <Select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.icon} {cat.name}
                </option>
              ))}
            </Select>
            <Input label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} error={fields.date} />
            {showMore ? (
              <Input label="Time (optional)" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            ) : (
              <div className="flex items-end">
                <Button variant="ghost" size="sm" onClick={() => setShowMore(true)}>
                  + Time, place and notes
                </Button>
              </div>
            )}
          </div>
          {showMore && (
            <div className="grid gap-4">
              <Input label="Location (optional)" placeholder="Baga Beach" value={location} onChange={(e) => setLocation(e.target.value)} />
              <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </div>
          )}
        </div>
      </Card>

      <Card title={refund ? 'Who gets money back?' : 'Who shares this?'}>
        <div className="space-y-3">
          <Segmented value={method} onChange={setMethod} options={METHODS} />
          <p className="text-xs text-slate-500">{METHOD_HELP[method]}</p>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">{participants.length} of {members.length} selected</span>
            <span className="flex gap-3">
              <button type="button" className="font-medium text-remain-700 hover:underline" onClick={() => setSelected(members.map((m) => m.id))}>
                All
              </button>
              <button type="button" className="font-medium text-remain-700 hover:underline" onClick={() => setSelected([])}>
                None
              </button>
              {(method === 'exact' || method === 'percentage') && (
                <button type="button" className="font-medium text-remain-700 hover:underline" onClick={fillEvenly}>
                  Fill evenly
                </button>
              )}
            </span>
          </div>

          <ul className="space-y-2">
            {members.map((m) => {
              const on = selected.includes(m.id);
              const share = preview.shares?.get(m.id);
              return (
                <li key={m.id} className={cx('flex items-center gap-2 rounded-xl px-3 py-2 ring-1 sm:gap-3', on ? 'bg-white ring-remain-500/40' : 'bg-slate-50 ring-slate-200')}>
                  <button
                    type="button"
                    onClick={() => toggle(m.id)}
                    aria-pressed={on}
                    aria-label={`${on ? 'Remove' : 'Add'} ${m.name}`}
                    className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2', on ? 'border-remain-700 bg-remain-700 text-white' : 'border-slate-300 bg-white')}
                  >
                    {on && <CheckIcon size={14} />}
                  </button>
                  <span className={cx(method !== 'equal' && 'hidden sm:inline-flex')}>
                    <Avatar name={m.name} size="sm" />
                  </span>
                  <span className={cx('min-w-0 flex-1 truncate text-sm', !on && 'text-slate-400')}>{m.name}</span>
                  {on && method !== 'equal' && (
                    <div className="relative w-24 shrink-0 sm:w-28">
                      <input
                        aria-label={`${m.name} ${method === 'exact' ? 'amount' : method === 'percentage' ? 'percent' : 'shares'}`}
                        inputMode="decimal"
                        placeholder={method === 'shares' ? '1' : '0'}
                        value={values[m.id] ?? ''}
                        onChange={(e) => setValues({ ...values, [m.id]: e.target.value.replace(/[^\d.]/g, '') })}
                        className="block w-full rounded-lg border-0 py-1.5 pl-2 pr-7 text-right text-sm tabular-nums ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-remain-600"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-slate-400">
                        {method === 'exact' ? symbol : method === 'percentage' ? '%' : '×'}
                      </span>
                    </div>
                  )}
                  <span className="w-[4.5rem] shrink-0 text-right text-sm font-semibold tabular-nums text-slate-800 sm:w-20">{on && share !== undefined ? money(share, c) : ''}</span>
                </li>
              );
            })}
          </ul>

          {preview.problem && <p className="rounded-lg bg-owe-50 px-3 py-2 text-sm font-medium text-owe-700">{preview.problem}</p>}
          {preview.shares && amount && !refund && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {members.find((m) => m.id === paidBy)?.name} paid {money(amount, c)}
              {payerShare > 0 ? ` and their own share is ${money(payerShare, c)}` : ' and does not share this expense'}, so they are owed{' '}
              <span className="font-semibold text-receive-700">{money(amount - payerShare, c)}</span>.
            </p>
          )}
        </div>
      </Card>

      {error && Object.keys(fields).length === 0 && <ErrorBanner error={error} />}
      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-slate-200 bg-slate-50/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:justify-end sm:border-0 sm:bg-transparent sm:p-0">
        <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => navigate(`${base}/expenses`)}>
          Cancel
        </Button>
        <Button type="submit" busy={busy} disabled={!amount || !preview.shares || !title.trim()} className="flex-1 sm:flex-none">
          {expenseId ? 'Save changes' : `Add ${refund ? 'refund' : 'expense'}`}
        </Button>
      </div>
    </form>
  );
}
