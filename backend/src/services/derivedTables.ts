import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { Scorecard } from '../domain/scoring';

/**
 * Replaces every derived row for one innings with what the scorecard fold
 * says right now. Full replace, not incremental — that's what makes it
 * trivially true that these tables are rebuildable from deliveries alone.
 */
export async function applyScorecardToDerivedTables(trx: Kysely<DB>, inningsId: string, scorecard: Scorecard): Promise<void> {
  await trx
    .insertInto('innings_totals')
    .values({
      innings_id: inningsId,
      runs: scorecard.runs,
      wickets: scorecard.wickets,
      legal_balls: scorecard.legalBalls,
      extras: scorecard.extras,
    })
    .onConflict((oc) =>
      oc.column('innings_id').doUpdateSet({
        runs: scorecard.runs,
        wickets: scorecard.wickets,
        legal_balls: scorecard.legalBalls,
        extras: scorecard.extras,
        updated_at: new Date(),
      }),
    )
    .execute();

  await trx.deleteFrom('batting_cards').where('innings_id', '=', inningsId).execute();
  if (scorecard.battingCards.length) {
    await trx
      .insertInto('batting_cards')
      .values(
        scorecard.battingCards.map((b) => ({
          innings_id: inningsId,
          player_id: b.playerId,
          runs: b.runs,
          balls_faced: b.ballsFaced,
          fours: b.fours,
          sixes: b.sixes,
          is_out: b.isOut,
          position: b.position,
        })),
      )
      .execute();
  }

  await trx.deleteFrom('bowling_cards').where('innings_id', '=', inningsId).execute();
  if (scorecard.bowlingCards.length) {
    await trx
      .insertInto('bowling_cards')
      .values(
        scorecard.bowlingCards.map((b) => ({
          innings_id: inningsId,
          player_id: b.playerId,
          legal_balls: b.legalBalls,
          runs_conceded: b.runsConceded,
          wickets: b.wickets,
          maidens: b.maidens,
          wides: b.wides,
          noballs: b.noballs,
          dots: b.dots,
        })),
      )
      .execute();
  }

  await trx.deleteFrom('partnerships').where('innings_id', '=', inningsId).execute();
  if (scorecard.partnerships.length) {
    await trx
      .insertInto('partnerships')
      .values(
        scorecard.partnerships.map((p) => ({
          innings_id: inningsId,
          wicket_number: p.wicketNumber,
          player_a_id: p.playerAId,
          player_b_id: p.playerBId,
          runs: p.runs,
          balls: p.balls,
        })),
      )
      .execute();
  }
}
