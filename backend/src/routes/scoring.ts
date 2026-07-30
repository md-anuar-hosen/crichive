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
import { computeRevisedTarget, resourceAvailablePercent } from '../domain/rainRule';
import type { RainInterruption } from '../domain/rainRule';
import { computeNextBallPosition, toDomainDelivery } from '../services/deliveryMapping';
import { applyScorecardToDerivedTables } from '../services/derivedTables';
import { getMatchScorecard } from '../services/matchScorecard';
import { loadTournamentRules } from '../services/rules';
import { recomputeGroupStandings } from '../services/standingsService';
import { recomputePlayerCareerStats } from '../services/careerStatsService';
import { computeAndSetPlayerOfMatch } from '../services/matchAwardsService';
import { broadcastDelivery, broadcastInterruption } from '../realtime/hub';
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
  if (match.team_a_id === null || match.team_b_id === null) {
    res.status(409).json({ error: 'Both teams for this match are not decided yet (this is a knockout slot waiting on an earlier result)' });
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
    .select(['player_id', 'approved_at'])
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

  // A team_manager's squad proposal isn't final until the organizer approves
  // it — an unapproved player can't be picked for a playing XI.
  const unapproved = squadRows.filter((r) => r.approved_at === null).map((r) => r.player_id);
  if (unapproved.length) {
    res.status(400).json({ error: 'Some players are not yet organiser-approved for this squad', player_ids: unapproved });
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
    extra_wides: z.number().int().min(0).max(20).default(0),
    extra_noballs: z.number().int().min(0).max(20).default(0),
    extra_byes: z.number().int().min(0).max(20).default(0),
    extra_legbyes: z.number().int().min(0).max(20).default(0),
    extra_penalty: z.number().int().min(0).max(20).default(0),
    wicket_kind: z.enum(DISMISSAL_KINDS).optional(),
    player_out_id: z.string().uuid().optional(),
    fielder_id: z.string().uuid().optional(),
    commentary: z.string().trim().max(500).optional(),
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
  })
  .refine((body) => !(body.extra_wides > 0 && body.extra_noballs > 0), {
    message: 'A delivery cannot be both a wide and a no-ball',
    path: ['extra_noballs'],
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

  // A chase's target is the first innings of its pair's final total + 1 —
  // innings 2 chases innings 1, innings 4 (super over) chases innings 3.
  // Innings 1 and 3 are each the first of their own pair and never chase.
  let target: number | undefined;
  if (body.innings_number === 2 || body.innings_number === 4) {
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

const voidSchema = z.object({ reason: z.string().trim().min(1).max(500) });

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

  // Closing the first of a pair of super-over innings (number 3) works the
  // same way as closing innings 1: create its partner (number 4) with the
  // batting order swapped and a target set, don't decide the match yet.
  if (inningsNumber === 3) {
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('innings').set({ closed_at: new Date() }).where('id', '=', innings.id).execute();

      const superOver1Totals = await trx
        .selectFrom('innings_totals')
        .select('runs')
        .where('innings_id', '=', innings.id)
        .executeTakeFirst();

      await trx
        .insertInto('innings')
        .values({
          id: randomUUID(),
          match_id: match.id,
          innings_number: 4,
          batting_team_id: innings.bowling_team_id,
          bowling_team_id: innings.batting_team_id,
          is_super_over: true,
          max_overs: 1,
          target: (superOver1Totals?.runs ?? 0) + 1,
        })
        .execute();

      await trx.updateTable('matches').set({ status: 'super_over', updated_at: new Date() }).where('id', '=', match.id).execute();

      await writeAuditLog(trx, {
        actorUserId: req.user!.sub,
        entityType: 'match',
        entityId: match.id,
        action: 'close_innings',
        afterState: { innings_number: 3, next_innings_number: 4 },
      });
    });

    res.json({ ok: true, next_innings_number: 4 });
    return;
  }

  // inningsNumber is 2 (deciding the main match) or 4 (deciding a super
  // over) — compare it against the first innings of its own pair, not
  // always innings 1, so a super over is judged on its own two innings.
  const firstOfPairNumber = inningsNumber === 4 ? 3 : 1;
  const isSuperOverDecider = inningsNumber === 4;

  // innings_totals only gets a row once the innings' first delivery is
  // scored (applyScorecardToDerivedTables) — an innings closed with zero
  // balls bowled (e.g. rained out before it started) has none yet, and
  // that's a legitimate 0/0, not a missing-row error.
  const [firstRow, secondRow] = await Promise.all([
    db
      .selectFrom('innings')
      .leftJoin('innings_totals', 'innings_totals.innings_id', 'innings.id')
      .select(['innings_totals.runs', 'innings_totals.wickets'])
      .where('innings.match_id', '=', match.id)
      .where('innings.innings_number', '=', firstOfPairNumber)
      .executeTakeFirst(),
    db
      .selectFrom('innings')
      .leftJoin('innings_totals', 'innings_totals.innings_id', 'innings.id')
      .select(['innings_totals.runs', 'innings_totals.wickets'])
      .where('innings.match_id', '=', match.id)
      .where('innings.innings_number', '=', inningsNumber)
      .executeTakeFirst(),
  ]);
  const firstTotals = { runs: firstRow?.runs ?? 0, wickets: firstRow?.wickets ?? 0 };
  const secondTotals = { runs: secondRow?.runs ?? 0, wickets: secondRow?.wickets ?? 0 };

  const outcome = resolveMatchResult(firstTotals, secondTotals, rules);

  // A tie needs an actual super over only if the rules call for one AND
  // this isn't already the super over deciding its own tie — we don't
  // chain further super overs on a tied super over (see matchResult.ts /
  // CLAUDE.md: keep the simplification explicit rather than guessing at
  // repeat-super-over ordering rules).
  if (outcome.kind === 'tie' && outcome.superOverNeeded && !isSuperOverDecider) {
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('innings').set({ closed_at: new Date() }).where('id', '=', innings.id).execute();

      const pairFirst = await trx
        .selectFrom('innings')
        .select(['batting_team_id', 'bowling_team_id'])
        .where('match_id', '=', match.id)
        .where('innings_number', '=', firstOfPairNumber)
        .executeTakeFirstOrThrow();

      // The side that bowled second in the match just finished (i.e. batted
      // first) bats first in the Super Over — same order as this match's
      // second innings, which is the mirror of its first.
      await trx
        .insertInto('innings')
        .values({
          id: randomUUID(),
          match_id: match.id,
          innings_number: 3,
          batting_team_id: pairFirst.bowling_team_id,
          bowling_team_id: pairFirst.batting_team_id,
          is_super_over: true,
          max_overs: 1,
          target: null,
        })
        .execute();

      await trx.updateTable('matches').set({ status: 'super_over', updated_at: new Date() }).where('id', '=', match.id).execute();

      await writeAuditLog(trx, {
        actorUserId: req.user!.sub,
        entityType: 'match',
        entityId: match.id,
        action: 'tie_start_super_over',
        afterState: { innings_number: inningsNumber, next_innings_number: 3 },
      });
    });

    res.json({ ok: true, super_over: true, next_innings_number: 3 });
    return;
  }

  const superOverSuffix = isSuperOverDecider ? ' (Super Over)' : '';

  await db.transaction().execute(async (trx) => {
    await trx.updateTable('innings').set({ closed_at: new Date() }).where('id', '=', innings.id).execute();

    const pairFirst = await trx
      .selectFrom('innings')
      .select(['batting_team_id', 'bowling_team_id'])
      .where('match_id', '=', match.id)
      .where('innings_number', '=', firstOfPairNumber)
      .executeTakeFirstOrThrow();

    let winnerTeamId: string | null = null;

    if (outcome.kind === 'tie') {
      await trx
        .updateTable('matches')
        .set({
          result: 'tie',
          status: 'completed',
          result_note: isSuperOverDecider ? 'Tied — Super Over also tied' : 'Tied',
          updated_at: new Date(),
        })
        .where('id', '=', match.id)
        .execute();
    } else if (outcome.kind === 'batting_first_won') {
      winnerTeamId = pairFirst.batting_team_id;
      await trx
        .updateTable('matches')
        .set({
          result: pairFirst.batting_team_id === match.team_a_id ? 'team_a_won' : 'team_b_won',
          winner_team_id: pairFirst.batting_team_id,
          win_margin_runs: outcome.marginRuns,
          result_note: `Won by ${outcome.marginRuns} run(s)${superOverSuffix}`,
          status: 'completed',
          updated_at: new Date(),
        })
        .where('id', '=', match.id)
        .execute();
    } else {
      winnerTeamId = pairFirst.bowling_team_id;
      await trx
        .updateTable('matches')
        .set({
          result: pairFirst.bowling_team_id === match.team_a_id ? 'team_a_won' : 'team_b_won',
          winner_team_id: pairFirst.bowling_team_id,
          win_margin_wickets: outcome.marginWickets,
          result_note: `Won by ${outcome.marginWickets} wicket(s)${superOverSuffix}`,
          status: 'completed',
          updated_at: new Date(),
        })
        .where('id', '=', match.id)
        .execute();
    }

    // Bracket auto-advancement: a decisive knockout match's winner slots
    // straight into whichever match/slot it feeds. A tie has no winner to
    // advance — that's left for the organizer to resolve manually (rare:
    // only possible with the Super Over disabled, or a tied Super Over).
    if (winnerTeamId && match.next_match_id && match.next_match_slot) {
      await trx
        .updateTable('matches')
        .set(match.next_match_slot === 'team_a' ? { team_a_id: winnerTeamId, updated_at: new Date() } : { team_b_id: winnerTeamId, updated_at: new Date() })
        .where('id', '=', match.next_match_id)
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
  await computeAndSetPlayerOfMatch(match.id);

  res.json({ ok: true, outcome });
});

// ---------------------------------------------------------------------------
// POST /matches/:id/abandon
// ---------------------------------------------------------------------------

const abandonSchema = z.object({ reason: z.string().trim().min(1).max(500) });

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
// POST /matches/:id/cancel — before a ball is ever bowled (ground unavailable,
// a team withdraws, etc.). Distinct from /abandon: a cancelled match never
// started, carries no result, and correctly never appears in standings
// (standingsService only looks at 'completed'/'abandoned' matches).
// ---------------------------------------------------------------------------

const cancelSchema = z.object({ reason: z.string().trim().min(1).max(500) });

router.post('/matches/:id/cancel', requireAuth, requireMatchRole('organizer', 'scorer'), async (req, res) => {
  const match = await loadMatch(param(req.params.id));
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }
  if (match.status !== 'scheduled') {
    res.status(409).json({ error: `Only a match that hasn't had its toss yet can be cancelled (status: ${match.status})` });
    return;
  }

  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('matches')
      .set({ status: 'cancelled', result_note: parsed.data.reason, updated_at: new Date() })
      .where('id', '=', match.id)
      .execute();

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'match',
      entityId: match.id,
      action: 'cancel',
      afterState: { reason: parsed.data.reason },
      reason: parsed.data.reason,
    });
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /matches/:id/forfeit — a team fails to show up / concedes. Unlike
// abandon (no result) this is a decisive result: the other team gets the
// win and the points that come with it, same as winning on the field.
// ---------------------------------------------------------------------------

const forfeitSchema = z.object({ winner_team_id: z.string().uuid(), reason: z.string().trim().max(500).optional() });

router.post('/matches/:id/forfeit', requireAuth, requireMatchRole('organizer', 'scorer'), async (req, res) => {
  const match = await loadMatch(param(req.params.id));
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }
  if (['completed', 'abandoned', 'cancelled', 'forfeited'].includes(match.status)) {
    res.status(409).json({ error: `Match already finished (status: ${match.status})` });
    return;
  }

  const parsed = forfeitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  if (parsed.data.winner_team_id !== match.team_a_id && parsed.data.winner_team_id !== match.team_b_id) {
    res.status(400).json({ error: 'winner_team_id must be one of the two teams playing this match' });
    return;
  }

  const result = parsed.data.winner_team_id === match.team_a_id ? 'team_a_won' : 'team_b_won';

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('matches')
      .set({
        status: 'forfeited',
        result,
        winner_team_id: parsed.data.winner_team_id,
        result_note: parsed.data.reason ? `Won by forfeit — ${parsed.data.reason}` : 'Won by forfeit',
        updated_at: new Date(),
      })
      .where('id', '=', match.id)
      .execute();

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'match',
      entityId: match.id,
      action: 'forfeit',
      afterState: { winner_team_id: parsed.data.winner_team_id, reason: parsed.data.reason },
      reason: parsed.data.reason,
    });
  });

  // A forfeit is a decisive result — standings must reflect it just like
  // any other completed match. Career stats only if a playing XI existed
  // (a forfeit can happen before either XI is even set).
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
// POST /matches/:id/innings/:n/interruption  (CricHive Rain Rule — Phase E)
//
// Records a rain/weather stoppage for the innings currently being bowled
// and, from innings 2 onward, recomputes the revised target. This is our
// own resource-based method, not the licensed DLS — see
// backend/src/domain/rainRule for the disclaimer.
// ---------------------------------------------------------------------------

function toRainInterruption(row: { overs_remaining_before: string; overs_remaining_after: string; wickets_lost_at: number }): RainInterruption {
  return {
    oversRemainingBefore: Number(row.overs_remaining_before),
    oversRemainingAfter: Number(row.overs_remaining_after),
    wicketsLostAt: row.wickets_lost_at,
  };
}

const interruptionSchema = z.object({
  overs_remaining_after: z.number().min(0),
  reason: z.string().trim().max(500).optional(),
});

router.post('/matches/:id/innings/:n/interruption', requireAuth, requireMatchRole('organizer', 'scorer'), async (req, res) => {
  const match = await loadMatch(param(req.params.id));
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }
  if (!['toss_done', 'live', 'innings_break'].includes(match.status)) {
    res.status(409).json({ error: `Match is not in progress (status: ${match.status})` });
    return;
  }

  const rules = await loadTournamentRules(db, match.tournament_id);
  if (!rules.dlsEnabled) {
    res.status(409).json({ error: 'CricHive Rain Rule is not enabled for this tournament' });
    return;
  }

  const inningsNumber = Number(param(req.params.n));
  if (!Number.isInteger(inningsNumber) || inningsNumber < 1) {
    res.status(400).json({ error: 'Invalid innings number' });
    return;
  }

  const parsed = interruptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }

  const innings = await db
    .selectFrom('innings')
    .selectAll()
    .where('match_id', '=', match.id)
    .where('innings_number', '=', inningsNumber)
    .executeTakeFirst();
  if (!innings) {
    res.status(404).json({ error: `Innings ${inningsNumber} not found for this match` });
    return;
  }
  if (innings.closed_at) {
    res.status(422).json({ error: 'This innings is already closed' });
    return;
  }
  if (innings.max_overs == null) {
    res.status(422).json({ error: 'This innings has no overs quota set yet' });
    return;
  }
  if (innings.is_super_over) {
    res.status(422).json({ error: 'The CricHive Rain Rule does not apply to a Super Over' });
    return;
  }

  const totals = await db.selectFrom('innings_totals').selectAll().where('innings_id', '=', innings.id).executeTakeFirst();
  const legalBalls = totals?.legal_balls ?? 0;
  const wicketsLostAt = totals?.wickets ?? 0;

  const maxOvers = Number(innings.max_overs);
  const oversRemainingBefore = maxOvers - legalBalls / rules.ballsPerOver;
  const oversRemainingAfter = parsed.data.overs_remaining_after;

  if (oversRemainingAfter > oversRemainingBefore) {
    res.status(400).json({ error: `overs_remaining_after cannot exceed the ${oversRemainingBefore.toFixed(1)} overs currently remaining` });
    return;
  }

  const newMaxOvers = legalBalls / rules.ballsPerOver + oversRemainingAfter;
  // Both innings are measured against the match's nominal (pre-interruption) overs
  // quota, so a stoppage in one innings is judged on the same scale as the other.
  const nominalOvers = match.overs_override ?? rules.oversPerInnings;

  const result = await db.transaction().execute(async (trx) => {
    const interruption = await trx
      .insertInto('match_interruptions')
      .values({
        innings_id: innings.id,
        overs_remaining_before: oversRemainingBefore,
        overs_remaining_after: oversRemainingAfter,
        wickets_lost_at: wicketsLostAt,
        reason: parsed.data.reason ?? null,
        recorded_by: req.user!.sub,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx.updateTable('innings').set({ max_overs: newMaxOvers }).where('id', '=', innings.id).execute();

    let revisedTarget: number | null = null;
    if (inningsNumber > 1) {
      const firstInnings = await trx
        .selectFrom('innings')
        .selectAll()
        .where('match_id', '=', match.id)
        .where('innings_number', '=', inningsNumber - 1)
        .executeTakeFirstOrThrow();
      const firstInningsTotals = await trx.selectFrom('innings_totals').selectAll().where('innings_id', '=', firstInnings.id).executeTakeFirst();
      const firstInterruptionRows = await trx.selectFrom('match_interruptions').selectAll().where('innings_id', '=', firstInnings.id).execute();
      const secondInterruptionRows = await trx.selectFrom('match_interruptions').selectAll().where('innings_id', '=', innings.id).execute();

      const firstResource = resourceAvailablePercent(firstInterruptionRows.map(toRainInterruption), nominalOvers);
      const secondResource = resourceAvailablePercent(secondInterruptionRows.map(toRainInterruption), nominalOvers);

      revisedTarget = computeRevisedTarget({
        firstInningsRuns: firstInningsTotals?.runs ?? 0,
        firstInningsResourcePercent: firstResource,
        secondInningsResourcePercent: secondResource,
      });

      await trx.updateTable('innings').set({ target: revisedTarget }).where('id', '=', innings.id).execute();
    }

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'match',
      entityId: match.id,
      action: 'rain_interruption',
      afterState: { innings_number: inningsNumber, interruption, new_max_overs: newMaxOvers, revised_target: revisedTarget },
      reason: parsed.data.reason,
    });

    return { interruption, revisedTarget };
  });

  broadcastInterruption({
    type: 'interruption',
    matchId: match.id,
    inningsId: innings.id,
    inningsNumber,
    maxOvers: newMaxOvers,
    revisedTarget: result.revisedTarget,
    interruption: result.interruption,
  });

  res.status(201).json({ interruption: result.interruption, max_overs: newMaxOvers, revised_target: result.revisedTarget });
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

// ---------------------------------------------------------------------------
// POST /tournaments/:slug/matches — organizer-only. Schedules a single
// fixture. This is the only way a match gets created outside of the
// dev-only seed script and the knockout bracket generator — there was no
// route for it at all until now, meaning no real organizer could ever
// schedule a group-stage/round-robin match, or even a single one-off
// friendly, through the app. group_id/ground_id/scheduled_start are all
// optional — a match doesn't need to belong to a group (matches.group_id
// is nullable, same as a bracket match) to be scored.
// ---------------------------------------------------------------------------

const createMatchSchema = z.object({
  team_a_id: z.string().uuid(),
  team_b_id: z.string().uuid(),
  group_id: z.string().uuid().optional(),
  ground_id: z.string().uuid().optional(),
  scheduled_start: z.string().datetime().optional(),
});

router.post('/tournaments/:slug/matches', requireAuth, resolveTournamentBySlug, requireTournamentRole('organizer'), async (req, res) => {
  const parsed = createMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const tournamentId = req.params.tournamentId as string;
  const data = parsed.data;

  if (data.team_a_id === data.team_b_id) {
    res.status(400).json({ error: 'team_a_id and team_b_id must differ' });
    return;
  }

  const teamRows = await db.selectFrom('tournament_teams').select('team_id').where('tournament_id', '=', tournamentId).where('team_id', 'in', [data.team_a_id, data.team_b_id]).execute();
  if (teamRows.length !== 2) {
    res.status(400).json({ error: 'Both teams must already be part of this tournament' });
    return;
  }

  if (data.group_id) {
    const group = await db
      .selectFrom('groups')
      .innerJoin('stages', 'stages.id', 'groups.stage_id')
      .select('groups.id')
      .where('groups.id', '=', data.group_id)
      .where('stages.tournament_id', '=', tournamentId)
      .executeTakeFirst();
    if (!group) {
      res.status(400).json({ error: 'group_id does not belong to this tournament' });
      return;
    }
  }

  if (data.ground_id) {
    const ground = await db.selectFrom('grounds').select('id').where('id', '=', data.ground_id).executeTakeFirst();
    if (!ground) {
      res.status(400).json({ error: 'Ground not found' });
      return;
    }
  }

  const match = await db.transaction().execute(async (trx) => {
    const maxMatchNumber = await trx
      .selectFrom('matches')
      .select((eb) => eb.fn.max('match_number').as('m'))
      .where('tournament_id', '=', tournamentId)
      .executeTakeFirst();

    const group = data.group_id ? await trx.selectFrom('groups').select('stage_id').where('id', '=', data.group_id).executeTakeFirst() : undefined;

    const inserted = await trx
      .insertInto('matches')
      .values({
        id: randomUUID(),
        tournament_id: tournamentId,
        stage_id: group?.stage_id ?? null,
        group_id: data.group_id ?? null,
        ground_id: data.ground_id ?? null,
        scheduled_start: data.scheduled_start ? new Date(data.scheduled_start) : null,
        match_number: (maxMatchNumber?.m ?? 0) + 1,
        team_a_id: data.team_a_id,
        team_b_id: data.team_b_id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'match',
      entityId: inserted.id,
      action: 'schedule',
      afterState: { team_a_id: data.team_a_id, team_b_id: data.team_b_id, group_id: data.group_id ?? null, scheduled_start: data.scheduled_start ?? null },
    });

    return inserted;
  });

  res.status(201).json({ match_id: match.id, match_number: match.match_number });
});

export default router;
