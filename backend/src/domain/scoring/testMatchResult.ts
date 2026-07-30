import type { TournamentRules } from './types';

export interface TestInningsSummary {
  inningsNumber: number;
  battingTeamId: string;
  runs: number;
  wickets: number;
  declared: boolean;
}

/** Whether the side that led after the first two innings may enforce the follow-on. */
export function isFollowOnEligible(firstInnings: { runs: number }, secondInnings: { runs: number }, rules: TournamentRules): boolean {
  return rules.followOnEnabled && firstInnings.runs - secondInnings.runs >= rules.followOnMargin;
}

export type TestMatchOutcome =
  | { kind: 'innings_win'; winningTeamId: string; marginRuns: number }
  | { kind: 'runs_win'; winningTeamId: string; marginRuns: number }
  | { kind: 'wickets_win'; winningTeamId: string; marginWickets: number }
  | { kind: 'tie' };

export type TestMatchStatus = { decided: false } | { decided: true; outcome: TestMatchOutcome };

/**
 * Decides whether a Test match is over, from however many of its (up to 4)
 * innings have closed so far. Called after innings 3 closes (to catch an
 * innings win with no innings 4 needed) and after innings 4 closes/reaches
 * its target. No Super Over: a tie stands as a tie, per the Laws of Cricket
 * / ICC Test playing conditions.
 *
 * The most-recently-closed innings is always the one whose batting side is
 * "deciding" the match (either chasing a target set for it, or — under a
 * follow-on — batting for the second time immediately). Comparing its team's
 * aggregate to the other side's aggregate, plus how many innings each side
 * has used, is enough to classify the result without needing to know
 * separately whether a follow-on happened.
 */
export function resolveTestMatchResult(
  inningsSoFar: TestInningsSummary[],
  rules: TournamentRules,
  teamAId: string,
  teamBId: string,
): TestMatchStatus {
  if (inningsSoFar.length < 3) return { decided: false };

  const wicketsThatEndInnings = rules.playersPerSide - 1;
  const sorted = [...inningsSoFar].sort((a, b) => a.inningsNumber - b.inningsNumber);
  const last = sorted[sorted.length - 1];
  const secondToLast = sorted[sorted.length - 2];

  const inningsFor = (teamId: string) => sorted.filter((i) => i.battingTeamId === teamId);
  const totalFor = (teamId: string) => inningsFor(teamId).reduce((sum, i) => sum + i.runs, 0);

  const bothSidesBattedTwice = inningsFor(teamAId).length >= 2 && inningsFor(teamBId).length >= 2;

  if (bothSidesBattedTwice) {
    // Innings 4 (or its target being reached mid-innings) just closed —
    // final aggregate comparison, regardless of batting order.
    const teamARuns = totalFor(teamAId);
    const teamBRuns = totalFor(teamBId);
    if (teamARuns === teamBRuns) return { decided: true, outcome: { kind: 'tie' } };

    const winnerId = teamARuns > teamBRuns ? teamAId : teamBId;
    const marginRuns = Math.abs(teamARuns - teamBRuns);
    // The side that just finished batting (`last`) is the one that was
    // chasing — if it also won, it got there by reaching the target, so the
    // margin is expressed in wickets in hand rather than runs.
    if (winnerId === last.battingTeamId) {
      return {
        decided: true,
        outcome: { kind: 'wickets_win', winningTeamId: winnerId, marginWickets: wicketsThatEndInnings - last.wickets },
      };
    }
    return { decided: true, outcome: { kind: 'runs_win', winningTeamId: winnerId, marginRuns } };
  }

  // Neither side has batted twice yet — the only way the match can already
  // be over is a follow-on: the innings that just closed belongs to the same
  // team as the one before it (batting for the 2nd time in a row), and that
  // team's 2-innings aggregate still hasn't caught the other side's single
  // first-innings total.
  const isFollowOnInnings = secondToLast?.battingTeamId === last.battingTeamId;
  if (isFollowOnInnings) {
    const followOnTeamId = last.battingTeamId;
    const otherTeamId = followOnTeamId === teamAId ? teamBId : teamAId;
    const followOnTeamRuns = totalFor(followOnTeamId);
    const otherTeamRuns = totalFor(otherTeamId);
    if (followOnTeamRuns < otherTeamRuns) {
      return { decided: true, outcome: { kind: 'innings_win', winningTeamId: otherTeamId, marginRuns: otherTeamRuns - followOnTeamRuns } };
    }
  }

  return { decided: false };
}
