/**
 * A format-neutral trip report. CSV, Excel and PDF are all rendered from this
 * one model, so the three exports always contain the same numbers.
 */
import { currencyInfo } from '../../../packages/engine/src/index.ts';
import type { TripData, TripSummary } from '../tripData.ts';
import { groupParticipants } from '../tripData.ts';

export type ColumnType = 'text' | 'money' | 'number' | 'date' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Relative width for PDF/Excel. */
  width?: number;
}

export type Cell = string | number | null;

export interface ReportTable {
  id: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, Cell>[];
  totals?: Record<string, Cell>;
}

export interface TripReport {
  title: string;
  subtitle: string;
  currency: string;
  minorUnits: number;
  generatedAt: Date;
  overview: [string, string | number, ColumnType][];
  tables: ReportTable[];
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  credit_card: 'Credit card',
  debit_card: 'Debit card',
  other: 'Other',
};

const SPLIT_LABELS: Record<string, string> = {
  equal: 'Equal',
  exact: 'Custom amounts',
  percentage: 'Percentage',
  shares: 'Shares',
};

export function buildReport(data: TripData, summary: TripSummary): TripReport {
  const { ledger } = summary;
  const { trip } = data;
  const info = currencyInfo(trip.currency);
  const name = new Map(data.members.map((m) => [m.id, m.name]));
  const category = new Map(data.categories.map((c) => [c.id, c.name]));
  const participants = groupParticipants(data.participants);
  const memberName = (id: string | null) => (id ? (name.get(id) ?? '?') : '');

  const dates = [trip.start_date, trip.end_date].filter(Boolean).join(' to ');
  const subtitle = [trip.destination, dates].filter(Boolean).join(' · ');

  const t = ledger.totals;
  const overview: TripReport['overview'] = [
    ['Members', data.members.length, 'number'],
    ['Total money added', t.contributions, 'money'],
    ['Total expenses', t.expensesGross, 'money'],
    ['Refunds', t.refunds, 'money'],
    ['Net spending', t.expenses, 'money'],
    ['Remaining (money added − spending)', t.fundRemaining, 'money'],
    ['Total still owed', t.totalOwed, 'money'],
    ['Payments needed to settle', ledger.settlement.length, 'number'],
  ];

  const tables: ReportTable[] = [];

  tables.push({
    id: 'members',
    title: 'Members',
    columns: [
      { key: 'name', label: 'Name', type: 'text', width: 3 },
      { key: 'role', label: 'Role', type: 'text', width: 1.5 },
      { key: 'status', label: 'Status', type: 'text', width: 1.5 },
      { key: 'fund', label: 'Holds trip fund', type: 'text', width: 1.5 },
    ],
    rows: data.members.map((m) => ({
      name: m.name,
      role: m.role === 'owner' ? 'Owner' : 'Member',
      status: m.status === 'left' ? `Left${m.left_on ? ' ' + m.left_on : ''}` : 'Active',
      fund: m.id === trip.fund_holder_member_id ? 'Yes' : '',
    })),
  });

  tables.push({
    id: 'contributions',
    title: 'Contributions',
    columns: [
      { key: 'date', label: 'Date', type: 'date', width: 1.3 },
      { key: 'member', label: 'From', type: 'text', width: 2 },
      { key: 'receivedBy', label: 'Given to', type: 'text', width: 2 },
      { key: 'method', label: 'Method', type: 'text', width: 1.5 },
      { key: 'amount', label: 'Amount', type: 'money', width: 1.6 },
      { key: 'notes', label: 'Notes', type: 'text', width: 2.5 },
    ],
    rows: data.contributions.map((c) => ({
      date: c.contributed_on,
      member: memberName(c.member_id),
      receivedBy: c.received_by_member_id === c.member_id ? '(kept)' : memberName(c.received_by_member_id),
      method: METHOD_LABELS[c.payment_method] ?? c.payment_method,
      amount: c.amount,
      notes: c.notes,
    })),
    totals: { member: 'Total', amount: t.contributions },
  });

  tables.push({
    id: 'expenses',
    title: 'Expenses',
    columns: [
      { key: 'date', label: 'Date', type: 'date', width: 1.3 },
      { key: 'title', label: 'Expense', type: 'text', width: 2.6 },
      { key: 'category', label: 'Category', type: 'text', width: 1.6 },
      { key: 'paidBy', label: 'Paid by', type: 'text', width: 1.6 },
      { key: 'split', label: 'Split', type: 'text', width: 1.8 },
      { key: 'amount', label: 'Amount', type: 'money', width: 1.6 },
    ],
    rows: data.expenses.map((e) => {
      const count = participants.get(e.id)?.length ?? 0;
      const refund = e.kind === 'refund';
      return {
        date: e.spent_on,
        title: refund ? `Refund: ${e.title}` : e.title,
        category: e.category_id ? (category.get(e.category_id) ?? '') : '',
        paidBy: memberName(e.paid_by_member_id),
        split: `${SPLIT_LABELS[e.split_method]} · ${count} ${count === 1 ? 'person' : 'people'}`,
        amount: refund ? -e.amount : e.amount,
      };
    }),
    totals: { title: 'Net spending', amount: t.expenses },
  });

  const splitRows: Record<string, Cell>[] = [];
  for (const e of data.expenses) {
    for (const s of ledger.expenseShares[e.id] ?? []) {
      splitRows.push({
        date: e.spent_on,
        expense: e.kind === 'refund' ? `Refund: ${e.title}` : e.title,
        member: memberName(s.memberId),
        share: e.kind === 'refund' ? -s.share : s.share,
      });
    }
  }
  tables.push({
    id: 'splits',
    title: 'Expense shares',
    columns: [
      { key: 'date', label: 'Date', type: 'date', width: 1.3 },
      { key: 'expense', label: 'Expense', type: 'text', width: 3 },
      { key: 'member', label: 'Member', type: 'text', width: 2 },
      { key: 'share', label: 'Share', type: 'money', width: 1.6 },
    ],
    rows: splitRows,
  });

  tables.push({
    id: 'categories',
    title: 'Spending by category',
    columns: [
      { key: 'category', label: 'Category', type: 'text', width: 3 },
      { key: 'amount', label: 'Amount', type: 'money', width: 2 },
      { key: 'percent', label: 'Share of total', type: 'percent', width: 1.5 },
    ],
    rows: ledger.byCategory.map((c) => ({
      category: c.key === 'uncategorized' ? 'Uncategorised' : (category.get(c.key) ?? c.key),
      amount: c.amount,
      percent: t.expenses > 0 ? c.amount / t.expenses : null,
    })),
    totals: { category: 'Total', amount: t.expenses },
  });

  tables.push({
    id: 'balances',
    title: 'Member summary',
    columns: [
      { key: 'member', label: 'Member', type: 'text', width: 2 },
      { key: 'contributed', label: 'Added', type: 'money', width: 1.5 },
      { key: 'held', label: 'Holding', type: 'money', width: 1.5 },
      { key: 'paid', label: 'Paid', type: 'money', width: 1.5 },
      { key: 'share', label: 'Own share', type: 'money', width: 1.5 },
      { key: 'transfers', label: 'Payments sent − received', type: 'money', width: 1.7 },
      { key: 'net', label: 'Balance', type: 'money', width: 1.5 },
    ],
    rows: ledger.members.map((m) => ({
      member: m.name,
      contributed: m.contributed,
      held: m.fundHeld,
      paid: m.paid - m.refundsReceived,
      share: m.share,
      transfers: m.transfersSent - m.transfersReceived,
      net: m.net,
    })),
  });

  tables.push({
    id: 'settlement',
    title: 'Final settlement',
    columns: [
      { key: 'from', label: 'Who pays', type: 'text', width: 2 },
      { key: 'to', label: 'Pays to', type: 'text', width: 2 },
      { key: 'amount', label: 'Amount', type: 'money', width: 1.6 },
    ],
    rows: ledger.settlement.map((p) => ({ from: memberName(p.from), to: memberName(p.to), amount: p.amount })),
  });

  tables.push({
    id: 'payments',
    title: 'Recorded payments between members',
    columns: [
      { key: 'date', label: 'Date', type: 'date', width: 1.3 },
      { key: 'from', label: 'From', type: 'text', width: 2 },
      { key: 'to', label: 'To', type: 'text', width: 2 },
      { key: 'method', label: 'Method', type: 'text', width: 1.5 },
      { key: 'amount', label: 'Amount', type: 'money', width: 1.6 },
      { key: 'note', label: 'Note', type: 'text', width: 2.2 },
    ],
    rows: data.settlements.map((s) => ({
      date: s.paid_on,
      from: memberName(s.from_member_id),
      to: memberName(s.to_member_id),
      method: METHOD_LABELS[s.payment_method] ?? s.payment_method,
      amount: s.amount,
      note: s.note,
    })),
  });

  // Chronological history of every money movement.
  const history: { date: string; sortKey: string; type: string; description: string; member: string; amount: number }[] = [];
  for (const c of data.contributions) {
    history.push({
      date: c.contributed_on,
      sortKey: `${c.contributed_on} ${new Date(c.created_at).toISOString()}`,
      type: 'Contribution',
      description: c.received_by_member_id === c.member_id ? 'Added to trip fund (kept)' : `Given to ${memberName(c.received_by_member_id)}`,
      member: memberName(c.member_id),
      amount: c.amount,
    });
  }
  for (const e of data.expenses) {
    history.push({
      date: e.spent_on,
      sortKey: `${e.spent_on} ${new Date(e.created_at).toISOString()}`,
      type: e.kind === 'refund' ? 'Refund' : 'Expense',
      description: e.title,
      member: memberName(e.paid_by_member_id),
      amount: e.kind === 'refund' ? e.amount : -e.amount,
    });
  }
  for (const s of data.settlements) {
    history.push({
      date: s.paid_on,
      sortKey: `${s.paid_on} ${new Date(s.created_at).toISOString()}`,
      type: 'Payment',
      description: `${memberName(s.from_member_id)} → ${memberName(s.to_member_id)}`,
      member: memberName(s.from_member_id),
      amount: s.amount,
    });
  }
  history.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  tables.push({
    id: 'history',
    title: 'Transaction history',
    columns: [
      { key: 'date', label: 'Date', type: 'date', width: 1.3 },
      { key: 'type', label: 'Type', type: 'text', width: 1.4 },
      { key: 'description', label: 'Description', type: 'text', width: 3 },
      { key: 'member', label: 'Member', type: 'text', width: 1.8 },
      { key: 'amount', label: 'Amount', type: 'money', width: 1.6 },
    ],
    rows: history.map(({ sortKey: _s, ...row }) => row),
  });

  return {
    title: trip.name,
    subtitle,
    currency: trip.currency,
    minorUnits: info.minorUnits,
    generatedAt: new Date(),
    overview,
    tables,
  };
}

export function fileSlug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 60) || 'trip'
  );
}
