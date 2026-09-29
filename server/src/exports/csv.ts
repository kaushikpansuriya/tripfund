import { toDecimalString } from '../../../packages/engine/src/index.ts';
import type { Cell, ColumnType, ReportTable, TripReport } from './report.ts';

/** Escape a CSV cell. Text starting with = + - @ is prefixed so spreadsheets never run it as a formula. */
function cell(value: Cell, type: ColumnType, minorUnits: number): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (type === 'money' && typeof value === 'number') text = toDecimalString(value, minorUnits);
  else if (type === 'percent' && typeof value === 'number') text = (value * 100).toFixed(1);
  else text = String(value);
  if (type === 'text' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function tableLines(table: ReportTable, report: TripReport): string[] {
  const header = table.columns.map((c) => cell(c.type === 'money' ? `${c.label} (${report.currency})` : c.label, 'text', 0));
  const lines = [header.join(',')];
  for (const row of table.rows) {
    lines.push(table.columns.map((c) => cell(row[c.key] ?? null, c.type, report.minorUnits)).join(','));
  }
  if (table.totals) {
    lines.push(table.columns.map((c) => cell(table.totals![c.key] ?? null, c.type, report.minorUnits)).join(','));
  }
  return lines;
}

/** One table, or every table as titled sections separated by a blank line. */
export function renderCsv(report: TripReport, tableId: string): string {
  const BOM = '﻿'; // lets Excel read ₹, €, names with accents etc.
  if (tableId !== 'all') {
    const table = report.tables.find((t) => t.id === tableId);
    if (!table) throw new Error(`Unknown table ${tableId}`);
    return BOM + tableLines(table, report).join('\r\n') + '\r\n';
  }
  const parts: string[] = [
    cell(report.title, 'text', 0),
    cell(report.subtitle, 'text', 0),
    '',
    ...report.overview.map(([label, value, type]) => `${cell(label, 'text', 0)},${cell(value, type, report.minorUnits)}`),
  ];
  for (const table of report.tables) {
    parts.push('', cell(table.title, 'text', 0), ...tableLines(table, report));
  }
  return BOM + parts.join('\r\n') + '\r\n';
}
