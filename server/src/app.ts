import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { CURRENCIES } from '../../packages/engine/src/index.ts';
import { loadTripAccess } from './access.ts';
import { authenticate, csrfProtection, requireAuth } from './auth.ts';
import { config } from './config.ts';
import { pool } from './db.ts';
import { errorHandler, notFound } from './http.ts';
import { authRouter } from './routes/auth.ts';
import { financeRouter } from './routes/finance.ts';
import { notificationsRouter } from './routes/notifications.ts';
import { reportsRouter } from './routes/reports.ts';
import { tripRouter, tripsRouter } from './routes/trips.ts';
import { PAYMENT_METHODS } from './validation.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');

  app.use(helmet());
  app.use(express.json({ limit: '200kb' }));

  // General rate limit for the whole API (per IP).
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
    }),
  );

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  app.get('/api/meta', (_req, res) => {
    res.json({ currencies: Object.values(CURRENCIES), paymentMethods: PAYMENT_METHODS });
  });

  app.use('/api', authenticate, csrfProtection);
  app.use('/api/auth', authRouter);
  app.use('/api/notifications', requireAuth, notificationsRouter);
  app.use('/api/trips', requireAuth, tripsRouter);
  app.use('/api/trips/:tripId', requireAuth, loadTripAccess, tripRouter, financeRouter, reportsRouter);

  app.use('/api', (_req, _res, next) => next(notFound('Unknown API endpoint.')));
  app.use(errorHandler);
  return app;
}
