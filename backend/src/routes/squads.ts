import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index';
import { requireAuth, requireTournamentRole } from '../middleware/auth';
import { requireTeamManagement } from '../middleware/teamRole';
import { writeAuditLog } from '../services/auditLog';
import { serializePlayer } from '../serializers/public';

const router = Router();

function zodFieldErrors(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message }));
}

/** Express 5's ParamsDictionary types values as string | string[]; named (non-wildcard) segments are always plain strings at runtime. */
function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

/** requireTournamentRole reads req.params.tournamentId; these routes are keyed by :slug. */
async function resolveTournamentBySlug(req: Parameters<typeof requireAuth>[0], res: Parameters<typeof requireAuth>[1], next: Parameters<typeof requireAuth>[2]) {
  const tournament = await db.selectFrom('tournaments').select('id').where('slug', '=', req.params.slug).executeTakeFirst();
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }
  req.params.tournamentId = tournament.id;
  next();
}

// ---------------------------------------------------------------------------
// Team manager membership (organizer-only)
// ---------------------------------------------------------------------------

const grantManagerSchema = z.object({ email: z.string().email() });

router.post(
  '/tournaments/:slug/teams/:teamId/managers',
  requireAuth,
  resolveTournamentBySlug,
  requireTournamentRole('organizer'),
  async (req, res) => {
    const parsed = grantManagerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
      return;
    }
    const tournamentId = req.params.tournamentId as string;
    const teamId = param(req.params.teamId);

    const team = await db.selectFrom('teams').select('id').where('id', '=', teamId).executeTakeFirst();
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    const user = await db.selectFrom('users').select(['id', 'display_name', 'email']).where('email', '=', parsed.data.email).executeTakeFirst();
    if (!user) {
      res.status(404).json({ error: 'No account exists with that email — they need to register first' });
      return;
    }

    const existing = await db
      .selectFrom('tournament_memberships')
      .select('id')
      .where('tournament_id', '=', tournamentId)
      .where('user_id', '=', user.id)
      .where('role', '=', 'team_manager')
      .where('team_id', '=', teamId)
      .executeTakeFirst();
    if (existing) {
      res.status(409).json({ error: 'This user already manages this team' });
      return;
    }

    const membership = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('tournament_memberships')
        .values({ id: randomUUID(), tournament_id: tournamentId, user_id: user.id, role: 'team_manager', team_id: teamId })
        .returningAll()
        .executeTakeFirstOrThrow();

      await writeAuditLog(trx, {
        actorUserId: req.user!.sub,
        entityType: 'tournament_membership',
        entityId: row.id,
        action: 'grant_team_manager',
        afterState: { team_id: teamId, user_id: user.id, email: user.email },
      });

      return row;
    });

    res.status(201).json({ membership: { id: membership.id, user: { id: user.id, display_name: user.display_name, email: user.email } } });
  },
);

router.get(
  '/tournaments/:slug/teams/:teamId/managers',
  requireAuth,
  resolveTournamentBySlug,
  requireTournamentRole('organizer'),
  async (req, res) => {
    const rows = await db
      .selectFrom('tournament_memberships')
      .innerJoin('users', 'users.id', 'tournament_memberships.user_id')
      .select(['tournament_memberships.id', 'users.id as user_id', 'users.display_name', 'users.email'])
      .where('tournament_memberships.tournament_id', '=', req.params.tournamentId as string)
      .where('tournament_memberships.role', '=', 'team_manager')
      .where('tournament_memberships.team_id', '=', param(req.params.teamId))
      .execute();

    res.json({ managers: rows.map((r) => ({ id: r.id, user: { id: r.user_id, display_name: r.display_name, email: r.email } })) });
  },
);

router.delete(
  '/tournaments/:slug/teams/:teamId/managers/:membershipId',
  requireAuth,
  resolveTournamentBySlug,
  requireTournamentRole('organizer'),
  async (req, res) => {
    const deleted = await db.transaction().execute(async (trx) => {
      const row = await trx
        .deleteFrom('tournament_memberships')
        .where('id', '=', param(req.params.membershipId))
        .where('tournament_id', '=', req.params.tournamentId as string)
        .where('team_id', '=', param(req.params.teamId))
        .where('role', '=', 'team_manager')
        .returningAll()
        .executeTakeFirst();

      if (row) {
        await writeAuditLog(trx, {
          actorUserId: req.user!.sub,
          entityType: 'tournament_membership',
          entityId: row.id,
          action: 'revoke_team_manager',
          beforeState: { team_id: row.team_id, user_id: row.user_id },
        });
      }
      return row;
    });

    if (!deleted) {
      res.status(404).json({ error: 'No such team manager membership' });
      return;
    }
    res.json({ ok: true });
  },
);

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}

// ---------------------------------------------------------------------------
// Squad management (organizer, or the team's own team_manager)
// ---------------------------------------------------------------------------

const squadEntrySchema = z.object({
  player_id: z.string().uuid(),
  jersey_number: z.number().int().min(1).max(999).optional(),
  is_captain: z.boolean().optional(),
  is_keeper: z.boolean().optional(),
});

router.post('/tournaments/:slug/teams/:teamId/squad', requireAuth, requireTeamManagement, async (req, res) => {
  const parsed = squadEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const tournamentId = req.params.tournamentId as string;
  const teamId = param(req.params.teamId);
  const { player_id, jersey_number, is_captain, is_keeper } = parsed.data;

  const player = await db.selectFrom('players').select('id').where('id', '=', player_id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!player) {
    res.status(404).json({ error: 'Player not found' });
    return;
  }

  // The organizer IS the approving authority, so their own additions don't
  // need a separate self-approval step. A team_manager's addition is a
  // proposal — it sits pending until the organizer approves it.
  const isOrganizer = req.teamManagementRole === 'organizer';

  try {
    const row = await db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('team_squads')
        .values({
          id: randomUUID(),
          tournament_id: tournamentId,
          team_id: teamId,
          player_id,
          jersey_number: jersey_number ?? null,
          is_captain: is_captain ?? false,
          is_keeper: is_keeper ?? false,
          approved_at: isOrganizer ? new Date() : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await writeAuditLog(trx, {
        actorUserId: req.user!.sub,
        entityType: 'team_squad',
        entityId: inserted.id,
        action: isOrganizer ? 'add_squad_player_approved' : 'propose_squad_player',
        afterState: { team_id: teamId, player_id, jersey_number, is_captain, is_keeper },
      });

      return inserted;
    });

    res.status(201).json({
      squad_entry: {
        player_id: row.player_id,
        jersey_number: row.jersey_number,
        is_captain: row.is_captain,
        is_keeper: row.is_keeper,
        is_approved: row.approved_at !== null,
        licence_verified: row.licence_verified,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'This player is already in a squad for this tournament' });
      return;
    }
    throw err;
  }
});

const squadPatchSchema = z
  .object({
    jersey_number: z.number().int().min(1).max(999).nullable(),
    is_captain: z.boolean(),
    is_keeper: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });

router.patch('/tournaments/:slug/teams/:teamId/squad/:playerId', requireAuth, requireTeamManagement, async (req, res) => {
  const parsed = squadPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const tournamentId = req.params.tournamentId as string;
  const teamId = param(req.params.teamId);
  const playerId = param(req.params.playerId);

  const existing = await db
    .selectFrom('team_squads')
    .selectAll()
    .where('tournament_id', '=', tournamentId)
    .where('team_id', '=', teamId)
    .where('player_id', '=', playerId)
    .executeTakeFirst();
  if (!existing) {
    res.status(404).json({ error: 'This player is not in the squad' });
    return;
  }

  // A team_manager editing an already-approved entry re-opens it for
  // organizer review, since what's being approved has just changed.
  // An organizer's own edit stands as its own approval.
  const isOrganizer = req.teamManagementRole === 'organizer';
  const resetsApproval = !isOrganizer && existing.approved_at !== null;

  const updated = await db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable('team_squads')
      .set({ ...parsed.data, ...(resetsApproval ? { approved_at: null } : {}) })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'team_squad',
      entityId: row.id,
      action: 'edit_squad_player',
      beforeState: { jersey_number: existing.jersey_number, is_captain: existing.is_captain, is_keeper: existing.is_keeper },
      afterState: parsed.data,
    });

    return row;
  });

  res.json({
    squad_entry: {
      player_id: updated.player_id,
      jersey_number: updated.jersey_number,
      is_captain: updated.is_captain,
      is_keeper: updated.is_keeper,
      is_approved: updated.approved_at !== null,
      licence_verified: updated.licence_verified,
    },
  });
});

router.delete('/tournaments/:slug/teams/:teamId/squad/:playerId', requireAuth, requireTeamManagement, async (req, res) => {
  const tournamentId = req.params.tournamentId as string;
  const teamId = param(req.params.teamId);
  const playerId = param(req.params.playerId);

  const existing = await db
    .selectFrom('team_squads')
    .select('id')
    .where('tournament_id', '=', tournamentId)
    .where('team_id', '=', teamId)
    .where('player_id', '=', playerId)
    .executeTakeFirst();
  if (!existing) {
    res.status(404).json({ error: 'This player is not in the squad' });
    return;
  }

  // Can't retroactively pull someone out of the squad once they've actually
  // played for this team in this tournament — that would corrupt history
  // playing-XI/scorecards already depend on.
  const alreadyPlayed = await db
    .selectFrom('match_players')
    .innerJoin('matches', 'matches.id', 'match_players.match_id')
    .select('match_players.match_id')
    .where('matches.tournament_id', '=', tournamentId)
    .where('match_players.team_id', '=', teamId)
    .where('match_players.player_id', '=', playerId)
    .executeTakeFirst();
  if (alreadyPlayed) {
    res.status(409).json({ error: 'This player has already appeared in a match for this team and cannot be removed from the squad' });
    return;
  }

  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('team_squads').where('id', '=', existing.id).execute();
    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'team_squad',
      entityId: existing.id,
      action: 'remove_squad_player',
      beforeState: { team_id: teamId, player_id: playerId },
    });
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /tournaments/:slug/teams/:teamId/squad/manage — full roster, incl.
// pending proposals and licence status (organizer or that team's manager).
// ---------------------------------------------------------------------------

router.get('/tournaments/:slug/teams/:teamId/squad/manage', requireAuth, requireTeamManagement, async (req, res) => {
  const tournamentId = req.params.tournamentId as string;
  const teamId = param(req.params.teamId);

  const rows = await db
    .selectFrom('team_squads')
    .innerJoin('players', 'players.id', 'team_squads.player_id')
    .select([
      'players.id',
      'players.full_name',
      'players.display_name',
      'players.batting',
      'players.bowling',
      'players.photo_url',
      'team_squads.jersey_number',
      'team_squads.is_captain',
      'team_squads.is_keeper',
      'team_squads.approved_at',
      'team_squads.licence_verified',
      'team_squads.licence_verified_at',
    ])
    .where('team_squads.tournament_id', '=', tournamentId)
    .where('team_squads.team_id', '=', teamId)
    .orderBy('team_squads.jersey_number', 'asc')
    .execute();

  res.json({
    squad: rows.map((r) => ({
      ...serializePlayer(r),
      jersey_number: r.jersey_number,
      is_captain: r.is_captain,
      is_keeper: r.is_keeper,
      is_approved: r.approved_at !== null,
      approved_at: r.approved_at,
      licence_verified: r.licence_verified,
      licence_verified_at: r.licence_verified_at,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /tournaments/:slug/teams/:teamId/squad/:playerId/approve — organizer
// only. Confirms the squad placement and records the manual Suomisport
// licence check in the same step.
// ---------------------------------------------------------------------------

const approveSchema = z.object({ licence_verified: z.boolean() });

router.post(
  '/tournaments/:slug/teams/:teamId/squad/:playerId/approve',
  requireAuth,
  resolveTournamentBySlug,
  requireTournamentRole('organizer'),
  async (req, res) => {
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
      return;
    }
    const tournamentId = req.params.tournamentId as string;
    const teamId = param(req.params.teamId);
    const playerId = param(req.params.playerId);

    const existing = await db
      .selectFrom('team_squads')
      .select('id')
      .where('tournament_id', '=', tournamentId)
      .where('team_id', '=', teamId)
      .where('player_id', '=', playerId)
      .executeTakeFirst();
    if (!existing) {
      res.status(404).json({ error: 'This player is not in the squad' });
      return;
    }

    const now = new Date();
    const updated = await db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('team_squads')
        .set({
          approved_at: now,
          licence_verified: parsed.data.licence_verified,
          licence_verified_by: req.user!.sub,
          licence_verified_at: now,
        })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      await writeAuditLog(trx, {
        actorUserId: req.user!.sub,
        entityType: 'team_squad',
        entityId: row.id,
        action: 'approve_squad_player',
        afterState: { team_id: teamId, player_id: playerId, licence_verified: parsed.data.licence_verified },
      });

      return row;
    });

    res.json({
      squad_entry: {
        player_id: updated.player_id,
        is_approved: updated.approved_at !== null,
        licence_verified: updated.licence_verified,
      },
    });
  },
);

export default router;
