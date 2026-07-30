import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index';
import { requireAuth, requireTournamentRole } from '../middleware/auth';
import { requireMatchRole } from '../middleware/matchRole';
import { writeAuditLog } from '../services/auditLog';
import { isUuid } from '../utils/validation';

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
// Tournament-scoped scorer membership (organizer-only). A "scorer" grant
// here only makes someone eligible to be assigned to matches — see below.
// With several matches running at once (e.g. Finn-Bangla's 4-5 concurrent
// group games), a tournament-wide scorer being able to touch every match at
// once is exactly the mix-up this two-tier model avoids: grant covers "this
// person scores for us", assignment covers "this person scores THIS match".
// ---------------------------------------------------------------------------

const grantScorerSchema = z.object({ email: z.string().email() });

router.post('/tournaments/:slug/scorers', requireAuth, resolveTournamentBySlug, requireTournamentRole('organizer'), async (req, res) => {
  const parsed = grantScorerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const tournamentId = req.params.tournamentId as string;

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
    .where('role', '=', 'scorer')
    .executeTakeFirst();
  if (existing) {
    res.status(409).json({ error: 'This user is already a scorer for this tournament' });
    return;
  }

  const membership = await db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto('tournament_memberships')
      .values({ id: randomUUID(), tournament_id: tournamentId, user_id: user.id, role: 'scorer', team_id: null })
      .returningAll()
      .executeTakeFirstOrThrow();

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'tournament_membership',
      entityId: row.id,
      action: 'grant_scorer',
      afterState: { user_id: user.id, email: user.email },
    });

    return row;
  });

  res.status(201).json({ membership: { id: membership.id, user: { id: user.id, display_name: user.display_name, email: user.email } } });
});

router.get('/tournaments/:slug/scorers', requireAuth, resolveTournamentBySlug, requireTournamentRole('organizer'), async (req, res) => {
  const rows = await db
    .selectFrom('tournament_memberships')
    .innerJoin('users', 'users.id', 'tournament_memberships.user_id')
    .select(['tournament_memberships.id', 'users.id as user_id', 'users.display_name', 'users.email'])
    .where('tournament_memberships.tournament_id', '=', req.params.tournamentId as string)
    .where('tournament_memberships.role', '=', 'scorer')
    .orderBy('users.display_name', 'asc')
    .execute();

  res.json({ scorers: rows.map((r) => ({ id: r.id, user: { id: r.user_id, display_name: r.display_name, email: r.email } })) });
});

router.delete('/tournaments/:slug/scorers/:membershipId', requireAuth, resolveTournamentBySlug, requireTournamentRole('organizer'), async (req, res) => {
  const tournamentId = req.params.tournamentId as string;

  const deleted = await db.transaction().execute(async (trx) => {
    const row = await trx
      .deleteFrom('tournament_memberships')
      .where('id', '=', param(req.params.membershipId))
      .where('tournament_id', '=', tournamentId)
      .where('role', '=', 'scorer')
      .returningAll()
      .executeTakeFirst();

    if (row) {
      // Revoking the tournament-wide grant should also clear any per-match
      // assignments this scorer held in the same tournament — a dangling
      // match_scorers row pointing at someone who's no longer a scorer here
      // would otherwise silently keep letting them through requireMatchRole.
      await trx
        .deleteFrom('match_scorers')
        .where('user_id', '=', row.user_id)
        .where('match_id', 'in', trx.selectFrom('matches').select('id').where('tournament_id', '=', tournamentId))
        .execute();

      await writeAuditLog(trx, {
        actorUserId: req.user!.sub,
        entityType: 'tournament_membership',
        entityId: row.id,
        action: 'revoke_scorer',
        beforeState: { user_id: row.user_id },
      });
    }
    return row;
  });

  if (!deleted) {
    res.status(404).json({ error: 'No such scorer membership' });
    return;
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Per-match scorer assignment (organizer-only). This is the piece that
// actually lets requireMatchRole restrict a tournament-scoped scorer to
// only the specific match(es) they've been assigned — see matchRole.ts.
// ---------------------------------------------------------------------------

const assignScorerSchema = z.object({ user_id: z.string().uuid() });

router.post('/matches/:id/scorers', requireAuth, requireMatchRole('organizer'), async (req, res) => {
  const parsed = assignScorerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const matchId = param(req.params.id);

  const match = await db.selectFrom('matches').select(['id', 'tournament_id']).where('id', '=', matchId).executeTakeFirst();
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }

  const membership = await db
    .selectFrom('tournament_memberships')
    .innerJoin('users', 'users.id', 'tournament_memberships.user_id')
    .select(['users.id', 'users.display_name', 'users.email'])
    .where('tournament_memberships.tournament_id', '=', match.tournament_id)
    .where('tournament_memberships.user_id', '=', parsed.data.user_id)
    .where('tournament_memberships.role', '=', 'scorer')
    .executeTakeFirst();
  if (!membership) {
    res.status(400).json({ error: 'That user is not a scorer for this tournament — grant them the role first' });
    return;
  }

  const existing = await db.selectFrom('match_scorers').select('user_id').where('match_id', '=', matchId).where('user_id', '=', parsed.data.user_id).executeTakeFirst();
  if (existing) {
    res.status(409).json({ error: 'Already assigned to this match' });
    return;
  }

  await db.transaction().execute(async (trx) => {
    await trx.insertInto('match_scorers').values({ match_id: matchId, user_id: parsed.data.user_id }).execute();

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'match',
      entityId: matchId,
      action: 'assign_scorer',
      afterState: { user_id: parsed.data.user_id },
    });
  });

  res.status(201).json({ scorer: { id: membership.id, display_name: membership.display_name, email: membership.email } });
});

router.get('/matches/:id/scorers', requireAuth, requireMatchRole('organizer', 'scorer'), async (req, res) => {
  if (!isUuid(param(req.params.id))) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }
  const rows = await db
    .selectFrom('match_scorers')
    .innerJoin('users', 'users.id', 'match_scorers.user_id')
    .select(['users.id', 'users.display_name', 'users.email'])
    .where('match_scorers.match_id', '=', param(req.params.id))
    .orderBy('users.display_name', 'asc')
    .execute();

  res.json({ scorers: rows.map((r) => ({ id: r.id, display_name: r.display_name, email: r.email })) });
});

router.delete('/matches/:id/scorers/:userId', requireAuth, requireMatchRole('organizer'), async (req, res) => {
  const matchId = param(req.params.id);
  const userId = param(req.params.userId);

  const deleted = await db.transaction().execute(async (trx) => {
    const row = await trx.deleteFrom('match_scorers').where('match_id', '=', matchId).where('user_id', '=', userId).returningAll().executeTakeFirst();
    if (row) {
      await writeAuditLog(trx, {
        actorUserId: req.user!.sub,
        entityType: 'match',
        entityId: matchId,
        action: 'unassign_scorer',
        beforeState: { user_id: userId },
      });
    }
    return row;
  });

  if (!deleted) {
    res.status(404).json({ error: 'That user is not assigned to this match' });
    return;
  }
  res.json({ ok: true });
});

export default router;
