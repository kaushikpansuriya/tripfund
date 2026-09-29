import PDFDocument from 'pdfkit';
import { currencyInfo } from '../../../packages/engine/src/index.ts';
import type { Cell, ColumnType, ReportTable, TripReport } from './report.ts';

// The built-in PDF fonts cannot draw symbols like ₹ or د.إ, so the PDF shows
// the ISO code instead ("INR 1,234.50"), which is also unambiguous on paper.
function formatCell(value: Cell, type: ColumnType, report: TripReport): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'money' && typeof value === 'number') {
    const info = currencyInfo(report.currency);
    const text = new Intl.NumberFormat(info.locale, {
      minimumFractionDigits: info.minorUnits,
      maximumFractionDigits: info.minorUnits,
    }).format(value / 10 ** info.minorUnits);
    return text.replace(/−/g, '-');
  }
  if (type === 'percent' && typeof value === 'number') return `${(value * 100).toFixed(1)}%`;
  return String(value);
}

/** Keep only characters the standard PDF fonts can draw (Latin-1). */
function printable(text: string): string {
  return text.replace(/→/g, '->').replace(/[−–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

const COLORS = {
  text: '#1f2937',
  muted: '#6b7280',
  headerBg: '#eef2f7',
  line: '#e5e7eb',
  accent: '#0f766e',
  negative: '#b91c1c',
};

export function renderPdf(report: TripReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: printable(report.title), Creator: 'TripFund' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    let y = doc.page.margins.top;

    const ensureSpace = (height: number) => {
      if (y + height > bottom()) {
        doc.addPage();
        y = doc.page.margins.top;
        return true;
      }
      return false;
    };

    // Title
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(20).text(printable(report.title), left, y, { width });
    y = doc.y + 2;
    if (report.subtitle) {
      doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted).text(printable(report.subtitle), left, y, { width });
      y = doc.y;
    }
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(`Amounts in ${report.currency}. Generated ${report.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`, left, y + 4, { width });
    y = doc.y + 14;

    // Overview grid (2 columns)
    doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text).text('Trip summary', left, y);
    y = doc.y + 6;
    const colW = width / 2;
    report.overview.forEach(([label, value, type], i) => {
      const x = left + (i % 2) * colW;
      if (i % 2 === 0 && i > 0) y += 34;
      ensureSpace(34);
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(printable(label), x, y, { width: colW - 10 });
      doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text).text(printable(formatCell(value, type, report)), x, y + 12, { width: colW - 10 });
    });
    y += 48;

    for (const table of report.tables) drawTable(table);

    doc.end();

    function drawTable(table: ReportTable) {
      const totalWeight = table.columns.reduce((s, c) => s + (c.width ?? 1.5), 0);
      const widths = table.columns.map((c) => ((c.width ?? 1.5) / totalWeight) * width);
      const pad = 4;
      const fontSize = 8.5;

      const rowHeight = (cells: string[], bold: boolean) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
        return Math.max(...cells.map((text, i) => doc.heightOfString(text || ' ', { width: widths[i] - pad * 2 }))) + pad * 2;
      };

      const drawRow = (cells: string[], opts: { bold?: boolean; fill?: string; types?: ColumnType[]; negatives?: boolean[]; isHeader?: boolean }) => {
        const h = rowHeight(cells, !!opts.bold);
        if (ensureSpace(h) && !opts.isHeader) drawHeader();
        if (opts.fill) doc.rect(left, y, width, h).fill(opts.fill);
        let x = left;
        cells.forEach((text, i) => {
          const numeric = opts.types?.[i] === 'money' || opts.types?.[i] === 'percent' || opts.types?.[i] === 'number';
          doc
            .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(fontSize)
            .fillColor(opts.negatives?.[i] ? COLORS.negative : COLORS.text)
            .text(text, x + pad, y + pad, { width: widths[i] - pad * 2, align: numeric ? 'right' : 'left' });
          x += widths[i];
        });
        y += h;
        doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(COLORS.line).stroke();
      };

      const header = table.columns.map((c) => printable(c.label));
      const types = table.columns.map((c) => c.type);
      const drawHeader = () =>
        drawRow(header, { bold: true, isHeader: true, fill: COLORS.headerBg, types: types.map((t) => (t === 'money' ? 'money' : 'text')) });

      ensureSpace(60);
      y += 10;
      doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text).text(printable(table.title), left, y);
      y = doc.y + 6;

      if (table.rows.length === 0) {
        doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text('Nothing recorded.', left, y);
        y = doc.y + 8;
        return;
      }

      drawHeader();
      for (const row of table.rows) {
        const cells = table.columns.map((c) => printable(formatCell(row[c.key] ?? null, c.type, report)));
        const negatives = table.columns.map((c) => c.type === 'money' && typeof row[c.key] === 'number' && (row[c.key] as number) < 0);
        drawRow(cells, { types, negatives });
      }
      if (table.totals) {
        const cells = table.columns.map((c) => printable(formatCell(table.totals![c.key] ?? null, c.type, report)));
        drawRow(cells, { bold: true, types });
      }
      y += 8;
    }
  });
}
