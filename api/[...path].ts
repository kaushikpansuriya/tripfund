import type { Request, Response } from 'express';
import { createApp } from '../server/src/app.ts';
import { migrate } from '../server/src/migrate.ts';

const app = createApp();
let migrationPromise: Promise<void> | undefined;

export default async function handler(req: Request, res: Response): Promise<void> {
  migrationPromise ??= migrate().catch((error: unknown) => {
    migrationPromise = undefined;
    throw error;
  });

  try {
    await migrationPromise;
  } catch (error) {
    console.error('Database migration failed', error);
    res.status(503).json({
      error: { code: 'DATABASE_INITIALIZATION_FAILED', message: 'The service could not initialize its database.' },
    });
    return;
  }

  app(req, res);
}
