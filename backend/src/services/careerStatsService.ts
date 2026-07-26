import { sql } from 'kysely';
import { db } from '../db/index';

/**
 * Recomputes player_career_stats for the given players from batting_cards/
 * bowling_cards/deliveries — a full replace per player, excluding super-over
 * innings (they don't count toward career stats, same as they're excluded
 * from NRR).
 */
export async function recomputePlayerCareerStats(playerIds: string[]): Promise<void> {
  for (const playerId of playerIds) {
    const battingAgg = await db
      .selectFrom('batting_cards')
      .innerJoin('innings', 'innings.id', 'batting_cards.innings_id')
      .select((eb) => [
        eb.fn.countAll<string>().as('innings_batted'),
        eb.fn.coalesce(eb.fn.sum<string>('batting_cards.runs'), sql<string>`0`).as('runs'),
        eb.fn.coalesce(eb.fn.sum<string>('batting_cards.balls_faced'), sql<string>`0`).as('balls_faced'),
        eb.fn.coalesce(eb.fn.max<number>('batting_cards.runs'), sql<number>`0`).as('highest_score'),
        eb.fn.coalesce(eb.fn.sum<string>('batting_cards.fours'), sql<string>`0`).as('fours'),
        eb.fn.coalesce(eb.fn.sum<string>('batting_cards.sixes'), sql<string>`0`).as('sixes'),
        eb.fn.countAll<string>().filterWhere('batting_cards.is_out', '=', false).as('not_outs'),
        eb.fn
          .countAll<string>()
          .filterWhere((wb) => wb.and([wb('batting_cards.runs', '>=', 50), wb('batting_cards.runs', '<', 100)]))
          .as('fifties'),
        eb.fn.countAll<string>().filterWhere('batting_cards.runs', '>=', 100).as('hundreds'),
      ])
      .where('batting_cards.player_id', '=', playerId)
      .where('innings.is_super_over', '=', false)
      .executeTakeFirstOrThrow();

    const bowlingAgg = await db
      .selectFrom('bowling_cards')
      .innerJoin('innings', 'innings.id', 'bowling_cards.innings_id')
      .select((eb) => [
        eb.fn.countAll<string>().as('innings_bowled'),
        eb.fn.coalesce(eb.fn.sum<string>('bowling_cards.legal_balls'), sql<string>`0`).as('legal_balls_bowled'),
        eb.fn.coalesce(eb.fn.sum<string>('bowling_cards.runs_conceded'), sql<string>`0`).as('runs_conceded'),
        eb.fn.coalesce(eb.fn.sum<string>('bowling_cards.wickets'), sql<string>`0`).as('wickets'),
      ])
      .where('bowling_cards.player_id', '=', playerId)
      .where('innings.is_super_over', '=', false)
      .executeTakeFirstOrThrow();

    const bestBowling = await db
      .selectFrom('bowling_cards')
      .innerJoin('innings', 'innings.id', 'bowling_cards.innings_id')
      .select(['bowling_cards.wickets', 'bowling_cards.runs_conceded'])
      .where('bowling_cards.player_id', '=', playerId)
      .where('innings.is_super_over', '=', false)
      .orderBy('bowling_cards.wickets', 'desc')
      .orderBy('bowling_cards.runs_conceded', 'asc')
      .executeTakeFirst();

    const fieldingAgg = await db
      .selectFrom('deliveries')
      .innerJoin('innings', 'innings.id', 'deliveries.innings_id')
      .select((eb) => [
        eb.fn.countAll<string>().filterWhere('deliveries.wicket_kind', '=', 'caught').as('catches'),
        eb.fn.countAll<string>().filterWhere('deliveries.wicket_kind', '=', 'stumped').as('stumpings'),
        eb.fn.countAll<string>().filterWhere('deliveries.wicket_kind', '=', 'run_out').as('run_outs'),
      ])
      .where('deliveries.fielder_id', '=', playerId)
      .where('deliveries.voided_at', 'is', null)
      .where('innings.is_super_over', '=', false)
      .executeTakeFirstOrThrow();

    const [battedMatchIds, bowledMatchIds] = await Promise.all([
      db
        .selectFrom('innings')
        .innerJoin('batting_cards', 'batting_cards.innings_id', 'innings.id')
        .select('innings.match_id')
        .distinct()
        .where('batting_cards.player_id', '=', playerId)
        .where('innings.is_super_over', '=', false)
        .execute(),
      db
        .selectFrom('innings')
        .innerJoin('bowling_cards', 'bowling_cards.innings_id', 'innings.id')
        .select('innings.match_id')
        .distinct()
        .where('bowling_cards.player_id', '=', playerId)
        .where('innings.is_super_over', '=', false)
        .execute(),
    ]);
    // A player can appear in a match as bowler-only (e.g. tail-ender not needed to bat) or batter-only.
    const matches = new Set([...battedMatchIds.map((r) => r.match_id), ...bowledMatchIds.map((r) => r.match_id)]).size;

    await db
      .insertInto('player_career_stats')
      .values({
        player_id: playerId,
        matches,
        innings_batted: Number(battingAgg.innings_batted),
        runs: Number(battingAgg.runs),
        balls_faced: Number(battingAgg.balls_faced),
        highest_score: Number(battingAgg.highest_score),
        not_outs: Number(battingAgg.not_outs),
        fifties: Number(battingAgg.fifties),
        hundreds: Number(battingAgg.hundreds),
        fours: Number(battingAgg.fours),
        sixes: Number(battingAgg.sixes),
        innings_bowled: Number(bowlingAgg.innings_bowled),
        legal_balls_bowled: Number(bowlingAgg.legal_balls_bowled),
        runs_conceded: Number(bowlingAgg.runs_conceded),
        wickets: Number(bowlingAgg.wickets),
        best_bowling_wkts: bestBowling?.wickets ?? 0,
        best_bowling_runs: bestBowling?.runs_conceded ?? null,
        catches: Number(fieldingAgg.catches),
        stumpings: Number(fieldingAgg.stumpings),
        run_outs: Number(fieldingAgg.run_outs),
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column('player_id').doUpdateSet((eb) => ({
          matches: eb.ref('excluded.matches'),
          innings_batted: eb.ref('excluded.innings_batted'),
          runs: eb.ref('excluded.runs'),
          balls_faced: eb.ref('excluded.balls_faced'),
          highest_score: eb.ref('excluded.highest_score'),
          not_outs: eb.ref('excluded.not_outs'),
          fifties: eb.ref('excluded.fifties'),
          hundreds: eb.ref('excluded.hundreds'),
          fours: eb.ref('excluded.fours'),
          sixes: eb.ref('excluded.sixes'),
          innings_bowled: eb.ref('excluded.innings_bowled'),
          legal_balls_bowled: eb.ref('excluded.legal_balls_bowled'),
          runs_conceded: eb.ref('excluded.runs_conceded'),
          wickets: eb.ref('excluded.wickets'),
          best_bowling_wkts: eb.ref('excluded.best_bowling_wkts'),
          best_bowling_runs: eb.ref('excluded.best_bowling_runs'),
          catches: eb.ref('excluded.catches'),
          stumpings: eb.ref('excluded.stumpings'),
          run_outs: eb.ref('excluded.run_outs'),
          updated_at: eb.ref('excluded.updated_at'),
        })),
      )
      .execute();
  }
}
