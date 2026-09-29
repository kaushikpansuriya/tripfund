import { useState } from 'react';
import { ArrowRightIcon, CheckIcon, EditIcon, PlusIcon, TrashIcon } from '../../components/icons.tsx';
import { Avatar, Button, Card, ConfirmButton, EmptyState, ErrorBanner, Input, Modal, MoneyInput, Select, Textarea } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { CURRENCIES, formatDate, minorUnits, money, parseMoney, PAYMENT_METHODS, paymentMethodLabel, plural, todayIso, toDecimalString } from '../../lib/format.ts';
import { useAction, useApi } from '../../lib/useApi.ts';
import type { Settlement } from '../../types.ts';
import { useTrip } from './TripContext.tsx';

interface Draft {
  id?: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number | null;
  date?: string;
  paymentMethod?: string;
  note?: string | null;
}

export function SettlementsPage() {
  const { trip, summary, me, memberName, refresh } = useTrip();
  const recorded = useApi<{ settlements: Settlement[] }>(`/trips/${trip.id}/settlements`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const c = trip.currency;

  const reloadAll = async () => {
    await Promise.all([recorded.reload(), refresh()]);
  };

  return (
    <div className="space-y-5">
      <Card title="Suggested payments">
        {summary.settlement.length === 0 ? (
          <EmptyState title="Everyone is settled up" text="When someone owes money, the fewest payments needed to settle the trip will show here." />
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-600">
              {plural(summary.settlement.length, 'payment')} will settle the whole trip. This is the smallest number of payments possible.
            </p>
            <ul className="space-y-2">
              {summary.settlement.map((p) => (
                <li key={`${p.fromMemberId}-${p.toMemberId}`} className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
                  <div className="flex min-w-0 basis-full items-center gap-2 sm:flex-1 sm:basis-auto">
                    <Avatar name={p.fromName} size="sm" />
                    <span className="truncate text-sm font-medium">{p.fromMemberId === me.memberId ? 'You' : p.fromName}</span>
                    <ArrowRightIcon size={16} className="shrink-0 text-slate-400" />
                    <Avatar name={p.toName} size="sm" />
                    <span className="truncate text-sm font-medium">{p.toMemberId === me.memberId ? 'You' : p.toName}</span>
                  </div>
                  <span className="mr-auto font-bold tabular-nums text-owe-700 sm:mr-0">{money(p.amount, c)}</span>
                  {(me.isOwner || p.fromMemberId === me.memberId || p.toMemberId === me.memberId) && (
                    <Button size="sm" variant="secondary" onClick={() => setDraft({ fromMemberId: p.fromMemberId, toMemberId: p.toMemberId, amount: p.amount })}>
                      <CheckIcon size={16} /> Mark paid
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card
        title="Recorded payments"
        action={
          <Button size="sm" variant="secondary" onClick={() => setDraft({ fromMemberId: me.memberId, toMemberId: '', amount: null })}>
            <PlusIcon size={16} /> Record payment
          </Button>
        }
      >
        <ErrorBanner error={recorded.error} />
        {recorded.data && recorded.data.settlements.length === 0 && (
          <p className="text-sm text-slate-500">Payments between members (for example “David paid John ₹2,000”) appear here and reduce what is owed.</p>
        )}
        <ul className="divide-y divide-slate-100">
          {recorded.data?.settlements.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {memberName(s.fromMemberId)} paid {memberName(s.toMemberId)}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {formatDate(s.date)} · {paymentMethodLabel(s.paymentMethod)}
                  {s.note && ` · ${s.note}`}
                </p>
              </div>
              <span className="font-semibold tabular-nums text-receive-700">{money(s.amount, c)}</span>
              {s.canEdit && (
                <span className="flex">
                  <Button variant="ghost" size="sm" aria-label="Edit payment" onClick={() => setDraft({ ...s })}>
                    <EditIcon size={16} />
                  </Button>
                  <ConfirmButton
                    ariaLabel="Delete payment"
                    title="Delete payment?"
                    message={`The payment of ${money(s.amount, c)} from ${memberName(s.fromMemberId)} to ${memberName(s.toMemberId)} will be removed and balances recalculated.`}
                    onConfirm={async () => {
                      await api.delete(`/trips/${trip.id}/settlements/${s.id}`);
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

      {draft && <PaymentModal draft={draft} onClose={() => setDraft(null)} onSaved={reloadAll} />}
    </div>
  );
}

function PaymentModal({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => Promise<void> }) {
  const { trip, members } = useTrip();
  const units = minorUnits(trip.currency);
  const { busy, error, run } = useAction();
  const [from, setFrom] = useState(draft.fromMemberId);
  const [to, setTo] = useState(draft.toMemberId);
  const [amountText, setAmountText] = useState(draft.amount ? toDecimalString(draft.amount, units) : '');
  const [date, setDate] = useState(draft.date ?? todayIso());
  const [method, setMethod] = useState(draft.paymentMethod ?? 'upi');
  const [note, setNote] = useState(draft.note ?? '');
  const amount = parseMoney(amountText, units);
  const valid = amount && from && to && from !== to;

  const save = async () => {
    if (!valid) return;
    const body = { fromMemberId: from, toMemberId: to, amount, date, paymentMethod: method, note: note || null };
    const ok = await run(async () => {
      if (draft.id) await api.patch(`/trips/${trip.id}/settlements/${draft.id}`, body);
      else await api.post(`/trips/${trip.id}/settlements`, body);
      await onSaved();
      return true;
    });
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.id ? 'Edit payment' : 'Record a payment'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={busy} disabled={!valid} onClick={save}>
            Save payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner error={error} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Who paid?" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Select…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select label="Paid to" value={to} onChange={(e) => setTo(e.target.value)} error={from && to && from === to ? 'Choose someone else' : undefined}>
            <option value="">Select…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <MoneyInput
          label="Amount"
          value={amountText}
          onChange={setAmountText}
          symbol={CURRENCIES[trip.currency]?.symbol ?? trip.currency}
          hint="You can record a partial payment; the rest stays owed."
        />
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
        <Textarea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
