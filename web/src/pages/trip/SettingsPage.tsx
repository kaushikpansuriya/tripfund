import { useState, type FormEvent } from 'react';
import { PlusIcon, TrashIcon } from '../../components/icons.tsx';
import { Badge, Button, Card, ConfirmButton, ErrorBanner, Input, Select, Textarea } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { CURRENCIES, formatDateTime } from '../../lib/format.ts';
import { useRouter } from '../../lib/router.tsx';
import { useAction, useApi } from '../../lib/useApi.ts';
import type { AuditEntry } from '../../types.ts';
import { useTrip } from './TripContext.tsx';

export function SettingsPage() {
  const { trip, me } = useTrip();
  if (!me.isOwner) {
    return (
      <Card title="Settings">
        <p className="text-sm text-slate-600">Only the trip owner can change the trip settings, members and categories.</p>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Currency</dt>
            <dd>{trip.currency}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Members can edit their own records</dt>
            <dd>{trip.memberEditPolicy === 'own' ? 'Yes' : 'No'}</dd>
          </div>
        </dl>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <TripDetailsForm />
      <CategoriesCard />
      <HistoryCard />
      <DangerZone />
    </div>
  );
}

function TripDetailsForm() {
  const { trip, members, summary, refresh } = useTrip();
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    name: trip.name,
    destination: trip.destination ?? '',
    startDate: trip.startDate ?? '',
    endDate: trip.endDate ?? '',
    description: trip.description ?? '',
    currency: trip.currency,
    fundHolderMemberId: trip.fundHolderMemberId ?? '',
    memberEditPolicy: trip.memberEditPolicy,
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setSaved(false);
    setForm({ ...form, [key]: e.target.value });
  };
  const hasRecords = summary.totals.expenseCount + summary.totals.contributionCount + summary.totals.refundCount + summary.totals.settlementCount > 0;
  const fields = error?.fieldErrors() ?? {};

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      await api.patch(`/trips/${trip.id}`, {
        ...form,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        fundHolderMemberId: form.fundHolderMemberId || null,
      });
      await refresh();
      return true;
    });
    if (ok) setSaved(true);
  };

  return (
    <form onSubmit={submit}>
      <Card title="Trip details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Trip name" required value={form.name} onChange={set('name')} error={fields.name} />
          </div>
          <Input label="Destination" value={form.destination} onChange={set('destination')} />
          <Select
            label="Currency"
            value={form.currency}
            onChange={set('currency')}
            hint={hasRecords && form.currency !== trip.currency ? 'Amounts are not converted. Only change this if the trip was created with the wrong currency.' : undefined}
          >
            {Object.values(CURRENCIES).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.symbol} – {c.name}
              </option>
            ))}
          </Select>
          <Input label="Start date" type="date" value={form.startDate} onChange={set('startDate')} />
          <Input label="End date" type="date" value={form.endDate} min={form.startDate || undefined} onChange={set('endDate')} error={fields.endDate} />
          <Select label="Fund holder" value={form.fundHolderMemberId} onChange={set('fundHolderMemberId')} hint="New contributions are given to this person by default.">
            <option value="">Nobody (everyone keeps their own)</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select label="Who can edit and delete records?" value={form.memberEditPolicy} onChange={set('memberEditPolicy')}>
            <option value="own">Owners, and members for records they added</option>
            <option value="none">Only owners</option>
          </Select>
          <div className="sm:col-span-2">
            <Textarea label="Description" value={form.description} onChange={set('description')} />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          {saved && <span className="text-sm text-receive-700">Saved</span>}
          {error && Object.keys(fields).length === 0 && <ErrorBanner error={error} />}
          <Button type="submit" busy={busy}>
            Save changes
          </Button>
        </div>
      </Card>
    </form>
  );
}

function CategoriesCard() {
  const { trip, categories, refresh } = useTrip();
  const { busy, error, setError, run } = useAction();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const custom = categories.filter((c) => c.isCustom);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      await api.post(`/trips/${trip.id}/categories`, { name, icon: icon || null });
      await refresh();
      return true;
    });
    if (ok) {
      setName('');
      setIcon('');
    }
  };

  return (
    <Card title="Categories">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {categories
          .filter((c) => !c.isCustom)
          .map((c) => (
            <Badge key={c.id}>
              {c.icon} {c.name}
            </Badge>
          ))}
      </div>
      {custom.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {custom.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                {c.icon} {c.name}
              </span>
              <ConfirmButton
                ariaLabel={`Delete ${c.name}`}
                title="Delete category?"
                message={`"${c.name}" can only be deleted when no expense uses it.`}
                onConfirm={async () => {
                  await api.delete(`/trips/${trip.id}/categories/${c.id}`);
                  await refresh();
                }}
              >
                <TrashIcon size={16} />
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2">
        <Input aria-label="Icon (emoji)" placeholder="🎉" value={icon} onChange={(e) => setIcon(e.target.value)} className="w-16 text-center" maxLength={4} />
        <Input aria-label="New category name" placeholder="New category, e.g. Scuba diving" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        <Button type="submit" variant="secondary" busy={busy} disabled={!name.trim()}>
          <PlusIcon size={16} /> Add
        </Button>
      </form>
      {error && (
        <div className="mt-3">
          <ErrorBanner error={error} onClose={() => setError(null)} />
        </div>
      )}
    </Card>
  );
}

const ENTITY_LABELS: Record<string, string> = {
  trip: 'trip',
  member: 'member',
  contribution: 'contribution',
  expense: 'expense',
  settlement: 'payment',
};

function HistoryCard() {
  const { trip } = useTrip();
  const [open, setOpen] = useState(false);
  const { data, error, loading } = useApi<{ entries: AuditEntry[] }>(open ? `/trips/${trip.id}/audit` : null);

  const describe = (e: AuditEntry) => {
    const record = (e.after ?? e.before ?? {}) as Record<string, unknown>;
    const label = (record.title ?? record.name ?? '') as string;
    const verb = e.action === 'create' ? 'added' : e.action === 'update' ? 'changed' : 'deleted';
    return `${e.userName ?? 'Someone'} ${verb} ${ENTITY_LABELS[e.entityType] ?? e.entityType}${label ? ` “${label}”` : ''}`;
  };

  return (
    <Card
      title="Change history"
      action={
        !open && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Show
          </Button>
        )
      }
    >
      <p className="text-sm text-slate-600">Every change to money records is logged with who made it and when. The log cannot be edited.</p>
      <ErrorBanner error={error} />
      {open && loading && <p className="mt-3 text-sm text-slate-500">Loading…</p>}
      {data && (
        <ul className="mt-3 max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm">
          {data.entries.map((e) => (
            <li key={e.id} className="flex justify-between gap-3 py-2">
              <span>{describe(e)}</span>
              <span className="shrink-0 text-xs text-slate-500">{formatDateTime(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DangerZone() {
  const { trip } = useTrip();
  const { navigate } = useRouter();
  const [confirmText, setConfirmText] = useState('');
  return (
    <Card title="Delete trip" className="ring-spent-100">
      <p className="text-sm text-slate-600">This permanently deletes the trip with all its members, money records and settlements for everyone.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Type the trip name to confirm" placeholder={`Type “${trip.name}” to confirm`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        {confirmText === trip.name ? (
          <ConfirmButton
            variant="danger"
            size="md"
            title="Delete this trip?"
            message="This cannot be undone."
            confirmLabel="Delete trip"
            onConfirm={async () => {
              await api.delete(`/trips/${trip.id}`);
              navigate('/', { replace: true });
            }}
          >
            <TrashIcon size={16} /> Delete trip
          </ConfirmButton>
        ) : (
          <Button variant="danger" disabled>
            <TrashIcon size={16} /> Delete trip
          </Button>
        )}
      </div>
    </Card>
  );
}
