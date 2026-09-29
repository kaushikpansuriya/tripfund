import { PlusIcon } from '../components/icons.tsx';
import { Badge, Button, EmptyState, ErrorBanner, PageSpinner } from '../components/ui.tsx';
import { formatDateRange, money } from '../lib/format.ts';
import { Link, useRouter } from '../lib/router.tsx';
import { useApi } from '../lib/useApi.ts';
import type { TripListItem } from '../types.ts';

export function TripsPage() {
  const { navigate } = useRouter();
  const { data, error, loading } = useApi<{ trips: TripListItem[] }>('/trips');

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">My trips</h1>
        <Button onClick={() => navigate('/trips/new')}>
          <PlusIcon size={18} /> New trip
        </Button>
      </div>

      <ErrorBanner error={error} />
      {loading && !data && <PageSpinner />}

      {data && data.trips.length === 0 && (
        <EmptyState
          title="No trips yet"
          text="Create a trip, add the people travelling with you, and start adding money and expenses."
          action={
            <Button onClick={() => navigate('/trips/new')}>
              <PlusIcon size={18} /> Create your first trip
            </Button>
          }
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.trips.map((t) => (
          <Link
            key={t.id}
            to={`/trips/${t.id}`}
            className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-remain-500"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold text-slate-900 group-hover:text-remain-700">{t.name}</h2>
              {t.myRole === 'owner' && <Badge tone="remain">Owner</Badge>}
            </div>
            <p className="mt-1 text-sm text-slate-500">{[t.destination, formatDateRange(t.startDate, t.endDate)].filter(Boolean).join(' · ') || 'No dates set'}</p>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Members</dt>
                <dd className="font-semibold">{t.memberCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Added</dt>
                <dd className="font-semibold text-added-700">{money(t.totalContributions, t.currency)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Spent</dt>
                <dd className="font-semibold text-spent-700">{money(t.totalExpenses, t.currency)}</dd>
              </div>
            </dl>
          </Link>
        ))}
      </div>
    </main>
  );
}
