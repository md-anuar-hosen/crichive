import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index';
import { requireAuth, requireTournamentRole } from '../middleware/auth';
import { generateSingleEliminationBracket, roundName } from '../domain/bracket';
import { serializeTeam } from '../serializers/public';
import { writeAuditLog } from '../services/auditLog';

const router = Router();

function zodFieldErrors(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message }));
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
// POST /tournaments/:slug/knockout — organizer-only. Generates a full
// single-elimination bracket (with byes if the team count isn't a power of
// two) as a new 'knockout' stage.
// ---------------------------------------------------------------------------

const createBracketSchema = z.object({
  name: z.string().trim().min(1).optional(),
  team_ids: z.array(z.string().uuid()).min(2),
});

router.post('/tournaments/:slug/knockout', requireAuth, resolveTournamentBySlug, requireTournamentRole('organizer'), async (req, res) => {
  const parsed = createBracketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const tournamentId = req.params.tournamentId as string;
  const { team_ids, name } = parsed.data;

  if (new Set(team_ids).size !== team_ids.length) {
    res.status(400).json({ error: 'team_ids must not contain duplicates' });
    return;
  }

  const memberRows = await db.selectFrom('tournament_teams').select('team_id').where('tournament_id', '=', tournamentId).where('team_id', 'in', team_ids).execute();
  if (memberRows.length !== team_ids.length) {
    res.status(400).json({ error: 'All team_ids must already be part of this tournament' });
    return;
  }

  let slots;
  try {
    slots = generateSingleEliminationBracket(team_ids);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not build a bracket for that team list' });
    return;
  }

  const totalRounds = Math.max(...slots.map((s) => s.round));
  const tempToReal = new Map(slots.map((s) => [s.tempId, randomUUID()]));
  const orderedByRound = [...slots].sort((a, b) => a.round - b.round);

  const result = await db.transaction().execute(async (trx) => {
    const maxSequence = await trx
      .selectFrom('stages')
      .select((eb) => eb.fn.max('sequence').as('m'))
      .where('tournament_id', '=', tournamentId)
      .executeTakeFirst();
    const stageId = randomUUID();
    await trx
      .insertInto('stages')
      .values({ id: stageId, tournament_id: tournamentId, kind: 'knockout', name: name ?? 'Knockout Stage', sequence: (maxSequence?.m ?? 0) + 1 })
      .execute();

    const maxMatchNumber = await trx
      .selectFrom('matches')
      .select((eb) => eb.fn.max('match_number').as('m'))
      .where('tournament_id', '=', tournamentId)
      .executeTakeFirst();
    let nextMatchNumber = (maxMatchNumber?.m ?? 0) + 1;

    await trx
      .insertInto('matches')
      .values(
        orderedByRound.map((slot) => ({
          id: tempToReal.get(slot.tempId)!,
          tournament_id: tournamentId,
          stage_id: stageId,
          match_number: nextMatchNumber++,
          team_a_id: slot.teamAId,
          team_b_id: slot.teamBId,
          bracket_round: slot.round,
          bracket_seed_a: slot.seedA,
          bracket_seed_b: slot.seedB,
          next_match_slot: slot.nextSlot,
        })),
      )
      .execute();

    // next_match_id is set as a follow-up pass, not in the initial insert —
    // a round-1 row's next_match_id points at a round-2 id that doesn't
    // exist yet within the same bulk insert statement.
    for (const slot of slots) {
      if (slot.nextTempId) {
        await trx
          .updateTable('matches')
          .set({ next_match_id: tempToReal.get(slot.nextTempId)! })
          .where('id', '=', tempToReal.get(slot.tempId)!)
          .execute();
      }
    }

    await writeAuditLog(trx, {
      actorUserId: req.user!.sub,
      entityType: 'stage',
      entityId: stageId,
      action: 'create_knockout_bracket',
      afterState: { team_count: team_ids.length, match_count: slots.length, rounds: totalRounds },
    });

    return { stageId, matchCount: slots.length };
  });

  res.status(201).json({ stage_id: result.stageId, match_count: result.matchCount, rounds: totalRounds });
});

// ---------------------------------------------------------------------------
// GET /tournaments/:slug/knockout — public. The most recent knockout stage,
// grouped by round, with TBD slots left as null teams (not innerJoin'd
// away — this is the one place in the API that deliberately shows a match
// before both its teams are decided).
// ---------------------------------------------------------------------------

router.get('/tournaments/:slug/knockout', async (req, res) => {
  const tournament = await db.selectFrom('tournaments').select('id').where('slug', '=', req.params.slug).executeTakeFirst();
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }

  const stage = await db
    .selectFrom('stages')
    .select(['id', 'name'])
    .where('tournament_id', '=', tournament.id)
    .where('kind', '=', 'knockout')
    .orderBy('sequence', 'desc')
    .executeTakeFirst();
  if (!stage) {
    res.json({ stage: null, rounds: [] });
    return;
  }

  const rows = await db
    .selectFrom('matches')
    .leftJoin('teams as team_a', 'team_a.id', 'matches.team_a_id')
    .leftJoin('teams as team_b', 'team_b.id', 'matches.team_b_id')
    .select([
      'matches.id',
      'matches.match_number',
      'matches.status',
      'matches.result',
      'matches.result_note',
      'matches.winner_team_id',
      'matches.bracket_round',
      'matches.bracket_seed_a',
      'matches.bracket_seed_b',
      'matches.next_match_id',
      'team_a.id as team_a_id',
      'team_a.name as team_a_name',
      'team_a.short_name as team_a_short_name',
      'team_a.logo_url as team_a_logo_url',
      'team_a.home_city as team_a_home_city',
      'team_b.id as team_b_id',
      'team_b.name as team_b_name',
      'team_b.short_name as team_b_short_name',
      'team_b.logo_url as team_b_logo_url',
      'team_b.home_city as team_b_home_city',
    ])
    .where('matches.stage_id', '=', stage.id)
    .orderBy('matches.bracket_round', 'asc')
    .orderBy('matches.match_number', 'asc')
    .execute();

  const totalRounds = rows.length ? Math.max(...rows.map((r) => r.bracket_round ?? 1)) : 0;

  const byRound = new Map<number, typeof rows>();
  for (const row of rows) {
    const round = row.bracket_round ?? 1;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push(row);
  }

  const rounds = [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, matches]) => ({
      round,
      name: roundName(round, totalRounds),
      matches: matches.map((m) => ({
        id: m.id,
        match_number: m.match_number,
        status: m.status,
        result: m.result,
        result_note: m.result_note,
        winner_team_id: m.winner_team_id,
        next_match_id: m.next_match_id,
        seed_a: m.bracket_seed_a,
        seed_b: m.bracket_seed_b,
        team_a: m.team_a_id ? serializeTeam({ id: m.team_a_id, name: m.team_a_name!, short_name: m.team_a_short_name, logo_url: m.team_a_logo_url, home_city: m.team_a_home_city }) : null,
        team_b: m.team_b_id ? serializeTeam({ id: m.team_b_id, name: m.team_b_name!, short_name: m.team_b_short_name, logo_url: m.team_b_logo_url, home_city: m.team_b_home_city }) : null,
      })),
    }));

  res.json({ stage: { id: stage.id, name: stage.name }, rounds });
});

export default router;
