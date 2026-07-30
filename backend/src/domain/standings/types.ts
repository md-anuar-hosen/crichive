export type MatchOutcomeForTeam = 'win' | 'loss' | 'tie' | 'no_result' | 'draw';

export interface PointsRules {
  pointsWin: number;
  pointsTie: number;
  pointsNoResult: number;
  pointsLoss: number;
  pointsDraw: number;
}

/**
 * One team's side of one innings, already stripped of anything the caller
 * doesn't want counted (abandoned matches shouldn't even be passed in).
 */
export interface InningsNrrInput {
  battingTeamId: string;
  bowlingTeamId: string;
  runsScored: number;
  /** Legal balls actually delivered in this innings — never padded. */
  legalBallsBowled: number;
  /** True if the batting side lost all its wickets in this innings. */
  battingTeamAllOut: boolean;
  /** The full overs quota for this innings (tournament_rules, or the match's override). */
  oversAllotted: number;
  isSuperOver: boolean;
  isNoResult: boolean;
}

export interface StandingsRow {
  teamId: string;
  teamName: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  noResult: number;
  drawn: number;
  points: number;
  netRunRate: number;
}
