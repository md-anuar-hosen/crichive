import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { sql } from 'kysely';
import { db } from './db/index';
import authRouter from './routes/auth';
import publicRouter from './routes/public';
import scoringRouter from './routes/scoring';
import dataRequestsRouter from './routes/dataRequests';
import squadsRouter from './routes/squads';
import scorersRouter from './routes/scorers';
import tournamentsRouter from './routes/tournaments';
import bracketsRouter from './routes/brackets';
import { attachRealtimeServer } from './realtime/server';
import { requestLogging } from './middleware/requestLogging';

export const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    // A non-allowed origin gets no CORS headers (so the browser blocks it), not a thrown
    // error — an Error here would surface as a raw 500 with a stack trace attached.
    origin: (origin, callback) => {
      callback(null, !origin || allowedOrigins.includes(origin));
    },
  }),
);
app.use(express.json());
app.use(requestLogging);

const publicRateLimit = rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: true, legacyHeaders: false });
// Scorers post a ball every few seconds during a live match — a much higher ceiling than public reads.
const scoringRateLimit = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false });

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/health/db', async (_req, res) => {
  const result = await sql<{ count: string }>`
    SELECT count(*) AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `.execute(db);

  res.json({ ok: true, tables: Number(result.rows[0].count) });
});

app.use('/auth', publicRateLimit, authRouter);
app.use(scoringRateLimit, scoringRouter);
// Must be mounted before publicRouter: publicRouter's GET /tournaments/:slug
// would otherwise swallow literal routes like GET /tournaments/pending first,
// since Express matches in registration order, not by specificity.
app.use(publicRateLimit, tournamentsRouter);
app.use(publicRateLimit, bracketsRouter);
app.use(publicRateLimit, publicRouter);
app.use(publicRateLimit, dataRequestsRouter);
app.use(publicRateLimit, squadsRouter);
app.use(publicRateLimit, scorersRouter);

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT ?? 3000;
  const server = app.listen(port, () => {
    console.log(`CricHive backend listening on port ${port}`);
  });
  attachRealtimeServer(server);
}
