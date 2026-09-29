import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth.tsx';
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '../components/icons.tsx';
import { Avatar, Button, Card, ErrorBanner, Input, Select, Textarea } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { CURRENCIES } from '../lib/format.ts';
import { Link, useRouter } from '../lib/router.tsx';
import { useAction } from '../lib/useApi.ts';
import type { Trip } from '../types.ts';

interface MemberDraft {
  key: number;
  name: string;
  email: string;
}

export function CreateTripPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({ name: '', destination: '', startDate: '', endDate: '', currency: 'INR', description: '' });
  const [members, setMembers] = useState<MemberDraft[]>([{ key: 1, name: '', email: '' }]);
  const [nextKey, setNextKey] = useState(2);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = await run(() =>
      api.post<{ trip: Trip }>('/trips', {
        ...form,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        members: members.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), email: m.email.trim() || null })),
      }),
    );
    if (result) navigate(`/trips/${result.trip.id}`, { replace: true });
  };

  const fields = error?.fieldErrors() ?? {};

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-6">
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeftIcon size={16} /> My trips
      </Link>
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Create a trip</h1>

      <form onSubmit={submit} className="space-y-5">
        <Card title="Trip details">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input label="Trip name" placeholder="Goa Trip 2026" required value={form.name} onChange={set('name')} error={fields.name} autoFocus />
            </div>
            <Input label="Destination" placeholder="Goa, India" value={form.destination} onChange={set('destination')} />
            <Select label="Currency" value={form.currency} onChange={set('currency')} hint="All amounts in this trip use this currency.">
              {Object.values(CURRENCIES).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} {c.symbol} – {c.name}
                </option>
              ))}
            </Select>
            <Input label="Start date" type="date" value={form.startDate} onChange={set('startDate')} />
            <Input label="End date" type="date" value={form.endDate} min={form.startDate || undefined} onChange={set('endDate')} error={fields.endDate} />
            <div className="sm:col-span-2">
              <Textarea label="Description (optional)" value={form.description} onChange={set('description')} placeholder="Beach week with the college gang" />
            </div>
          </div>
        </Card>

        <Card title="Who is travelling?">
          <p className="mb-3 text-sm text-slate-600">
            Add everyone who shares costs. An email is optional; add it so they can log in and see the trip too.
          </p>
          <div className="mb-3 flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
            <Avatar name={user?.name ?? '?'} size="sm" />
            <span className="text-sm font-medium">{user?.name} (you)</span>
            <span className="ml-auto text-xs text-slate-500">Owner · holds the trip fund</span>
          </div>
          <div className="space-y-3">
            {members.map((m, i) => (
              <div key={m.key} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  aria-label={`Member ${i + 1} name`}
                  placeholder="Name"
                  value={m.name}
                  onChange={(e) => setMembers(members.map((x) => (x.key === m.key ? { ...x, name: e.target.value } : x)))}
                />
                <Input
                  aria-label={`Member ${i + 1} email`}
                  type="email"
                  placeholder="Email (optional)"
                  className="order-3 col-span-2 sm:order-none sm:col-span-1"
                  value={m.email}
                  onChange={(e) => setMembers(members.map((x) => (x.key === m.key ? { ...x, email: e.target.value } : x)))}
                />
                <Button variant="ghost" aria-label="Remove member" onClick={() => setMembers(members.filter((x) => x.key !== m.key))} disabled={members.length === 1 && !m.name}>
                  <TrashIcon size={18} />
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => {
              setMembers([...members, { key: nextKey, name: '', email: '' }]);
              setNextKey(nextKey + 1);
            }}
          >
            <PlusIcon size={16} /> Add member
          </Button>
        </Card>

        {error && Object.keys(fields).length === 0 && <ErrorBanner error={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate('/')}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Create trip
          </Button>
        </div>
      </form>
    </main>
  );
}
