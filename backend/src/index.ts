import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { sql } from 'kysely';
import { db } from './db/index';
import authRouter from './routes/auth';
import publicRouter from './routes/public';
import scoringRouter from './routes/scoring';

export const app = express();

app.use(cors());
app.use(express.json());

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

app.use('/auth', authRouter);
app.use(scoringRouter);
app.use(publicRouter);

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT ?? 3000;
  app.listen(port, () => {
    console.log(`CricHive backend listening on port ${port}`);
  });
}
