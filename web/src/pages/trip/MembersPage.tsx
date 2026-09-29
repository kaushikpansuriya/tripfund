import { useState } from 'react';
import { EditIcon, PlusIcon, TrashIcon } from '../../components/icons.tsx';
import { balanceSentence } from '../../components/money.tsx';
import { Avatar, Badge, Button, ConfirmButton, cx, ErrorBanner, Input, Modal, Select } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { useAction } from '../../lib/useApi.ts';
import type { Member } from '../../types.ts';
import { useTrip } from './TripContext.tsx';

export function MembersPage() {
  const { trip, members, summary, me, refresh } = useTrip();
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const c = trip.currency;
  const balances = new Map(summary.members.map((b) => [b.memberId, b]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Members</h2>
        {me.isOwner && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <PlusIcon size={16} /> Add member
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {members.map((m) => {
          const b = balances.get(m.id);
          if (!b) return null;
          const lines: [string, number, string][] = [
            ['Money added', b.contributed, 'text-added-700'],
            ...(b.fundHeld > 0 ? ([['Holding for the group', -b.fundHeld, 'text-slate-700']] as [string, number, string][]) : []),
            ['Paid for expenses', b.paid, 'text-slate-700'],
            ...(b.refundsReceived > 0 ? ([['Refunds received', -b.refundsReceived, 'text-slate-700']] as [string, number, string][]) : []),
            ['Own share of spending', -b.share, 'text-spent-700'],
            ...(b.transfersSent + b.transfersReceived > 0
              ? ([
                  ['Payments sent', b.transfersSent, 'text-slate-700'],
                  ['Payments received', -b.transfersReceived, 'text-slate-700'],
                ] as [string, number, string][])
              : []),
          ];
          return (
            <article key={m.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <header className="flex items-center gap-3">
                <Avatar name={m.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {m.name} {m.id === me.memberId && <span className="font-normal text-slate-400">(you)</span>}
                  </p>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {m.role === 'owner' && <Badge tone="remain">Owner</Badge>}
                    {m.id === trip.fundHolderMemberId && <Badge tone="added">Fund holder</Badge>}
                    {m.status === 'left' && <Badge>Left</Badge>}
                    {!m.hasAccount && <Badge>{m.email ? 'Invited' : 'No account'}</Badge>}
                  </div>
                </div>
                {me.isOwner && (
                  <Button variant="ghost" size="sm" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}>
                    <EditIcon size={16} />
                  </Button>
                )}
              </header>
              <dl className="mt-3 space-y-1.5 text-sm">
                {lines.map(([label, value, color]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className={cx('tabular-nums', color)}>
                      {value < 0 ? '−' : '+'}
                      {money(Math.abs(value), c)}
                    </dd>
                  </div>
                ))}
              </dl>
              <div
                className={cx(
                  'mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold',
                  b.net > 0 ? 'bg-receive-50 text-receive-700' : b.net < 0 ? 'bg-owe-50 text-owe-700' : 'bg-slate-100 text-slate-600',
                )}
              >
                <span>{balanceSentence(b, c, m.id === me.memberId)}</span>
              </div>
            </article>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">
        Balance = money added − money held for others + paid for expenses − own share ± payments between members.
      </p>

      {editing && <MemberModal member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function MemberModal({ member, onClose, onSaved }: { member: Member | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { trip, me } = useTrip();
  const { busy, error, run } = useAction();
  const [name, setName] = useState(member?.name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [role, setRole] = useState(member?.role ?? 'member');
  const [status, setStatus] = useState(member?.status ?? 'active');
  const fields = error?.fieldErrors() ?? {};

  const save = async () => {
    const ok = await run(async () => {
      if (member) await api.patch(`/trips/${trip.id}/members/${member.id}`, { name, email: email || null, role, status });
      else await api.post(`/trips/${trip.id}/members`, { name, email: email || null });
      await onSaved();
      return true;
    });
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={member ? `Edit ${member.name}` : 'Add member'}
      footer={
        <>
          {member && member.id !== me.memberId && (
            <ConfirmButton
              className="mr-auto"
              title={`Remove ${member.name}?`}
              message="Members who are part of expenses or payments cannot be removed. Mark them as “Left the trip” instead."
              confirmLabel="Remove"
              onConfirm={async () => {
                await api.delete(`/trips/${trip.id}/members/${member.id}`);
                await onSaved();
                onClose();
              }}
            >
              <TrashIcon size={16} /> Remove
            </ConfirmButton>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={busy} disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && Object.keys(fields).length === 0 && <ErrorBanner error={error} />}
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} autoFocus />
        <Input
          label="Email (optional)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fields.email}
          hint="With an email they can sign up and see this trip."
        />
        {member && (
          <div className="grid grid-cols-2 gap-3">
            <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'member')}>
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </Select>
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'left')}>
              <option value="active">On the trip</option>
              <option value="left">Left the trip</option>
            </Select>
          </div>
        )}
        {member && status === 'left' && (
          <p className="text-xs text-slate-500">
            Members who left keep their balance until it is settled. They are no longer selected by default for new expenses.
          </p>
        )}
      </div>
    </Modal>
  );
}
