import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { SplitError, LedgerError } from '../../packages/engine/src/index.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Please log in.') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do this.') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, 'CONFLICT', message, details);
export const unprocessable = (code: string, message: string, details?: unknown) => new HttpError(422, code, message, details);

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
}

function isPgError(error: unknown): error is PgError & Error {
  return error instanceof Error && typeof (error as PgError).code === 'string' && /^[0-9A-Z]{5}$/.test((error as PgError).code!);
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are missing or invalid.',
        details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  if (error instanceof SplitError) {
    res.status(422).json({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error instanceof LedgerError) {
    res.status(422).json({ error: { code: error.code, message: error.message, details: { recordId: error.recordId } } });
    return;
  }
  if (isPgError(error)) {
    if (error.code === '23505') {
      res.status(409).json({ error: { code: 'DUPLICATE', message: 'That already exists.', details: { constraint: error.constraint } } });
      return;
    }
    if (error.code === '23503') {
      res.status(409).json({
        error: { code: 'IN_USE', message: 'This is linked to other records and cannot be changed that way.', details: { constraint: error.constraint } },
      });
      return;
    }
    if (error.code === '23514' || error.code === '22003' || error.code === '22008' || error.code === '22007') {
      res.status(422).json({ error: { code: 'INVALID_DATA', message: 'The data does not pass validation.', details: { constraint: error.constraint } } });
      return;
    }
  }
  // Body parser errors (malformed JSON, too large)
  const status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode;
  if (status === 400 || status === 413) {
    res.status(status).json({ error: { code: status === 413 ? 'TOO_LARGE' : 'BAD_REQUEST', message: (error as Error).message } });
    return;
  }
  console.error(`[${req.method} ${req.originalUrl}]`, error);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
};
