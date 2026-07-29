import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import { db } from '../db/index';
import type { Matches } from '../db/types';
import { requireAuth, requireTournamentRole } from '../middleware/auth';
import { requireMatchRole } from '../middleware/matchRole';
import { buildScorecard, isNextDeliveryFreeHit, resolveMatchResult, validateDelivery } from '../domain/scoring';
import type { Delivery } from '../domain/scoring';
import { computeNextBallPosition, toDomainDelivery } from '../services/deliveryMapping';
import { applyScorecardToDerivedTables } from '../services/derivedTables';
import { getMatchScorecard } from '../services/matchScorecard';
import { loadTournamentRules } from '../services/rules';
import { recomputeGroupStandings } from '../services/standingsService';
import { recomputePlayerCareerStats } from '../services/careerStatsService';
import { broadcastDelivery } from '../realtime/hub';
import { writeAuditLog } from '../services/auditLog';

const router = Router();

const DISMISSAL_KINDS = [
  'bowled',
  'caught',
  'lbw',
  'run_out',
  'stumped',
  'hit_wicket',
  'retired_hurt',
  'retired_out',
  'obstructing_the_field',
  'hit_ball_twice',
  'timed_out',
] as const;

function zodFieldErrors(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message }));
}

/** Express 5's ParamsDictionary types values as string | string[]; named (non-wildcard) segments are always plain strings at runtime. */
function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

async function loadMatch(matchId: string): Promise<Selectable<Matches> | undefined> {
  return db.selectFrom('matches').selectAll().where('id', '=', matchId).executeTakeFirst();
}

// ---------------------------------------------------------------------------
// POST /matches/:id/toss
// ---------------------------------------------------------------------------

const tossSchema = z.object({
  winner_team_id: z.string().uuid(),
  decision: z.enum(['bat', 'bowl']),
});

router.post('/matches/:id/toss', requireAuth, requireMatchRole('organizer', 'scorer'), async (req, res) => {
  const match = await loadMatch(param(req.params.id));
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }
  if (match.status !== 'scheduled') {
    res.status(409).json({ error: `Toss already recorded for this match (status: ${match.status})` });
    return;
  }

  const parsed = tossSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const { winner_team_id, decision } = parsed.data;

  if (winner_team_id !== match.team_a_id && winner_team_id !== match.team_b_id) {
    res.status(400).json({ error: 'winner_team_id must be one of the two teams playing this match' });
    return;
  }

  const otherTeamId = winner_team_id === match.team_a_id ? match.team_b_id : match.team_a_id;
  const battingTeamId = decision === 'bat' ? winner_team_id : otherTeamId;
  const bowlingTeamId = decision === 'bat' ? otherTeamId : winner_team_id;

  const rules = await loadTournamentRules(db, match.tournament_id);

  const innings = await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('matches')
      .set({ toss_winner_id: winner_team_id, toss_decision: decision, status: 'toss_done', updated_at: new Date() })
      .where('id', '=', match.id)
      .execute();

    const created = await trx
      .insertInto('innings')
      .values({
        id: randomUUID(),
        match_id: match.id,
        innings_number: 1,
        batting_team_id: battingTeamId,
        bowling_team_id: bowlingTeamId,
        max_overs: match.overs_override ?? rules.oversPerInnings,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'match',
      entityId: match.id,
      action: 'toss',
      afterState: { winner_team_id, decision, innings_id: created.id },
    });

    return created;
  });

  res.status(201).json({ innings });
});

// ---------------------------------------------------------------------------
// POST /matches/:id/playing-xi
// ---------------------------------------------------------------------------

const playingXiSchema = z.object({
  team_id: z.string().uuid(),
  player_ids: z.array(z.string().uuid()).min(1),
  captain_id: z.string().uuid(),
  keeper_id: z.string().uuid(),
});

router.post('/matches/:id/playing-xi', requireAuth, requireMatchRole('organizer', 'scorer'), async (req, res) => {
  const match = await loadMatch(param(req.params.id));
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }

  const parsed = playingXiSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const { team_id, player_ids, captain_id, keeper_id } = parsed.data;

  if (team_id !== match.team_a_id && team_id !== match.team_b_id) {
    res.status(400).json({ error: 'team_id must be one of the two teams playing this match' });
    return;
  }

  const rules = await loadTournamentRules(db, match.tournament_id);
  if (player_ids.length !== rules.playersPerSide) {
    res.status(400).json({ error: `player_ids must contain exactly ${rules.playersPerSide} players` });
    return;
  }
  if (!player_ids.includes(captain_id) || !player_ids.includes(keeper_id)) {
    res.status(400).json({ error: 'captain_id and keeper_id must be part of player_ids' });
    return;
  }

  const squadRows = await db
    .selectFrom('team_squads')
    .select('player_id')
    .where('tournament_id', '=', match.tournament_id)
    .where('team_id', '=', team_id)
    .where('player_id', 'in', player_ids)
    .execute();

  const squadPlayerIds = new Set(squadRows.map((r) => r.player_id));
  const missing = player_ids.filter((id) => !squadPlayerIds.has(id));
  if (missing.length) {
    res.status(400).json({ error: 'Some players are not in this team\'s squad for this tournament', player_ids: missing });
    return;
  }

  const rows = await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('match_players').where('match_id', '=', match.id).where('team_id', '=', team_id).execute();

    const inserted = await trx
      .insertInto('match_players')
      .values(
        player_ids.map((playerId, index) => ({
          match_id: match.id,
          team_id,
          player_id: playerId,
          batting_order: index + 1,
          is_captain: playerId === captain_id,
          is_keeper: playerId === keeper_id,
        })),
      )
      .returningAll()
      .execute();

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'squad',
      entityId: match.id,
      action: 'set_playing_xi',
      afterState: { team_id, player_ids, captain_id, keeper_id },
    });

    return inserted;
  });

  res.status(201).json({ playing_xi: rows });
});

// ---------------------------------------------------------------------------
// POST /matches/:id/deliveries
// ---------------------------------------------------------------------------

const deliverySchema = z
  .object({
    client_event_id: z.string().uuid(),
    innings_number: z.number().int().min(1),
    striker_id: z.string().uuid(),
    non_striker_id: z.string().uuid(),
    bowler_id: z.string().uuid(),
    runs_off_bat: z.number().int().min(0).max(8).default(0),
    extra_wides: z.number().int().min(0).default(0),
    extra_noballs: z.number().int().min(0).default(0),
    extra_byes: z.number().int().min(0).default(0),
    extra_legbyes: z.number().int().min(0).default(0),
    extra_penalty: z.number().int().min(0).default(0),
    wicket_kind: z.enum(DISMISSAL_KINDS).optional(),
    player_out_id: z.string().uuid().optional(),
    fielder_id: z.string().uuid().optional(),
    commentary: z.string().optional(),
    wagon_angle_deg: z.number().int().optional(),
    wagon_distance: z.number().int().optional(),
  })
  .refine((body) => (body.wicket_kind ? !!body.player_out_id : true), {
    message: 'player_out_id is required when wicket_kind is set',
    path: ['player_out_id'],
  })
  .refine((body) => body.striker_id !== body.non_striker_id, {
    message: 'striker_id and non_striker_id must differ',
    path: ['non_striker_id'],
  });

router.post('/matches/:id/deliveries', requireAuth, requireMatchRole('organizer', 'scorer'), async (req, res) => {
  const match = await loadMatch(param(req.params.id));
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }

  const parsed = deliverySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const body = parsed.data;

  const innings = await db
    .selectFrom('innings')
    .selectAll()
    .where('match_id', '=', match.id)
    .where('innings_number', '=', body.innings_number)
    .executeTakeFirst();
  if (!innings) {
    res.status(404).json({ error: `Innings ${body.innings_number} not found for this match` });
    return;
  }

  // Idempotency check comes before anything else: a retried ball must succeed
  // even if the innings has since been closed or completed in the meantime.
  const existing = await db
    .selectFrom('deliveries')
    .selectAll()
    .where('innings_id', '=', innings.id)
    .where('client_event_id', '=', body.client_event_id)
    .executeTakeFirst();
  if (existing) {
    res.status(200).json({ delivery: existing, is_duplicate: true });
    return;
  }

  if (innings.closed_at) {
    res.status(422).json({ error: 'This innings is already closed' });
    return;
  }

  const rules = await loadTournamentRules(db, match.tournament_id);

  const priorRows = await db
    .selectFrom('deliveries')
    .selectAll()
    .where('innings_id', '=', innings.id)
    .orderBy('sequence', 'asc')
    .execute();
  const priorDeliveries: Delivery[] = priorRows.map(toDomainDelivery);
  const nonVoidedPrior = priorDeliveries.filter((d) => !d.voidedAt);

  // A chase's target is the first innings' final total + 1; only relevant from innings 2 onward.
  let target: number | undefined;
  if (body.innings_number > 1) {
    const priorInnings = await db
      .selectFrom('innings')
      .innerJoin('innings_totals', 'innings_totals.innings_id', 'innings.id')
      .select('innings_totals.runs')
      .where('innings.match_id', '=', match.id)
      .where('innings.innings_number', '=', body.innings_number - 1)
      .executeTakeFirst();
    if (priorInnings) target = priorInnings.runs + 1;
  }

  const priorScorecard = buildScorecard(nonVoidedPrior, rules, { target });
  if (priorScorecard.isComplete) {
    res.status(422).json({ error: `This innings is already complete (${priorScorecard.completionReason})` });
    return;
  }

  const isLegalDelivery = body.extra_wides === 0 && body.extra_noballs === 0;
  const lastDelivery = nonVoidedPrior[nonVoidedPrior.length - 1];
  const isFreeHit = lastDelivery ? isNextDeliveryFreeHit(lastDelivery, rules) : false;
  const position = computeNextBallPosition(nonVoidedPrior, rules);
  const ballInOver = isLegalDelivery ? position.legalBallsSoFarInOver + 1 : position.legalBallsSoFarInOver;
  const sequence = nonVoidedPrior.length ? Math.max(...priorDeliveries.map((d) => d.sequence)) + 1 : 0;

  const validation = validateDelivery(
    {
      overNumber: position.overNumber,
      bowlerId: body.bowler_id,
      isLegalDelivery,
      isFreeHit,
      wicketKind: body.wicket_kind,
    },
    nonVoidedPrior,
    rules,
  );
  if (!validation.valid) {
    res.status(422).json({ error: validation.error });
    return;
  }

  const newRow = {
    id: undefined as unknown as string, // bigserial — let Postgres assign it
    innings_id: innings.id,
    client_event_id: body.client_event_id,
    over_number: position.overNumber,
    ball_in_over: ballInOver,
    sequence,
    striker_id: body.striker_id,
    non_striker_id: body.non_striker_id,
    bowler_id: body.bowler_id,
    runs_off_bat: body.runs_off_bat,
    extra_wides: body.extra_wides,
    extra_noballs: body.extra_noballs,
    extra_byes: body.extra_byes,
    extra_legbyes: body.extra_legbyes,
    extra_penalty: body.extra_penalty,
    is_legal_delivery: isLegalDelivery,
    is_free_hit: isFreeHit,
    wicket_kind: body.wicket_kind ?? null,
    player_out_id: body.player_out_id ?? null,
    fielder_id: body.fielder_id ?? null,
    commentary: body.commentary ?? null,
    wagon_angle_deg: body.wagon_angle_deg ?? null,
    wagon_distance: body.wagon_distance ?? null,
    scored_by: req.user!.sub,
  };
  delete (newRow as { id?: unknown }).id;

  try {
    const result = await db.transaction().execute(async (trx) => {
      const inserted = await trx.insertInto('deliveries').values(newRow).returningAll().executeTakeFirstOrThrow();

      const allDeliveries = [...priorDeliveries, toDomainDelivery(inserted)];
      const scorecard = buildScorecard(
        allDeliveries.filter((d) => !d.voidedAt),
        rules,
        { target },
      );
      await applyScorecardToDerivedTables(trx, innings.id, scorecard);

      return { delivery: inserted, scorecard };
    });

    broadcastDelivery({
      type: 'delivery',
      matchId: match.id,
      inningsId: innings.id,
      delivery: result.delivery,
      totals: {
        runs: result.scorecard.runs,
        wickets: result.scorecard.wickets,
        legalBalls: result.scorecard.legalBalls,
        extras: result.scorecard.extras,
      },
      striker: result.scorecard.battingCards.find((b) => b.playerId === body.striker_id) ?? null,
      nonStriker: result.scorecard.battingCards.find((b) => b.playerId === body.non_striker_id) ?? null,
      bowler: result.scorecard.bowlingCards.find((b) => b.playerId === body.bowler_id) ?? null,
    });

    res.status(201).json({
      delivery: result.delivery,
      is_duplicate: false,
      innings_complete: result.scorecard.isComplete,
      completion_reason: result.scorecard.completionReason,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await db
        .selectFrom('deliveries')
        .selectAll()
        .where('innings_id', '=', innings.id)
        .where('client_event_id', '=', body.client_event_id)
        .executeTakeFirstOrThrow();
      res.status(200).json({ delivery: existing, is_duplicate: true });
      return;
    }
    throw err;
  }
});

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}

// ---------------------------------------------------------------------------
// POST /matches/:id/deliveries/:deliveryId/void
// ---------------------------------------------------------------------------

const voidSchema = z.object({ reason: z.string().trim().min(1) });

router.post('/matches/:id/deliveries/:deliveryId/void', requireAuth, requireMatchRole('organizer', 'scorer'), async (req, res) => {
  const match = await loadMatch(param(req.params.id));
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }

  const parsed = voidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }

  const delivery = await db
    .selectFrom('deliveries')
    .innerJoin('innings', 'innings.id', 'deliveries.innings_id')
    .selectAll('deliveries')
    .where('deliveries.id', '=', param(req.params.deliveryId))
    .where('innings.match_id', '=', match.id)
    .executeTakeFirst();

  if (!delivery) {
    res.status(404).json({ error: 'Delivery not found on this match' });
    return;
  }
  if (delivery.voided_at) {
    res.status(409).json({ error: 'Delivery is already voided' });
    return;
  }

  const rules = await loadTournamentRules(db, match.tournament_id);

  await db.transaction().execute(async (trx) => {
    const voided = await trx
      .updateTable('deliveries')
      .set({ voided_at: new Date(), voided_by: req.user!.sub, void_reason: parsed.data.reason })
      .where('id', '=', delivery.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'delivery',
      entityId: delivery.innings_id,
      action: 'void',
      beforeState: { delivery_id: delivery.id, ...delivery },
      afterState: { delivery_id: voided.id, voided_at: voided.voided_at },
      reason: parsed.data.reason,
    });

    const priorRows = await trx
      .selectFrom('deliveries')
      .selectAll()
      .where('innings_id', '=', delivery.innings_id)
      .orderBy('sequence', 'asc')
      .execute();
    const remaining = priorRows.map(toDomainDelivery).filter((d) => !d.voidedAt);
    const scorecard = buildScorecard(remaining, rules);
    await applyScorecardToDerivedTables(trx, delivery.innings_id, scorecard);
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /matches/:id/innings/:n/close
// ---------------------------------------------------------------------------

router.post('/matches/:id/innings/:n/close', requireAuth, requireMatchRole('organizer', 'scorer'), async (req, res) => {
  const match = await loadMatch(param(req.params.id));
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }

  const inningsNumber = Number.parseInt(param(req.params.n), 10);
  if (!Number.isInteger(inningsNumber) || inningsNumber < 1) {
    res.status(400).json({ error: 'Invalid innings number' });
    return;
  }

  const innings = await db
    .selectFrom('innings')
    .selectAll()
    .where('match_id', '=', match.id)
    .where('innings_number', '=', inningsNumber)
    .executeTakeFirst();
  if (!innings) {
    res.status(404).json({ error: `Innings ${inningsNumber} not found` });
    return;
  }
  if (innings.closed_at) {
    res.status(409).json({ error: 'Innings already closed' });
    return;
  }

  const rules = await loadTournamentRules(db, match.tournament_id);

  if (inningsNumber === 1) {
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('innings').set({ closed_at: new Date() }).where('id', '=', innings.id).execute();

      const firstInningsTotals = await trx
        .selectFrom('innings_totals')
        .select('runs')
        .where('innings_id', '=', innings.id)
        .executeTakeFirst();

      await trx
        .insertInto('innings')
        .values({
          id: randomUUID(),
          match_id: match.id,
          innings_number: 2,
          batting_team_id: innings.bowling_team_id,
          bowling_team_id: innings.batting_team_id,
          max_overs: match.overs_override ?? rules.oversPerInnings,
          target: (firstInningsTotals?.runs ?? 0) + 1,
        })
        .execute();

      await trx.updateTable('matches').set({ status: 'innings_break', updated_at: new Date() }).where('id', '=', match.id).execute();

      await writeAuditLog(trx, {
        actorUserId: req.user!.sub,
        entityType: 'match',
        entityId: match.id,
        action: 'close_innings',
        afterState: { innings_number: 1, next_innings_number: 2 },
      });
    });

    res.json({ ok: true, next_innings_number: 2 });
    return;
  }

  const [firstTotals, secondTotals] = await Promise.all([
    db
      .selectFrom('innings')
      .innerJoin('innings_totals', 'innings_totals.innings_id', 'innings.id')
      .select(['innings_totals.runs', 'innings_totals.wickets'])
      .where('innings.match_id', '=', match.id)
      .where('innings.innings_number', '=', 1)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('innings')
      .innerJoin('innings_totals', 'innings_totals.innings_id', 'innings.id')
      .select(['innings_totals.runs', 'innings_totals.wickets'])
      .where('innings.match_id', '=', match.id)
      .where('innings.innings_number', '=', inningsNumber)
      .executeTakeFirstOrThrow(),
  ]);

  const outcome = resolveMatchResult(firstTotals, secondTotals, rules);

  await db.transaction().execute(async (trx) => {
    await trx.updateTable('innings').set({ closed_at: new Date() }).where('id', '=', innings.id).execute();

    const innings1 = await trx
      .selectFrom('innings')
      .select(['batting_team_id', 'bowling_team_id'])
      .where('match_id', '=', match.id)
      .where('innings_number', '=', 1)
      .executeTakeFirstOrThrow();

    if (outcome.kind === 'tie') {
      await trx
        .updateTable('matches')
        .set({ result: 'tie', status: 'completed', result_note: 'Tied', updated_at: new Date() })
        .where('id', '=', match.id)
        .execute();
    } else if (outcome.kind === 'batting_first_won') {
      await trx
        .updateTable('matches')
        .set({
          result: innings1.batting_team_id === match.team_a_id ? 'team_a_won' : 'team_b_won',
          winner_team_id: innings1.batting_team_id,
          win_margin_runs: outcome.marginRuns,
          result_note: `Won by ${outcome.marginRuns} run(s)`,
          status: 'completed',
          updated_at: new Date(),
        })
        .where('id', '=', match.id)
        .execute();
    } else {
      await trx
        .updateTable('matches')
        .set({
          result: innings1.bowling_team_id === match.team_a_id ? 'team_a_won' : 'team_b_won',
          winner_team_id: innings1.bowling_team_id,
          win_margin_wickets: outcome.marginWickets,
          result_note: `Won by ${outcome.marginWickets} wicket(s)`,
          status: 'completed',
          updated_at: new Date(),
        })
        .where('id', '=', match.id)
        .execute();
    }

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'match',
      entityId: match.id,
      action: 'complete',
      afterState: { innings_number: inningsNumber, outcome },
    });
  });

  // Standings and career stats are caches over completed matches — recompute
  // them now that this one just finished.
  if (match.group_id) {
    await recomputeGroupStandings(match.group_id);
  }
  const matchPlayers = await db.selectFrom('match_players').select('player_id').where('match_id', '=', match.id).execute();
  if (matchPlayers.length) {
    await recomputePlayerCareerStats(matchPlayers.map((p) => p.player_id));
  }

  res.json({ ok: true, outcome });
});

// ---------------------------------------------------------------------------
// POST /matches/:id/abandon
// ---------------------------------------------------------------------------

const abandonSchema = z.object({ reason: z.string().trim().min(1) });

router.post('/matches/:id/abandon', requireAuth, requireMatchRole('organizer', 'scorer'), async (req, res) => {
  const match = await loadMatch(param(req.params.id));
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }
  if (['completed', 'abandoned', 'cancelled', 'forfeited'].includes(match.status)) {
    res.status(409).json({ error: `Match already finished (status: ${match.status})` });
    return;
  }

  const parsed = abandonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('matches')
      .set({
        status: 'abandoned',
        result: 'abandoned',
        result_note: parsed.data.reason,
        updated_at: new Date(),
      })
      .where('id', '=', match.id)
      .execute();

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'match',
      entityId: match.id,
      action: 'abandon',
      afterState: { reason: parsed.data.reason },
      reason: parsed.data.reason,
    });
  });

  // Same derived-table refresh as a normal completion: an abandoned match
  // still counts for no-result points (see standingsService.ts), and any
  // runs/wickets that happened before the interruption are still real
  // cricket that occurred.
  if (match.group_id) {
    await recomputeGroupStandings(match.group_id);
  }
  const matchPlayers = await db.selectFrom('match_players').select('player_id').where('match_id', '=', match.id).execute();
  if (matchPlayers.length) {
    await recomputePlayerCareerStats(matchPlayers.map((p) => p.player_id));
  }

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /matches/:id/scorecard
// ---------------------------------------------------------------------------

router.get('/matches/:id/scorecard', async (req, res) => {
  const scorecard = await getMatchScorecard(param(req.params.id));
  if (!scorecard) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }
  res.json(scorecard);
});

// ---------------------------------------------------------------------------
// PATCH /tournaments/:slug/rules
// ---------------------------------------------------------------------------

/** requireTournamentRole reads req.params.tournamentId; our route is keyed by :slug. */
async function resolveTournamentBySlug(req: Parameters<typeof requireAuth>[0], res: Parameters<typeof requireAuth>[1], next: Parameters<typeof requireAuth>[2]) {
  const tournament = await db.selectFrom('tournaments').select('id').where('slug', '=', param(req.params.slug)).executeTakeFirst();
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }
  req.params.tournamentId = tournament.id;
  next();
}

const rulesSchema = z
  .object({
    overs_per_innings: z.number().int().min(1).max(50),
    balls_per_over: z.number().int().min(1),
    max_overs_per_bowler: z.number().int().min(1),
    powerplay_overs: z.number().int().min(0),
    players_per_side: z.number().int().min(2),
    wide_runs: z.number().int().min(0),
    noball_runs: z.number().int().min(0),
    free_hit_after_noball: z.boolean(),
    points_win: z.number().int().min(0),
    points_tie: z.number().int().min(0),
    points_no_result: z.number().int().min(0),
    points_loss: z.number().int().min(0),
    bonus_point_enabled: z.boolean(),
    super_over_on_tie: z.boolean(),
    dls_enabled: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });

router.patch(
  '/tournaments/:slug/rules',
  requireAuth,
  resolveTournamentBySlug,
  requireTournamentRole('organizer'),
  async (req, res) => {
    const tournamentId = req.params.tournamentId as string;

    const parsed = rulesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
      return;
    }

    // Rules aren't snapshotted per match -- every request re-reads them
    // live. Changing bowler quota, overs, etc. out from under a match that
    // is currently being scored would silently corrupt its validation, so
    // rule edits are blocked while any match in the tournament is in
    // progress.
    const liveMatch = await db
      .selectFrom('matches')
      .select('id')
      .where('tournament_id', '=', tournamentId)
      .where('status', 'in', ['toss_done', 'live', 'innings_break'])
      .executeTakeFirst();
    if (liveMatch) {
      res.status(409).json({ error: 'Cannot change rules while a match in this tournament is in progress' });
      return;
    }

    if (Object.prototype.hasOwnProperty.call(parsed.data, 'max_overs_per_bowler') || Object.prototype.hasOwnProperty.call(parsed.data, 'overs_per_innings')) {
      const current = await db.selectFrom('tournament_rules').selectAll().where('tournament_id', '=', tournamentId).executeTakeFirstOrThrow();
      const nextOvers = parsed.data.overs_per_innings ?? current.overs_per_innings;
      const nextQuota = parsed.data.max_overs_per_bowler ?? current.max_overs_per_bowler;
      if (nextQuota > nextOvers) {
        res.status(400).json({ error: 'max_overs_per_bowler cannot exceed overs_per_innings' });
        return;
      }
    }

    const updated = await db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('tournament_rules')
        .set(parsed.data)
        .where('tournament_id', '=', tournamentId)
        .returningAll()
        .executeTakeFirst();
      if (!row) return null;

      await writeAuditLog(trx, {
        actorUserId: req.user!.sub,
        entityType: 'tournament',
        entityId: tournamentId,
        action: 'update_rules',
        afterState: parsed.data,
      });
      return row;
    });

    if (!updated) {
      res.status(404).json({ error: 'This tournament has no rules row yet' });
      return;
    }

    res.json({ rules: updated });
  },
);

export default router;
