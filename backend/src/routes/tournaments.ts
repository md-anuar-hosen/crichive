import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index';
import { requireAuth, requireTournamentRole } from '../middleware/auth';
import { requirePlatformAdmin } from '../middleware/platformAdmin';
import { writeAuditLog } from '../services/auditLog';

const router = Router();

function zodFieldErrors(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message }));
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}

// platform_settings has no UUID identity (it's a boolean-keyed singleton row),
// but audit_log.entity_id is UUID NOT NULL — this nil UUID stands in for "the
// platform settings singleton" in the audit trail.
const PLATFORM_SETTINGS_AUDIT_ID = '00000000-0000-0000-0000-000000000000';

// ---------------------------------------------------------------------------
// Platform settings — a single global switch, not tournament-scoped.
// ---------------------------------------------------------------------------

router.get('/platform/settings', async (_req, res) => {
  const settings = await db.selectFrom('platform_settings').select('organizer_signup_mode').where('id', '=', true).executeTakeFirstOrThrow();
  res.json({ organizer_signup_mode: settings.organizer_signup_mode });
});

const settingsSchema = z.object({ organizer_signup_mode: z.enum(['open', 'approval_required']) });

router.patch('/platform/settings', requireAuth, requirePlatformAdmin, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }

  const updated = await db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable('platform_settings')
      .set({ organizer_signup_mode: parsed.data.organizer_signup_mode, updated_by: req.user!.sub, updated_at: new Date() })
      .where('id', '=', true)
      .returningAll()
      .executeTakeFirstOrThrow();

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'platform_settings',
      entityId: PLATFORM_SETTINGS_AUDIT_ID,
      action: 'update_settings',
      afterState: { organizer_signup_mode: parsed.data.organizer_signup_mode },
    });

    return row;
  });

  res.json({ organizer_signup_mode: updated.organizer_signup_mode });
});

// ---------------------------------------------------------------------------
// POST /tournaments — any authenticated user creates a tournament and
// becomes its organizer immediately. Whether it goes live immediately or
// waits for a platform admin to approve it depends on the current
// organizer_signup_mode.
//
// Kept as one small, self-contained transaction so a future "pro" gate
// (e.g. a subscription check before allowing creation) can slot in as a
// single guard at the top of this handler without restructuring anything.
// ---------------------------------------------------------------------------

/**
 * Real Law 14.2 follow-on margins, keyed by scheduled match length — used
 * only as the organizer-editable default, never re-consulted at scoring
 * time (that always reads tournament_rules.follow_on_margin).
 */
function defaultFollowOnMargin(daysPerMatch: number): number {
  if (daysPerMatch >= 5) return 200;
  if (daysPerMatch >= 3) return 150;
  if (daysPerMatch === 2) return 100;
  return 75;
}

const createTournamentSchema = z
  .object({
    name: z.string().trim().min(1),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),
    season_year: z.number().int().min(2000).max(2100),
    match_type: z.enum(['limited_overs', 'test']).optional(),
    overs_per_innings: z.number().int().min(1).max(50).optional(),
    max_overs_per_bowler: z.number().int().min(1).optional(),
    days_per_match: z.number().int().min(1).max(6).optional(),
    follow_on_margin: z.number().int().min(0).optional(),
    organizer_org: z.string().trim().optional(),
    country_code: z.string().length(2).optional(),
    ball: z.enum(['leather', 'tennis', 'tape']).optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.match_type ?? 'limited_overs') === 'limited_overs') {
      if (data.overs_per_innings === undefined) ctx.addIssue({ code: 'custom', message: 'Required', path: ['overs_per_innings'] });
      if (data.max_overs_per_bowler === undefined) ctx.addIssue({ code: 'custom', message: 'Required', path: ['max_overs_per_bowler'] });
    } else if (data.days_per_match === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Required', path: ['days_per_match'] });
    }
  });

router.post('/tournaments', requireAuth, async (req, res) => {
  const parsed = createTournamentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const data = parsed.data;
  const matchType = data.match_type ?? 'limited_overs';
  if (matchType === 'limited_overs' && data.max_overs_per_bowler! > data.overs_per_innings!) {
    res.status(400).json({ error: 'max_overs_per_bowler cannot exceed overs_per_innings' });
    return;
  }

  const settings = await db.selectFrom('platform_settings').select('organizer_signup_mode').where('id', '=', true).executeTakeFirstOrThrow();
  const isOpen = settings.organizer_signup_mode === 'open';

  try {
    const tournament = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('tournaments')
        .values({
          id: randomUUID(),
          name: data.name,
          slug: data.slug,
          season_year: data.season_year,
          organizer_org: data.organizer_org ?? null,
          country_code: data.country_code ?? 'FI',
          ball: data.ball ?? 'leather',
          created_by: req.user!.sub,
          is_public: isOpen,
          approved_at: isOpen ? new Date() : null,
          approved_by: isOpen ? req.user!.sub : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('tournament_rules')
        .values({
          tournament_id: created.id,
          match_type: matchType,
          overs_per_innings: matchType === 'limited_overs' ? data.overs_per_innings! : null,
          max_overs_per_bowler: matchType === 'limited_overs' ? data.max_overs_per_bowler! : null,
          days_per_match: matchType === 'test' ? data.days_per_match! : null,
          follow_on_margin: matchType === 'test' ? (data.follow_on_margin ?? defaultFollowOnMargin(data.days_per_match!)) : undefined,
        })
        .execute();

      await trx
        .insertInto('tournament_memberships')
        .values({ id: randomUUID(), tournament_id: created.id, user_id: req.user!.sub, role: 'organizer' })
        .execute();

      await writeAuditLog(trx, {
        actorUserId: req.user!.sub,
        entityType: 'tournament',
        entityId: created.id,
        action: 'create',
        afterState: { name: data.name, slug: data.slug, auto_approved: isOpen },
      });

      return created;
    });

    res.status(201).json({
      tournament: { id: tournament.id, slug: tournament.slug, name: tournament.name, is_public: tournament.is_public, is_approved: tournament.approved_at !== null },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'That slug is already taken' });
      return;
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// PATCH /tournaments/:slug — organizer-only branding edits. Both fields
// (logo_url, organizer_org) existed unused in the schema since the first
// migration; there was never a route to set either of them.
// ---------------------------------------------------------------------------

/** requireTournamentRole reads req.params.tournamentId; this route is keyed by :slug. */
async function resolveTournamentBySlug(req: Parameters<typeof requireAuth>[0], res: Parameters<typeof requireAuth>[1], next: Parameters<typeof requireAuth>[2]) {
  const tournament = await db.selectFrom('tournaments').select('id').where('slug', '=', req.params.slug).executeTakeFirst();
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }
  req.params.tournamentId = tournament.id;
  next();
}

const brandingSchema = z
  .object({
    logo_url: z.union([z.string().trim().url(), z.literal('')]).nullable(),
    organizer_org: z.string().trim().nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });

router.patch('/tournaments/:slug', requireAuth, resolveTournamentBySlug, requireTournamentRole('organizer'), async (req, res) => {
  const parsed = brandingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const tournamentId = req.params.tournamentId as string;
  const updates: { logo_url?: string | null; organizer_org?: string | null } = {};
  if (parsed.data.logo_url !== undefined) updates.logo_url = parsed.data.logo_url === '' ? null : parsed.data.logo_url;
  if (parsed.data.organizer_org !== undefined) updates.organizer_org = parsed.data.organizer_org;

  const updated = await db.transaction().execute(async (trx) => {
    const row = await trx.updateTable('tournaments').set(updates).where('id', '=', tournamentId).returningAll().executeTakeFirstOrThrow();

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'tournament',
      entityId: tournamentId,
      action: 'update_branding',
      afterState: updates,
    });

    return row;
  });

  res.json({ tournament: { id: updated.id, logo_url: updated.logo_url, organizer_org: updated.organizer_org } });
});

// ---------------------------------------------------------------------------
// Platform-admin approval queue
// ---------------------------------------------------------------------------

router.get('/tournaments/pending', requireAuth, requirePlatformAdmin, async (_req, res) => {
  const rows = await db
    .selectFrom('tournaments')
    .innerJoin('users', 'users.id', 'tournaments.created_by')
    .select(['tournaments.id', 'tournaments.slug', 'tournaments.name', 'tournaments.season_year', 'tournaments.created_at', 'users.display_name as created_by_name', 'users.email as created_by_email'])
    .where('tournaments.approved_at', 'is', null)
    .orderBy('tournaments.created_at', 'asc')
    .execute();

  res.json({
    tournaments: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      season_year: r.season_year,
      created_at: r.created_at,
      created_by: { name: r.created_by_name, email: r.created_by_email },
    })),
  });
});

router.post('/tournaments/:slug/approve', requireAuth, requirePlatformAdmin, async (req, res) => {
  const updated = await db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable('tournaments')
      .set({ approved_at: new Date(), approved_by: req.user!.sub, is_public: true })
      .where('slug', '=', req.params.slug)
      .where('approved_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    if (row) {
      await writeAuditLog(trx, {
        actorUserId: req.user!.sub,
        entityType: 'tournament',
        entityId: row.id,
        action: 'approve',
      });
    }
    return row;
  });

  if (!updated) {
    res.status(404).json({ error: 'No pending tournament with that slug' });
    return;
  }
  res.json({ tournament: { id: updated.id, slug: updated.slug, is_public: updated.is_public, is_approved: true } });
});

export default router;
