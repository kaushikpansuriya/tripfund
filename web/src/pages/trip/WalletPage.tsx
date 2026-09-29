import { useState } from 'react';
import { EditIcon, PlusIcon, TrashIcon } from '../../components/icons.tsx';
import { StatCard } from '../../components/money.tsx';
import { Avatar, Button, Card, ConfirmButton, cx, EmptyState, ErrorBanner, Input, Modal, MoneyInput, Select, Textarea } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { CURRENCIES, formatDate, minorUnits, money, parseMoney, PAYMENT_METHODS, paymentMethodLabel, todayIso, toDecimalString } from '../../lib/format.ts';
import { useAction, useApi } from '../../lib/useApi.ts';
import type { Contribution, Expense } from '../../types.ts';
import { useTrip } from './TripContext.tsx';

export function WalletPage() {
  const { trip, summary, memberName, refresh } = useTrip();
  const contributions = useApi<{ contributions: Contribution[] }>(`/trips/${trip.id}/contributions`);
  const expenses = useApi<{ expenses: Expense[] }>(`/trips/${trip.id}/expenses?sort=date_asc`);
  const [editing, setEditing] = useState<Contribution | 'new' | null>(null);
  const c = trip.currency;
  const { totals } = summary;
  const holders = summary.members.filter((m) => m.fundHeld > 0);

  const reloadAll = async () => {
    await Promise.all([contributions.reload(), expenses.reload(), refresh()]);
  };

  // Wallet history: + contributions, − expenses, + refunds, with a running balance.
  const history = [
    ...(contributions.data?.contributions ?? []).map((x) => ({ id: x.id, date: x.date, amount: x.amount, who: memberName(x.memberId), what: 'Contribution', kind: 'in' as const })),
    ...(expenses.data?.expenses ?? []).map((e) => ({
      id: e.id,
      date: e.date,
      amount: e.kind === 'refund' ? e.amount : -e.amount,
      who: memberName(e.paidByMemberId),
      what: e.kind === 'refund' ? `Refund: ${e.title}` : e.title,
      kind: e.kind === 'refund' ? ('in' as const) : ('out' as const),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'in' ? -1 : 1));
  let running = 0;
  const withBalance = history.map((h) => ({ ...h, balance: (running += h.amount) }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Money added" value={money(totals.contributions, c)} tone="added" />
        <StatCard label="Spent" value={money(totals.expenses, c)} tone="spent" />
        <StatCard label="Remaining" value={money(totals.fundRemaining, c)} tone={totals.fundRemaining >= 0 ? 'remain' : 'owe'} />
      </div>

      <Card
        title="Contributions"
        action={
          <Button size="sm" onClick={() => setEditing('new')}>
            <PlusIcon size={16} /> Add money
          </Button>
        }
      >
        {holders.length > 0 && (
          <p className="mb-3 rounded-lg bg-added-50 px-3 py-2 text-sm text-added-700">
            {holders.map((h) => `${h.name} holds ${money(h.fundHeld, c)}`).join(' · ')}. Money given to someone counts in the giver's favour and is settled at the end.
          </p>
        )}
        <ErrorBanner error={contributions.error} />
        {contributions.data && contributions.data.contributions.length === 0 && (
          <EmptyState title="No money added yet" text="Record how much each person put into the trip fund, and who is holding it." />
        )}
        <ul className="divide-y divide-slate-100">
          {contributions.data?.contributions.map((x) => (
            <li key={x.id} className="flex items-center gap-3 py-3">
              <Avatar name={memberName(x.memberId)} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {memberName(x.memberId)}
                  {x.receivedByMemberId !== x.memberId && <span className="font-normal text-slate-500"> → {memberName(x.receivedByMemberId)}</span>}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {formatDate(x.date)} · {paymentMethodLabel(x.paymentMethod)}
                  {x.receivedByMemberId === x.memberId && ' · kept by themselves'}
                  {x.notes && ` · ${x.notes}`}
                </p>
              </div>
              <span className="font-semibold tabular-nums text-added-700">+{money(x.amount, c)}</span>
              {x.canEdit && (
                <span className="flex">
                  <Button variant="ghost" size="sm" aria-label="Edit contribution" onClick={() => setEditing(x)}>
                    <EditIcon size={16} />
                  </Button>
                  <ConfirmButton
                    ariaLabel="Delete contribution"
                    title="Delete contribution?"
                    message={`${memberName(x.memberId)}'s contribution of ${money(x.amount, c)} will be removed.`}
                    onConfirm={async () => {
                      await api.delete(`/trips/${trip.id}/contributions/${x.id}`);
                      await reloadAll();
                    }}
                  >
                    <TrashIcon size={16} />
                  </ConfirmButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Wallet history">
        {withBalance.length === 0 ? (
          <p className="text-sm text-slate-500">Money added and spent will appear here in date order.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 font-medium sm:px-2">Date</th>
                  <th className="px-2 py-2 font-medium">Item</th>
                  <th className="px-2 py-2 font-medium">Member</th>
                  <th className="px-2 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-2">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {withBalance.map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500 sm:px-2">{formatDate(h.date, { withYear: false })}</td>
                    <td className="px-2 py-2">{h.what}</td>
                    <td className="px-2 py-2 text-slate-600">{h.who}</td>
                    <td className={cx('whitespace-nowrap px-2 py-2 text-right font-medium tabular-nums', h.amount >= 0 ? 'text-added-700' : 'text-spent-700')}>
                      {h.amount >= 0 ? '+' : '−'}
                      {money(Math.abs(h.amount), c)}
                    </td>
                    <td className={cx('whitespace-nowrap px-4 py-2 text-right tabular-nums sm:px-2', h.balance < 0 ? 'text-owe-700' : 'text-slate-700')}>{money(h.balance, c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <ContributionModal contribution={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={reloadAll} />}
    </div>
  );
}

function ContributionModal({ contribution, onClose, onSaved }: { contribution: Contribution | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { trip, members, me } = useTrip();
  const units = minorUnits(trip.currency);
  const { busy, error, run } = useAction();
  const [memberId, setMemberId] = useState(contribution?.memberId ?? me.memberId);
  // '' = the giver keeps the money themselves.
  const initialHolder = contribution ? contribution.receivedByMemberId : (trip.fundHolderMemberId ?? '');
  const [receivedBy, setReceivedBy] = useState(initialHolder === contribution?.memberId ? '' : initialHolder);
  const [amountText, setAmountText] = useState(contribution ? toDecimalString(contribution.amount, units) : '');
  const [date, setDate] = useState(contribution?.date ?? todayIso());
  const [method, setMethod] = useState(contribution?.paymentMethod ?? 'cash');
  const [notes, setNotes] = useState(contribution?.notes ?? '');
  const amount = parseMoney(amountText, units);

  const save = async () => {
    if (!amount) return;
    const holder = receivedBy && receivedBy !== memberId ? receivedBy : memberId;
    const body = { memberId, receivedByMemberId: holder, amount, date, paymentMethod: method, notes: notes || null };
    const ok = await run(async () => {
      if (contribution) await api.patch(`/trips/${trip.id}/contributions/${contribution.id}`, body);
      else await api.post(`/trips/${trip.id}/contributions`, body);
      await onSaved();
      return true;
    });
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={contribution ? 'Edit contribution' : 'Add money'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={busy} disabled={!amount} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner error={error} />
        <Select label="Who added the money?" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <MoneyInput label="Amount" value={amountText} onChange={setAmountText} symbol={CURRENCIES[trip.currency]?.symbol ?? trip.currency} autoFocus />
        <Select
          label="Who is holding this money?"
          value={receivedBy}
          onChange={(e) => setReceivedBy(e.target.value)}
          hint="Usually the person who collects the trip fund. Choose “keeps it” if they hold and spend their own money."
        >
          <option value="">{members.find((m) => m.id === memberId)?.name ?? 'They'} keeps it</option>
          {members
            .filter((m) => m.id !== memberId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                Given to {m.name}
                {m.id === trip.fundHolderMemberId ? ' (fund holder)' : ''}
              </option>
            ))}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
    </Modal>
  );
}
