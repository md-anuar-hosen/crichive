import type { MatchOutcomeForTeam, PointsRules } from './types';

export function computeMatchPoints(outcome: MatchOutcomeForTeam, rules: PointsRules): number {
  switch (outcome) {
    case 'win':
      return rules.pointsWin;
    case 'tie':
      return rules.pointsTie;
    case 'no_result':
      return rules.pointsNoResult;
    case 'loss':
      return rules.pointsLoss;
    case 'draw':
      return rules.pointsDraw;
  }
}
