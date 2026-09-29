import { Router } from 'express';
import { z } from 'zod';
import { access } from '../access.ts';
import { renderCsv } from '../exports/csv.ts';
import { renderPdf } from '../exports/pdf.ts';
import { buildReport, fileSlug } from '../exports/report.ts';
import { renderXlsx } from '../exports/xlsx.ts';
import { computeSummary, fullTripJson } from '../tripData.ts';
import { loadTripData } from '../tripQueries.ts';

export const reportsRouter = Router({ mergeParams: true });

const csvQuery = z.object({
  table: z.enum(['all', 'members', 'contributions', 'expenses', 'splits', 'categories', 'balances', 'settlement', 'payments', 'history']).default('all'),
});

async function reportFor(req: Parameters<typeof access>[0]) {
  const a = access(req);
  const data = await loadTripData(a.trip);
  return { data, report: buildReport(data, computeSummary(data)) };
}

function attachment(res: import('express').Response, filename: string, type: string) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
}

reportsRouter.get('/export.csv', async (req, res) => {
  const { table } = csvQuery.parse(req.query);
  const { report } = await reportFor(req);
  attachment(res, `${fileSlug(report.title)}-${table}.csv`, 'text/csv; charset=utf-8');
  res.send(renderCsv(report, table));
});

reportsRouter.get('/export.xlsx', async (req, res) => {
  const { report } = await reportFor(req);
  const buffer = await renderXlsx(report);
  attachment(res, `${fileSlug(report.title)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

reportsRouter.get('/export.pdf', async (req, res) => {
  const { report } = await reportFor(req);
  const buffer = await renderPdf(report);
  attachment(res, `${fileSlug(report.title)}.pdf`, 'application/pdf');
  res.send(buffer);
});

/**
 * Machine-readable snapshot of the whole trip (records + computed summary).
 * This is the data source intended for the future AI assistant: it answers
 * from these numbers instead of inventing any.
 */
reportsRouter.get('/export.json', async (req, res) => {
  const { data, report } = await reportFor(req);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ report, records: fullTripJson(data) });
});
