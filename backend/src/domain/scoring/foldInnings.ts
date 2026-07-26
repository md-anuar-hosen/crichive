import { BOWLER_CREDITED_DISMISSALS } from './types';
import type {
  BattingLine,
  BowlingLine,
  Delivery,
  OverSummary,
  PartnershipLine,
  Scorecard,
  TournamentRules,
} from './types';

export interface BuildScorecardOptions {
  /** Runs the batting side must exceed to win — set for a chase. The ball that reaches it ends the innings immediately. */
  target?: number;
}

/**
 * Folds an innings' deliveries into a scorecard. Pure: no DB, no I/O.
 * Voided deliveries are dropped first, per the append-only log invariant.
 */
export function buildScorecard(allDeliveries: Delivery[], rules: TournamentRules, options: BuildScorecardOptions = {}): Scorecard {
  const deliveries = allDeliveries
    .filter((d) => !d.voidedAt)
    .slice()
    .sort((a, b) => a.sequence - b.sequence);

  const battingCards = new Map<string, BattingLine>();
  const bowlingCards = new Map<string, BowlingLine>();
  const overMap = new Map<number, OverSummary>();
  const partnerships: PartnershipLine[] = [];

  let runs = 0;
  let wickets = 0;
  let legalBalls = 0;
  let extras = 0;
  let battingOrderCounter = 0;
  let isComplete = false;
  let completionReason: Scorecard['completionReason'];

  let currentPartnership: PartnershipLine | null = null;

  const wicketsThatEndInnings = rules.playersPerSide - 1;
  const maxLegalBalls = rules.oversPerInnings * rules.ballsPerOver;

  function ensureBatter(id: string): BattingLine {
    let line = battingCards.get(id);
    if (!line) {
      battingOrderCounter += 1;
      line = { playerId: id, runs: 0, ballsFaced: 0, fours: 0, sixes: 0, isOut: false, position: battingOrderCounter };
      battingCards.set(id, line);
    }
    return line;
  }

  function ensureBowler(id: string): BowlingLine {
    let line = bowlingCards.get(id);
    if (!line) {
      line = { playerId: id, legalBalls: 0, runsConceded: 0, wickets: 0, maidens: 0, wides: 0, noballs: 0 };
      bowlingCards.set(id, line);
    }
    return line;
  }

  for (const delivery of deliveries) {
    if (isComplete) break;

    ensureBatter(delivery.strikerId);
    ensureBatter(delivery.nonStrikerId);
    const batter = battingCards.get(delivery.strikerId)!;
    const bowler = ensureBowler(delivery.bowlerId);

    if (!overMap.has(delivery.overNumber)) {
      overMap.set(delivery.overNumber, {
        overNumber: delivery.overNumber,
        bowlerId: delivery.bowlerId,
        legalBalls: 0,
        runsConceded: 0,
        wickets: 0,
        isMaiden: false,
      });
    }
    const overSummary = overMap.get(delivery.overNumber)!;

    if (!currentPartnership) {
      currentPartnership = {
        wicketNumber: partnerships.length + 1,
        playerAId: delivery.strikerId,
        playerBId: delivery.nonStrikerId,
        runs: 0,
        balls: 0,
        isUnbeaten: true,
      };
    }

    const battingRuns = delivery.runsOffBat;
    const totalExtras = delivery.extraWides + delivery.extraNoballs + delivery.extraByes + delivery.extraLegbyes + delivery.extraPenalty;
    const ballRuns = battingRuns + totalExtras;

    runs += ballRuns;
    extras += totalExtras;

    // Charged to the bowler: runs off the bat, plus the wide/no-ball penalty and
    // any runs run on them. Byes, leg-byes and penalty runs are the team's, not the bowler's.
    const bowlerRuns = battingRuns + delivery.extraNoballs + delivery.extraWides;
    bowler.runsConceded += bowlerRuns;
    overSummary.runsConceded += bowlerRuns;
    if (delivery.extraWides > 0) bowler.wides += 1;
    if (delivery.extraNoballs > 0) bowler.noballs += 1;

    if (delivery.extraWides === 0) {
      // No-balls are not legal deliveries but still count as a ball faced;
      // only wides are excluded from the batter's ball count.
      batter.runs += battingRuns;
      batter.ballsFaced += 1;
      if (battingRuns === 4) batter.fours += 1;
      if (battingRuns === 6) batter.sixes += 1;
    }

    if (delivery.isLegalDelivery) {
      legalBalls += 1;
      bowler.legalBalls += 1;
      overSummary.legalBalls += 1;
    }

    currentPartnership.runs += ballRuns - delivery.extraPenalty;
    if (delivery.isLegalDelivery) currentPartnership.balls += 1;

    if (overSummary.legalBalls === rules.ballsPerOver) {
      overSummary.isMaiden = overSummary.runsConceded === 0;
      if (overSummary.isMaiden) bowler.maidens += 1;
    }

    if (delivery.wicketKind && delivery.playerOutId) {
      const dismissed = battingCards.get(delivery.playerOutId) ?? ensureBatter(delivery.playerOutId);
      dismissed.isOut = true;
      dismissed.dismissalKind = delivery.wicketKind;
      dismissed.fielderId = delivery.fielderId;
      if (BOWLER_CREDITED_DISMISSALS.has(delivery.wicketKind)) {
        dismissed.dismissedByBowlerId = delivery.bowlerId;
        bowler.wickets += 1;
        overSummary.wickets += 1;
      }

      if (delivery.wicketKind !== 'retired_hurt') {
        wickets += 1;
      }

      currentPartnership.isUnbeaten = false;
      partnerships.push(currentPartnership);
      currentPartnership = null;
    }

    if (wickets >= wicketsThatEndInnings) {
      isComplete = true;
      completionReason = 'all_out';
    } else if (legalBalls >= maxLegalBalls) {
      isComplete = true;
      completionReason = 'overs_complete';
    } else if (options.target !== undefined && runs >= options.target) {
      isComplete = true;
      completionReason = 'target_reached';
    }
  }

  if (currentPartnership && (currentPartnership.runs > 0 || currentPartnership.balls > 0 || partnerships.length === 0)) {
    partnerships.push(currentPartnership);
  }

  return {
    runs,
    wickets,
    legalBalls,
    extras,
    battingCards: [...battingCards.values()].sort((a, b) => a.position - b.position),
    bowlingCards: [...bowlingCards.values()],
    partnerships,
    overs: [...overMap.values()],
    isComplete,
    completionReason,
  };
}
