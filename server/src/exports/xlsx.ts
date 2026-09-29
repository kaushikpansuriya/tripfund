import ExcelJS from 'exceljs';
import type { Cell, ColumnType, TripReport } from './report.ts';

const FORMATS: Partial<Record<ColumnType, string>> = {
  money: '#,##0.00;[Red]-#,##0.00',
  percent: '0.0%',
  date: 'yyyy-mm-dd',
  number: '0',
};

function excelValue(value: Cell, type: ColumnType, minorUnits: number): ExcelJS.CellValue {
  if (value === null || value === undefined) return null;
  if (type === 'money' && typeof value === 'number') return value / 10 ** minorUnits;
  if (type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`);
  return value;
}

/** Excel sheet names: max 31 characters, no []:*?/\ */
const sheetName = (title: string) => title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);

export async function renderXlsx(report: TripReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TripFund';
  wb.created = report.generatedAt;

  // Summary sheet
  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { key: 'label', width: 38 },
    { key: 'value', width: 22 },
  ];
  summary.addRow([report.title]).font = { bold: true, size: 16 };
  if (report.subtitle) summary.addRow([report.subtitle]);
  summary.addRow([`Currency: ${report.currency}`]);
  summary.addRow([`Generated: ${report.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`]);
  summary.addRow([]);
  for (const [label, value, type] of report.overview) {
    const row = summary.addRow([label, excelValue(value, type, report.minorUnits)]);
    const format = FORMATS[type];
    if (format) row.getCell(2).numFmt = format;
  }

  // One sheet per table
  for (const table of report.tables) {
    const ws = wb.addWorksheet(sheetName(table.title), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = table.columns.map((c) => ({
      header: c.type === 'money' ? `${c.label} (${report.currency})` : c.label,
      key: c.key,
      width: Math.round((c.width ?? 1.5) * 9),
    }));
    for (const row of table.rows) {
      ws.addRow(Object.fromEntries(table.columns.map((c) => [c.key, excelValue(row[c.key] ?? null, c.type, report.minorUnits)])));
    }
    if (table.totals) {
      const totalRow = ws.addRow(
        Object.fromEntries(table.columns.map((c) => [c.key, excelValue(table.totals![c.key] ?? null, c.type, report.minorUnits)])),
      );
      totalRow.font = { bold: true };
    }
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    table.columns.forEach((c, index) => {
      const format = FORMATS[c.type];
      if (format) ws.getColumn(index + 1).numFmt = format;
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
