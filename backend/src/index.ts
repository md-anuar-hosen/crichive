import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { sql } from 'kysely';
import { db } from './db/index';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health/db', async (_req, res) => {
  const result = await sql<{ count: string }>`
    SELECT count(*) AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `.execute(db);

  res.json({ ok: true, tables: Number(result.rows[0].count) });
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`CricHive backend listening on port ${port}`);
});
