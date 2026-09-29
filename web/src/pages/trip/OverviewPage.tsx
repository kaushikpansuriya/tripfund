import { AlertIcon, ArrowRightIcon } from '../../components/icons.tsx';
import { balanceSentence, BarList, NetAmount, StatCard } from '../../components/money.tsx';
import { Avatar, Badge, Button, Card, cx, EmptyState } from '../../components/ui.tsx';
import { formatDate, formatDateRange, money, plural } from '../../lib/format.ts';
import { Link, useRouter } from '../../lib/router.tsx';
import { useTrip } from './TripContext.tsx';

export function OverviewPage() {
  const { trip, summary, me, base, memberName, members } = useTrip();
  const { navigate } = useRouter();
  const { totals } = summary;
  const c = trip.currency;
  const mine = summary.members.find((m) => m.memberId === me.memberId);
  const checksOk = Object.values(summary.checks).every(Boolean);
  const maxDay = Math.max(1, ...summary.byDate.map((d) => d.amount));
  const empty = totals.expenseCount + totals.contributionCount === 0;

  return (
    <div className="space-y-5">
      {!checksOk && (
        <div className="flex items-start gap-2 rounded-xl bg-owe-50 p-3 text-sm text-owe-700 ring-1 ring-owe-100">
          <AlertIcon size={18} className="mt-0.5 shrink-0" />
          The calculation self-check found a mismatch. Please report this to the trip owner; no numbers were changed.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Money added" value={money(totals.contributions, c)} tone="added" hint={plural(totals.contributionCount, 'contribution')} />
        <StatCard
          label="Total spent"
          value={money(totals.expenses, c)}
          tone="spent"
          hint={totals.refunds > 0 ? `after ${money(totals.refunds, c)} refunds` : plural(totals.expenseCount, 'expense')}
        />
        <StatCard
          label="Remaining"
          value={money(totals.fundRemaining, c)}
          tone={totals.fundRemaining >= 0 ? 'remain' : 'owe'}
          hint={totals.fundRemaining >= 0 ? 'money added − spent' : 'spent more than was added'}
        />
        <StatCard
          label="Still to settle"
          value={money(totals.totalOwed, c)}
          tone={totals.totalOwed > 0 ? 'owe' : 'receive'}
          hint={summary.settlement.length ? plural(summary.settlement.length, 'payment') + ' needed' : 'everyone is settled'}
        />
      </div>

      {empty && (
        <EmptyState
          title="Let's get started"
          text="Record the money everyone put in, then add expenses as you go. Balances and settlements are calculated automatically."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={() => navigate(`${base}/wallet`)}>
                Add money
              </Button>
              <Button onClick={() => navigate(`${base}/expenses/new`)}>Add expense</Button>
            </div>
          }
        />
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          {mine && (
            <div
              className={cx(
                'rounded-2xl p-5 ring-1',
                mine.net > 0 ? 'bg-receive-50 ring-receive-100' : mine.net < 0 ? 'bg-owe-50 ring-owe-100' : 'bg-slate-100 ring-slate-200',
              )}
            >
              <p className="text-sm font-medium text-slate-600">Your balance</p>
              <p className={cx('mt-1 text-2xl font-bold', mine.net > 0 ? 'text-receive-700' : mine.net < 0 ? 'text-owe-700' : 'text-slate-700')}>
                {balanceSentence(mine, c, true)}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                You added {money(mine.contributed, c)}, paid {money(mine.paid - mine.refundsReceived, c)} for the group, and your share of spending is{' '}
                {money(mine.share, c)}.
              </p>
            </div>
          )}

          <Card
            title="Settle up"
            action={
              <Link to={`${base}/settlements`} className="inline-flex items-center gap-1 text-sm font-medium text-remain-700 hover:underline">
                Details <ArrowRightIcon size={14} />
              </Link>
            }
          >
            {summary.settlement.length === 0 ? (
              <p className="text-sm text-slate-500">Nobody owes anything right now.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {summary.settlement.slice(0, 6).map((p) => (
                  <li key={`${p.fromMemberId}-${p.toMemberId}`} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="font-medium">{p.fromName}</span>
                    <ArrowRightIcon size={16} className="text-slate-400" />
                    <span className="font-medium">{p.toName}</span>
                    <span className="ml-auto font-semibold tabular-nums text-owe-700">{money(p.amount, c)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Balances">
            <ul className="divide-y divide-slate-100">
              {summary.members.map((b) => (
                <li key={b.memberId} className="flex items-center gap-3 py-2.5">
                  <Avatar name={b.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {b.name} {b.memberId === me.memberId && <span className="text-slate-400">(you)</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      Paid {money(b.paid - b.refundsReceived, c)} · Share {money(b.share, c)}
                      {b.fundHeld > 0 && ` · Holds fund ${money(b.fundHeld, c)}`}
                    </p>
                  </div>
                  <NetAmount net={b.net} currency={c} className="text-sm" />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              <span className="font-medium text-receive-700">Green</span> should receive money, <span className="font-medium text-owe-700">orange</span> needs to pay.
            </p>
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <Card title="Trip">
            <dl className="space-y-2 text-sm">
              <Row label="Dates" value={formatDateRange(trip.startDate, trip.endDate) || '—'} />
              <Row label="Destination" value={trip.destination || '—'} />
              <Row label="Members" value={String(members.length)} />
              <Row label="Currency" value={c} />
              <Row label="Fund holder" value={memberName(trip.fundHolderMemberId) || '—'} />
            </dl>
            {trip.description && <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">{trip.description}</p>}
          </Card>

          <Card title="Spending by category">
            {summary.byCategory.length === 0 ? (
              <p className="text-sm text-slate-500">No expenses yet.</p>
            ) : (
              <BarList
                currency={c}
                items={summary.byCategory.map((x) => ({
                  key: x.categoryId ?? 'none',
                  label: (
                    <>
                      {x.icon && <span className="mr-1.5">{x.icon}</span>}
                      {x.name}
                    </>
                  ),
                  amount: x.amount,
                }))}
              />
            )}
          </Card>

          {summary.byDate.length > 0 && (
            <Card title="Daily spending">
              <div className="flex h-36 items-end gap-1.5 overflow-x-auto pb-1">
                {summary.byDate.map((d) => (
                  <div key={d.date} className="flex min-w-[2.25rem] flex-1 flex-col items-center gap-1" title={`${formatDate(d.date)}: ${money(d.amount, c)}`}>
                    <div className="w-full rounded-t bg-spent-500/80" style={{ height: `${Math.max(3, Math.round((Math.max(0, d.amount) / maxDay) * 104))}px` }} />
                    <span className="text-[10px] text-slate-500">{formatDate(d.date, { withYear: false })}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {summary.paidByMember.length > 0 && (
            <Card title="Paid by each member">
              <BarList
                currency={c}
                tone="added"
                items={summary.paidByMember.map((p) => ({ key: p.memberId, label: p.name, amount: p.amount }))}
              />
            </Card>
          )}

          <p className="text-center text-xs text-slate-500">
            <Badge tone={checksOk ? 'receive' : 'owe'}>{checksOk ? 'Totals verified' : 'Check failed'}</Badge>
            <span className="ml-2">Shares add up to every expense and all balances sum to zero.</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
