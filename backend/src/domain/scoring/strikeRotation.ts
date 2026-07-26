import type { Delivery, TournamentRules } from './types';

/**
 * How many runs were physically run between the wickets on this delivery —
 * the thing that flips who's on strike. Byes/leg-byes are what's run when
 * nobody hits the ball; otherwise it's the runs off the bat (which also
 * covers a no-ball hit away, and the "extra run" of a wide once the base
 * penalty is subtracted).
 */
function runsRun(delivery: Delivery, rules: TournamentRules): number {
  if (delivery.extraByes > 0 || delivery.extraLegbyes > 0) {
    return delivery.extraByes + delivery.extraLegbyes;
  }
  if (delivery.extraWides > 0) {
    return Math.max(0, delivery.extraWides - rules.wideRuns);
  }
  return delivery.runsOffBat;
}

function isEndOfOver(delivery: Delivery, rules: TournamentRules): boolean {
  return delivery.isLegalDelivery && delivery.ballInOver === rules.ballsPerOver;
}

export interface CreasePair {
  strikerId: string;
  nonStrikerId: string;
}

/**
 * Who faces the next delivery, given the one that was just bowled.
 * Handles plain rotation (odd runs / byes / leg-byes swap strike), the
 * end-of-over swap (applied after any run-based swap), and replacing a
 * dismissed batter with an incoming one at the correct end.
 */
export function computeNextStrikers(delivery: Delivery, rules: TournamentRules, incomingBatterId?: string): CreasePair {
  let strikerId = delivery.strikerId;
  let nonStrikerId = delivery.nonStrikerId;

  if (delivery.wicketKind && delivery.playerOutId) {
    if (!incomingBatterId) {
      throw new Error('incomingBatterId is required to compute next strikers after a wicket');
    }

    if (delivery.wicketKind === 'run_out') {
      // The survivor's end depends on the parity of runs completed before the
      // run-out; the new batter simply fills whichever end is now vacant.
      const survivorId = delivery.playerOutId === delivery.strikerId ? delivery.nonStrikerId : delivery.strikerId;
      const survivorStartedAsStriker = survivorId === delivery.strikerId;
      const crossed = runsRun(delivery, rules) % 2 === 1;
      const survivorEndsAsStriker = crossed ? !survivorStartedAsStriker : survivorStartedAsStriker;

      strikerId = survivorEndsAsStriker ? survivorId : incomingBatterId;
      nonStrikerId = survivorEndsAsStriker ? incomingBatterId : survivorId;
    } else {
      // Every other dismissal can only be the striker (bowled/caught/lbw/stumped/
      // hit_wicket/hit_ball_twice/timed_out) or is handled the same way for our
      // purposes: the incoming batter takes the vacated end, the other batter's
      // end is untouched.
      const strikerWasOut = delivery.playerOutId === delivery.strikerId;
      strikerId = strikerWasOut ? incomingBatterId : delivery.strikerId;
      nonStrikerId = strikerWasOut ? delivery.nonStrikerId : incomingBatterId;
    }
  } else if (runsRun(delivery, rules) % 2 === 1) {
    [strikerId, nonStrikerId] = [nonStrikerId, strikerId];
  }

  if (isEndOfOver(delivery, rules)) {
    [strikerId, nonStrikerId] = [nonStrikerId, strikerId];
  }

  return { strikerId, nonStrikerId };
}

/**
 * Whether the delivery about to be bowled should be flagged as a free hit —
 * true immediately after a no-ball, and it persists through any illegal
 * (e.g. wide) delivery bowled while still on a free hit.
 */
export function isNextDeliveryFreeHit(previous: Delivery, rules: TournamentRules): boolean {
  if (!rules.freeHitAfterNoball) return false;
  if (previous.extraNoballs > 0) return true;
  return previous.isFreeHit && !previous.isLegalDelivery;
}
