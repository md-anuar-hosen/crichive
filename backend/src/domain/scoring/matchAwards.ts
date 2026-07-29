/**
 * A simple, transparent "impact score" used to auto-pick Player of the
 * Match / Player of the Tournament. Real cricket awards these by human
 * judge panel, not formula — this is CricHive's own heuristic, not an
 * attempt to replicate any official scoring system.
 */
export interface PlayerPerformance {
  playerId: string;
  runs: number;
  fours: number;
  sixes: number;
  wickets: number;
  maidens: number;
  catches: number;
  stumpings: number;
  runOuts: number;
}

const RUN_WEIGHT = 1;
const FOUR_WEIGHT = 1;
const SIX_WEIGHT = 2;
const WICKET_WEIGHT = 20;
const MAIDEN_WEIGHT = 10;
const CATCH_WEIGHT = 10;
const STUMPING_WEIGHT = 10;
const RUN_OUT_WEIGHT = 10;

export function computePerformanceScore(p: PlayerPerformance): number {
  return (
    p.runs * RUN_WEIGHT +
    p.fours * FOUR_WEIGHT +
    p.sixes * SIX_WEIGHT +
    p.wickets * WICKET_WEIGHT +
    p.maidens * MAIDEN_WEIGHT +
    p.catches * CATCH_WEIGHT +
    p.stumpings * STUMPING_WEIGHT +
    p.runOuts * RUN_OUT_WEIGHT
  );
}

/**
 * Highest performance score wins; ties break on runs, then wickets, then
 * playerId — deterministic, so the same inputs always pick the same player.
 */
export function selectBestPerformer(performances: readonly PlayerPerformance[]): string | null {
  if (!performances.length) return null;

  let best = performances[0];
  let bestScore = computePerformanceScore(best);

  for (const candidate of performances.slice(1)) {
    const score = computePerformanceScore(candidate);
    const better =
      score > bestScore ||
      (score === bestScore && candidate.runs > best.runs) ||
      (score === bestScore && candidate.runs === best.runs && candidate.wickets > best.wickets) ||
      (score === bestScore && candidate.runs === best.runs && candidate.wickets === best.wickets && candidate.playerId < best.playerId);
    if (better) {
      best = candidate;
      bestScore = score;
    }
  }

  return best.playerId;
}
