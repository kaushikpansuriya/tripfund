import { DownloadIcon } from '../../components/icons.tsx';
import { BarList } from '../../components/money.tsx';
import { Card } from '../../components/ui.tsx';
import { money } from '../../lib/format.ts';
import { useTrip } from './TripContext.tsx';

const EXPORTS = [
  { href: 'export.pdf', label: 'PDF report', text: 'Summary, members, contributions, expenses, categories, balances, final settlement and full history.' },
  { href: 'export.xlsx', label: 'Excel workbook', text: 'One sheet per table, with real numbers you can sort and sum.' },
  { href: 'export.csv?table=all', label: 'CSV (all tables)', text: 'Every table in one CSV file, separated by titles.' },
  { href: 'export.csv?table=expenses', label: 'CSV (expenses only)', text: 'Just the expense list, ready for any spreadsheet.' },
];

export function ReportsPage() {
  const { trip, summary } = useTrip();
  const c = trip.currency;
  const t = summary.totals;

  return (
    <div className="space-y-5">
      <Card title="Download">
        <div className="grid gap-3 sm:grid-cols-2">
          {EXPORTS.map((e) => (
            <a
              key={e.href}
              href={`/api/trips/${trip.id}/${e.href}`}
              download
              className="flex items-start gap-3 rounded-xl p-3 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:ring-remain-500"
            >
              <span className="rounded-lg bg-remain-50 p-2 text-remain-700">
                <DownloadIcon size={18} />
              </span>
              <span>
                <span className="block text-sm font-semibold">{e.label}</span>
                <span className="block text-xs text-slate-500">{e.text}</span>
              </span>
            </a>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Spending by category">
          {summary.byCategory.length ? (
            <BarList currency={c} items={summary.byCategory.map((x) => ({ key: x.categoryId ?? 'none', label: `${x.icon ?? ''} ${x.name}`.trim(), amount: x.amount }))} />
          ) : (
            <p className="text-sm text-slate-500">No expenses yet.</p>
          )}
        </Card>
        <Card title="Contribution vs spending">
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 font-medium sm:px-1">Member</th>
                  <th className="px-1 py-2 text-right font-medium">Added</th>
                  <th className="px-1 py-2 text-right font-medium">Paid</th>
                  <th className="px-1 py-2 text-right font-medium">Share</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-1">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {summary.members.map((m) => (
                  <tr key={m.memberId}>
                    <td className="px-4 py-2 font-medium sm:px-1">{m.name}</td>
                    <td className="px-1 py-2 text-right text-added-700">{money(m.contributed, c)}</td>
                    <td className="px-1 py-2 text-right">{money(m.paid - m.refundsReceived, c)}</td>
                    <td className="px-1 py-2 text-right text-spent-700">{money(m.share, c)}</td>
                    <td className={`px-4 py-2 text-right font-semibold sm:px-1 ${m.net > 0 ? 'text-receive-700' : m.net < 0 ? 'text-owe-700' : 'text-slate-500'}`}>
                      {m.net > 0 ? '+' : ''}
                      {money(m.net, c)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-semibold tabular-nums">
                  <td className="px-4 py-2 sm:px-1">Total</td>
                  <td className="px-1 py-2 text-right">{money(t.contributions, c)}</td>
                  <td className="px-1 py-2 text-right">{money(t.expenses, c)}</td>
                  <td className="px-1 py-2 text-right">{money(t.expenses, c)}</td>
                  <td className="px-4 py-2 text-right sm:px-1">{money(0, c)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
