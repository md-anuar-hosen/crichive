import type { TournamentRules } from './types';

export interface CompletedInningsTotals {
  runs: number;
  wickets: number;
}

export type MatchOutcome =
  | { kind: 'batting_first_won'; marginRuns: number }
  | { kind: 'chasing_side_won'; marginWickets: number }
  | { kind: 'tie'; superOverNeeded: boolean };

/**
 * Compares two completed innings (the second must already be over — all out,
 * overs exhausted, or its target reached) and decides the match outcome.
 */
export function resolveMatchResult(firstInnings: CompletedInningsTotals, secondInnings: CompletedInningsTotals, rules: TournamentRules): MatchOutcome {
  if (secondInnings.runs > firstInnings.runs) {
    return { kind: 'chasing_side_won', marginWickets: rules.playersPerSide - 1 - secondInnings.wickets };
  }
  if (secondInnings.runs === firstInnings.runs) {
    return { kind: 'tie', superOverNeeded: rules.superOverOnTie };
  }
  return { kind: 'batting_first_won', marginRuns: firstInnings.runs - secondInnings.runs };
}
