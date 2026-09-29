import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

  // Single-service hosting (e.g. Render): when the web app has been built into
  // web/dist, the API serves it too, so site and API share one address.
  // With Docker Compose, nginx serves the web app instead and this is skipped.
  if (existsSync(join(config.webDist, 'index.html'))) {
    app.use(
      express.static(config.webDist, {
        index: false,
        setHeaders: (res, filePath) => {
          res.setHeader('Cache-Control', filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
    app.get(/^(?!\/api(\/|$)).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(config.webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
