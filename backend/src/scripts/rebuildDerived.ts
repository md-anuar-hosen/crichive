import 'dotenv/config';
import type { Kysely } from 'kysely';
import { db } from '../db/index';
import type { DB } from '../db/types';
import { buildScorecard, type TournamentRules } from '../domain/scoring';
import { toDomainDelivery } from '../services/deliveryMapping';
import { applyScorecardToDerivedTables } from '../services/derivedTables';
import { loadTournamentRules } from '../services/rules';

/**
 * Wipes innings_totals/batting_cards/bowling_cards/partnerships and
 * recomputes every one of them from the deliveries log — the proof that the
 * log is the only source of truth. Runs inside the caller's transaction.
 */
export async function rebuildAllDerivedTables(trx: Kysely<DB>): Promise<{ inningsRebuilt: number; matches: number }> {
  await trx.deleteFrom('partnerships').execute();
  await trx.deleteFrom('bowling_cards').execute();
  await trx.deleteFrom('batting_cards').execute();
  await trx.deleteFrom('innings_totals').execute();

  const matches = await trx.selectFrom('matches').select(['id', 'tournament_id']).execute();
  const rulesByTournament = new Map<string, TournamentRules>();
  let inningsRebuilt = 0;

  for (const match of matches) {
    let rules = rulesByTournament.get(match.tournament_id);
    if (!rules) {
      rules = await loadTournamentRules(trx, match.tournament_id);
      rulesByTournament.set(match.tournament_id, rules);
    }

    const inningsRows = await trx
      .selectFrom('innings')
      .select(['id', 'innings_number'])
      .where('match_id', '=', match.id)
      .orderBy('innings_number', 'asc')
      .execute();

    let previousInningsRuns: number | undefined;

    for (const innings of inningsRows) {
      const deliveryRows = await trx
        .selectFrom('deliveries')
        .selectAll()
        .where('innings_id', '=', innings.id)
        .orderBy('sequence', 'asc')
        .execute();

      const deliveries = deliveryRows.map(toDomainDelivery).filter((d) => !d.voidedAt);
      const target = innings.innings_number > 1 && previousInningsRuns !== undefined ? previousInningsRuns + 1 : undefined;
      const scorecard = buildScorecard(deliveries, rules, { target });

      await applyScorecardToDerivedTables(trx, innings.id, scorecard);
      previousInningsRuns = scorecard.runs;
      inningsRebuilt += 1;
    }
  }

  return { inningsRebuilt, matches: matches.length };
}

async function run(): Promise<void> {
  const { inningsRebuilt, matches } = await db.transaction().execute((trx) => rebuildAllDerivedTables(trx));
  console.log(`Rebuilt derived tables for ${inningsRebuilt} innings across ${matches} match(es).`);
}

if (process.env.VITEST === undefined) {
  run()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.destroy();
    });
}
