import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

/** Assigns a request id and logs one structured JSON line per request on completion. */
export function requestLogging(req: Request, res: Response, next: NextFunction): void {
  req.id = req.headers['x-request-id']?.toString() ?? randomUUID();
  res.set('X-Request-Id', req.id);

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.log(
      JSON.stringify({
        level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        request_id: req.id,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
        ts: new Date().toISOString(),
      }),
    );
  });

  next();
}
