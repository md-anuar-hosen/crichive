export type DismissalKind =
  | 'bowled'
  | 'caught'
  | 'lbw'
  | 'run_out'
  | 'stumped'
  | 'hit_wicket'
  | 'retired_hurt'
  | 'retired_out'
  | 'obstructing_the_field'
  | 'hit_ball_twice'
  | 'timed_out';

/** Dismissals credited to the bowler's wicket tally. */
export const BOWLER_CREDITED_DISMISSALS: ReadonlySet<DismissalKind> = new Set([
  'bowled',
  'caught',
  'lbw',
  'stumped',
  'hit_wicket',
]);

/** The only dismissals a batter can suffer while facing a free hit. */
export const DISMISSALS_ALLOWED_ON_FREE_HIT: ReadonlySet<DismissalKind> = new Set([
  'run_out',
  'obstructing_the_field',
  'hit_ball_twice',
]);

export interface Delivery {
  overNumber: number;
  ballInOver: number;
  sequence: number;
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  runsOffBat: number;
  extraWides: number;
  extraNoballs: number;
  extraByes: number;
  extraLegbyes: number;
  extraPenalty: number;
  isLegalDelivery: boolean;
  isFreeHit: boolean;
  wicketKind?: DismissalKind;
  playerOutId?: string;
  fielderId?: string;
  voidedAt?: Date;
}

export interface TournamentRules {
  oversPerInnings: number;
  ballsPerOver: number;
  maxOversPerBowler: number;
  powerplayOvers: number;
  playersPerSide: number;
  wideRuns: number;
  noballRuns: number;
  freeHitAfterNoball: boolean;
  pointsWin: number;
  pointsTie: number;
  pointsNoResult: number;
  pointsLoss: number;
  superOverOnTie: boolean;
  dlsEnabled: boolean;
}

export interface BattingLine {
  playerId: string;
  runs: number;
  ballsFaced: number;
  fours: number;
  sixes: number;
  isOut: boolean;
  dismissalKind?: DismissalKind;
  dismissedByBowlerId?: string;
  fielderId?: string;
  position: number;
}

export interface BowlingLine {
  playerId: string;
  legalBalls: number;
  runsConceded: number;
  wickets: number;
  maidens: number;
  wides: number;
  noballs: number;
}

export interface PartnershipLine {
  wicketNumber: number;
  playerAId: string;
  playerBId: string;
  runs: number;
  balls: number;
  isUnbeaten: boolean;
}

export interface OverSummary {
  overNumber: number;
  bowlerId: string;
  legalBalls: number;
  runsConceded: number;
  wickets: number;
  isMaiden: boolean;
}

export type InningsCompletionReason = 'overs_complete' | 'all_out' | 'target_reached';

export interface Scorecard {
  runs: number;
  wickets: number;
  legalBalls: number;
  extras: number;
  battingCards: BattingLine[];
  bowlingCards: BowlingLine[];
  partnerships: PartnershipLine[];
  overs: OverSummary[];
  isComplete: boolean;
  completionReason?: InningsCompletionReason;
}
