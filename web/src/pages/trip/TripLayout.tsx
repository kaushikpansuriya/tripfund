import { useCallback, useMemo } from 'react';
import { ArrowLeftIcon, PlusIcon } from '../../components/icons.tsx';
import { cx, ErrorBanner, PageSpinner } from '../../components/ui.tsx';
import { formatDateRange } from '../../lib/format.ts';
import { Link, useRouter } from '../../lib/router.tsx';
import { useApi } from '../../lib/useApi.ts';
import type { Summary, TripDetail } from '../../types.ts';
import { ExpenseFormPage } from './ExpenseFormPage.tsx';
import { ExpensesPage } from './ExpensesPage.tsx';
import { MembersPage } from './MembersPage.tsx';
import { OverviewPage } from './OverviewPage.tsx';
import { ReportsPage } from './ReportsPage.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { SettlementsPage } from './SettlementsPage.tsx';
import { TripContext, type TripContextValue } from './TripContext.tsx';
import { WalletPage } from './WalletPage.tsx';

const TABS = [
  { slug: '', label: 'Overview' },
  { slug: 'expenses', label: 'Expenses' },
  { slug: 'wallet', label: 'Wallet' },
  { slug: 'members', label: 'Members' },
  { slug: 'settlements', label: 'Settle up' },
  { slug: 'reports', label: 'Reports' },
  { slug: 'settings', label: 'Settings' },
];

export function TripLayout({ tripId }: { tripId: string }) {
  const { path } = useRouter();
  const base = `/trips/${tripId}`;
  const detail = useApi<TripDetail>(`/trips/${tripId}`);
  const summary = useApi<Summary>(`/trips/${tripId}/summary`);

  const refresh = useCallback(async () => {
    await Promise.all([detail.reload(), summary.reload()]);
  }, [detail.reload, summary.reload]);

  const value = useMemo<TripContextValue | null>(() => {
    if (!detail.data || !summary.data) return null;
    const members = new Map(detail.data.members.map((m) => [m.id, m]));
    const categories = new Map(detail.data.categories.map((c) => [c.id, c]));
    return {
      ...detail.data,
      summary: summary.data,
      refresh,
      base,
      member: (id) => (id ? members.get(id) : undefined),
      memberName: (id) => (id ? (members.get(id)?.name ?? 'Unknown') : ''),
      category: (id) => (id ? categories.get(id) : undefined),
    };
  }, [detail.data, summary.data, refresh, base]);

  const error = detail.error ?? summary.error;
  if (error && !value) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <ErrorBanner error={error.status === 404 ? 'This trip does not exist or you are not a member of it.' : error} />
        <Link to="/" className="mt-4 inline-block text-sm text-remain-700 underline">
          Back to my trips
        </Link>
      </main>
    );
  }
  if (!value) return <PageSpinner />;

  const segments = path.slice(base.length).split('/').filter(Boolean);
  const section = segments[0] ?? '';
  let page;
  switch (section) {
    case '':
      page = <OverviewPage />;
      break;
    case 'expenses':
      if (segments[1] === 'new') page = <ExpenseFormPage />;
      else if (segments[1] && segments[2] === 'edit') page = <ExpenseFormPage expenseId={segments[1]} />;
      else page = <ExpensesPage />;
      break;
    case 'wallet':
      page = <WalletPage />;
      break;
    case 'members':
      page = <MembersPage />;
      break;
    case 'settlements':
      page = <SettlementsPage />;
      break;
    case 'reports':
      page = <ReportsPage />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
    default:
      page = <ErrorBanner error="Page not found." />;
  }
  const inForm = section === 'expenses' && segments.length > 1;
  const { trip } = value;

  return (
    <TripContext.Provider value={value}>
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 pt-4">
          <Link to="/" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
            <ArrowLeftIcon size={14} /> My trips
          </Link>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{trip.name}</h1>
            <p className="text-sm text-slate-500">{[trip.destination, formatDateRange(trip.startDate, trip.endDate)].filter(Boolean).join(' · ')}</p>
          </div>
          <nav className="scrollbar-none -mx-4 mt-3 flex overflow-x-auto px-4" aria-label="Trip sections">
            {TABS.map((tab) => {
              const active = section === tab.slug;
              return (
                <Link
                  key={tab.slug}
                  to={tab.slug ? `${base}/${tab.slug}` : base}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition',
                    active ? 'border-remain-700 text-remain-700' : 'border-transparent text-slate-600 hover:text-slate-900',
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-5">{page}</main>

      {!inForm && (
        <Link
          to={`${base}/expenses/new`}
          className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-20 inline-flex items-center gap-2 rounded-full bg-remain-700 px-5 py-3.5 font-semibold text-white shadow-lg shadow-remain-700/30 hover:bg-remain-600"
        >
          <PlusIcon size={20} /> Expense
        </Link>
      )}
    </TripContext.Provider>
  );
}
