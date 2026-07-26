import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { TournamentRules } from '../domain/scoring';

export async function loadTournamentRules(db: Kysely<DB>, tournamentId: string): Promise<TournamentRules> {
  const row = await db
    .selectFrom('tournament_rules')
    .selectAll()
    .where('tournament_id', '=', tournamentId)
    .executeTakeFirstOrThrow();

  return {
    oversPerInnings: row.overs_per_innings,
    ballsPerOver: row.balls_per_over,
    maxOversPerBowler: row.max_overs_per_bowler,
    powerplayOvers: row.powerplay_overs,
    playersPerSide: row.players_per_side,
    wideRuns: row.wide_runs,
    noballRuns: row.noball_runs,
    freeHitAfterNoball: row.free_hit_after_noball,
    pointsWin: row.points_win,
    pointsTie: row.points_tie,
    pointsNoResult: row.points_no_result,
    pointsLoss: row.points_loss,
    superOverOnTie: row.super_over_on_tie,
  };
}
