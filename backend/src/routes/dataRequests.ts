import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index';
import { requireAuth } from '../middleware/auth';
import { requirePlatformAdmin } from '../middleware/platformAdmin';
import { isUuid } from '../utils/validation';

const router = Router();

function zodFieldErrors(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message }));
}

const DATA_REQUEST_STATUSES = ['open', 'in_progress', 'resolved', 'rejected'] as const;

const createSchema = z.object({
  player_id: z.string().uuid().optional(),
  raised_by_email: z.string().trim().toLowerCase().email(),
  kind: z.enum(['correction', 'erasure', 'access', 'objection']),
  details: z.string().trim().optional(),
});

// Public: anyone (a player, a guardian) can raise a GDPR correction/erasure/access/objection request.
router.post('/data-requests', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }

  const created = await db
    .insertInto('data_requests')
    .values({
      player_id: parsed.data.player_id ?? null,
      raised_by_email: parsed.data.raised_by_email,
      kind: parsed.data.kind,
      details: parsed.data.details ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  res.status(201).json({ data_request: created });
});

// Platform-admin only from here — this queue spans every tournament, and touches raw contact emails.
router.get('/data-requests', requireAuth, requirePlatformAdmin, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (status && !DATA_REQUEST_STATUSES.includes(status as (typeof DATA_REQUEST_STATUSES)[number])) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  let query = db.selectFrom('data_requests').selectAll().orderBy('created_at', 'desc');
  if (status) query = query.where('status', '=', status as (typeof DATA_REQUEST_STATUSES)[number]);

  const rows = await query.execute();
  res.json({ data_requests: rows });
});

const resolveSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'rejected']),
  resolution_note: z.string().trim().optional(),
});

router.patch('/data-requests/:id', requireAuth, requirePlatformAdmin, async (req, res) => {
  if (!isUuid(req.params.id as string)) {
    res.status(404).json({ error: 'Data request not found' });
    return;
  }
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }

  const updated = await db
    .updateTable('data_requests')
    .set({
      status: parsed.data.status,
      resolution_note: parsed.data.resolution_note ?? null,
      handled_by: req.user!.sub,
      resolved_at: parsed.data.status === 'resolved' || parsed.data.status === 'rejected' ? new Date() : null,
    })
    .where('id', '=', req.params.id as string)
    .returningAll()
    .executeTakeFirst();

  if (!updated) {
    res.status(404).json({ error: 'Data request not found' });
    return;
  }

  res.json({ data_request: updated });
});

export default router;
