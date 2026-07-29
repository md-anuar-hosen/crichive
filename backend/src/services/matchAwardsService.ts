import { sql } from 'kysely';
import { db } from '../db/index';
import { selectBestPerformer } from '../domain/scoring';
import type { PlayerPerformance } from '../domain/scoring';

/**
 * Auto-picks Player of the Match from batting/bowling/fielding across every
 * non-super-over innings of this match, using the same performance-score
 * heuristic as Player of the Tournament (see domain/scoring/matchAwards.ts —
 * this is CricHive's own scoring, not an attempt to replicate a human judge
 * panel). Writes matches.player_of_match_id and returns the chosen id, or
 * null if the match has no batting/bowling/fielding data at all.
 */
export async function computeAndSetPlayerOfMatch(matchId: string): Promise<string | null> {
  const [battingAgg, bowlingAgg, fieldingAgg] = await Promise.all([
    db
      .selectFrom('batting_cards')
      .innerJoin('innings', 'innings.id', 'batting_cards.innings_id')
      .select((eb) => [
        'batting_cards.player_id',
        eb.fn.coalesce(eb.fn.sum<string>('batting_cards.runs'), sql<string>`0`).as('runs'),
        eb.fn.coalesce(eb.fn.sum<string>('batting_cards.fours'), sql<string>`0`).as('fours'),
        eb.fn.coalesce(eb.fn.sum<string>('batting_cards.sixes'), sql<string>`0`).as('sixes'),
      ])
      .where('innings.match_id', '=', matchId)
      .where('innings.is_super_over', '=', false)
      .groupBy('batting_cards.player_id')
      .execute(),
    db
      .selectFrom('bowling_cards')
      .innerJoin('innings', 'innings.id', 'bowling_cards.innings_id')
      .select((eb) => [
        'bowling_cards.player_id',
        eb.fn.coalesce(eb.fn.sum<string>('bowling_cards.wickets'), sql<string>`0`).as('wickets'),
        eb.fn.coalesce(eb.fn.sum<string>('bowling_cards.maidens'), sql<string>`0`).as('maidens'),
      ])
      .where('innings.match_id', '=', matchId)
      .where('innings.is_super_over', '=', false)
      .groupBy('bowling_cards.player_id')
      .execute(),
    db
      .selectFrom('deliveries')
      .innerJoin('innings', 'innings.id', 'deliveries.innings_id')
      .select((eb) => [
        'deliveries.fielder_id as player_id',
        eb.fn.countAll<string>().filterWhere('deliveries.wicket_kind', '=', 'caught').as('catches'),
        eb.fn.countAll<string>().filterWhere('deliveries.wicket_kind', '=', 'stumped').as('stumpings'),
        eb.fn.countAll<string>().filterWhere('deliveries.wicket_kind', '=', 'run_out').as('run_outs'),
      ])
      .where('innings.match_id', '=', matchId)
      .where('innings.is_super_over', '=', false)
      .where('deliveries.voided_at', 'is', null)
      .where('deliveries.fielder_id', 'is not', null)
      .groupBy('deliveries.fielder_id')
      .execute(),
  ]);

  const performances = new Map<string, PlayerPerformance>();
  const ensure = (playerId: string): PlayerPerformance => {
    let p = performances.get(playerId);
    if (!p) {
      p = { playerId, runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, stumpings: 0, runOuts: 0 };
      performances.set(playerId, p);
    }
    return p;
  };

  for (const row of battingAgg) {
    const p = ensure(row.player_id);
    p.runs = Number(row.runs);
    p.fours = Number(row.fours);
    p.sixes = Number(row.sixes);
  }
  for (const row of bowlingAgg) {
    const p = ensure(row.player_id);
    p.wickets = Number(row.wickets);
    p.maidens = Number(row.maidens);
  }
  for (const row of fieldingAgg) {
    const p = ensure(row.player_id as string);
    p.catches = Number(row.catches);
    p.stumpings = Number(row.stumpings);
    p.runOuts = Number(row.run_outs);
  }

  const playerOfMatchId = selectBestPerformer([...performances.values()]);

  await db.updateTable('matches').set({ player_of_match_id: playerOfMatchId }).where('id', '=', matchId).execute();

  return playerOfMatchId;
}
