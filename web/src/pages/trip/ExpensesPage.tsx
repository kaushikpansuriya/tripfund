import { useEffect, useState } from 'react';
import { EditIcon, MapPinIcon, PlusIcon, SearchIcon, TrashIcon } from '../../components/icons.tsx';
import { Avatar, Badge, Button, ConfirmButton, cx, EmptyState, ErrorBanner, Input, PageSpinner, Select } from '../../components/ui.tsx';
import { api, qs } from '../../lib/api.ts';
import { formatDate, money, plural, SPLIT_LABELS } from '../../lib/format.ts';
import { useRouter } from '../../lib/router.tsx';
import { useApi } from '../../lib/useApi.ts';
import type { Expense } from '../../types.ts';
import { useTrip } from './TripContext.tsx';

export function ExpensesPage() {
  const { trip, members, categories, base, memberName, category, refresh } = useTrip();
  const { navigate } = useRouter();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ memberId: '', categoryId: '', from: '', to: '', sort: 'date_desc' });
  const [open, setOpen] = useState<string | null>(null);

  // Wait until typing pauses before searching.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const path = `/trips/${trip.id}/expenses${qs({ q, ...filters, sort: filters.sort === 'date_desc' ? '' : filters.sort })}`;
  const { data, error, loading, reload } = useApi<{ expenses: Expense[] }>(path);
  const expenses = data?.expenses ?? [];
  const total = expenses.reduce((s, e) => s + (e.kind === 'refund' ? -e.amount : e.amount), 0);
  const filtered = q || Object.entries(filters).some(([k, v]) => k !== 'sort' && v);
  const c = trip.currency;

  const set = (key: keyof typeof filters) => (e: { target: { value: string } }) => setFilters({ ...filters, [key]: e.target.value });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Expenses</h2>
        <Button onClick={() => navigate(`${base}/expenses/new`)} className="hidden sm:inline-flex">
          <PlusIcon size={18} /> Add expense
        </Button>
      </div>

      <div className="space-y-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <div className="relative">
          <SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input aria-label="Search expenses" placeholder="Search title, place or notes" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Select aria-label="Filter by member" value={filters.memberId} onChange={set('memberId')}>
            <option value="">All members</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by category" value={filters.categoryId} onChange={set('categoryId')}>
            <option value="">All categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.icon} {cat.name}
              </option>
            ))}
          </Select>
          <Input aria-label="From date" type="date" value={filters.from} onChange={set('from')} />
          <Input aria-label="To date" type="date" value={filters.to} onChange={set('to')} />
          <Select aria-label="Sort" value={filters.sort} onChange={set('sort')} className="col-span-2 md:col-span-1">
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="amount_desc">Highest amount</option>
            <option value="amount_asc">Lowest amount</option>
          </Select>
        </div>
        <div className="flex items-center justify-between px-1 text-sm">
          <span className="text-slate-600">
            {plural(expenses.length, 'item')} · <span className="font-semibold text-spent-700">{money(total, c)}</span>
          </span>
          {filtered && (
            <button
              type="button"
              className="text-remain-700 hover:underline"
              onClick={() => {
                setSearch('');
                setFilters({ memberId: '', categoryId: '', from: '', to: '', sort: 'date_desc' });
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <ErrorBanner error={error} />
      {loading && !data && <PageSpinner />}
      {data && expenses.length === 0 && (
        <EmptyState
          title={filtered ? 'No expenses match these filters' : 'No expenses yet'}
          text={filtered ? undefined : 'Add the first expense. You choose who paid and who shares it.'}
          action={!filtered && <Button onClick={() => navigate(`${base}/expenses/new`)}>Add expense</Button>}
        />
      )}

      {expenses.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          {expenses.map((e) => {
            const cat = category(e.categoryId);
            const refund = e.kind === 'refund';
            const isOpen = open === e.id;
            return (
              <li key={e.id}>
                <button type="button" onClick={() => setOpen(isOpen ? null : e.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50" aria-expanded={isOpen}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-lg" aria-hidden>
                    {cat?.icon ?? '🧾'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{e.title}</span>
                      {refund && <Badge tone="receive">Refund</Badge>}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {formatDate(e.date, { withYear: false })} · {refund ? 'received by' : 'paid by'} {memberName(e.paidByMemberId)} · {plural(e.participants.length, 'person', 'people')}
                    </span>
                  </span>
                  <span className={cx('text-right font-semibold tabular-nums', refund ? 'text-receive-700' : 'text-spent-700')}>
                    {refund ? '−' : ''}
                    {money(e.amount, c)}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-3 bg-slate-50 px-4 pb-4 pt-2 text-sm">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600">
                      <span>{formatDate(e.date, { withWeekday: true })}{e.time && ` at ${e.time}`}</span>
                      {cat && <span>{cat.name}</span>}
                      <span>{SPLIT_LABELS[e.splitMethod]} split</span>
                      {e.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPinIcon size={14} /> {e.location}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{refund ? 'Shared back to' : 'Shared by'}</p>
                      <ul className="grid gap-1.5 sm:grid-cols-2">
                        {e.participants.map((p) => (
                          <li key={p.memberId} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                            <Avatar name={memberName(p.memberId)} size="sm" />
                            <span className="flex-1">{memberName(p.memberId)}</span>
                            {e.splitMethod === 'percentage' && <span className="text-xs text-slate-500">{p.value}%</span>}
                            {e.splitMethod === 'shares' && <span className="text-xs text-slate-500">{plural(Number(p.value), 'share')}</span>}
                            <span className="font-medium tabular-nums">{money(p.share, c)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {e.notes && <p className="whitespace-pre-line text-slate-600">{e.notes}</p>}
                    {e.canEdit && (
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={() => navigate(`${base}/expenses/${e.id}/edit`)}>
                          <EditIcon size={16} /> Edit
                        </Button>
                        <ConfirmButton
                          title="Delete expense?"
                          message={`"${e.title}" (${money(e.amount, c)}) will be removed and all balances recalculated.`}
                          onConfirm={async () => {
                            await api.delete(`/trips/${trip.id}/expenses/${e.id}`);
                            await Promise.all([reload(), refresh()]);
                          }}
                        >
                          <TrashIcon size={16} /> Delete
                        </ConfirmButton>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
