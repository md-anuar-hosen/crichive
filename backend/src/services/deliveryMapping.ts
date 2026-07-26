import type { Selectable } from 'kysely';
import type { Deliveries } from '../db/types';
import type { Delivery, TournamentRules } from '../domain/scoring';

export function toDomainDelivery(row: Selectable<Deliveries>): Delivery {
  return {
    overNumber: row.over_number,
    ballInOver: row.ball_in_over,
    sequence: row.sequence,
    strikerId: row.striker_id,
    nonStrikerId: row.non_striker_id,
    bowlerId: row.bowler_id,
    runsOffBat: row.runs_off_bat,
    extraWides: row.extra_wides,
    extraNoballs: row.extra_noballs,
    extraByes: row.extra_byes,
    extraLegbyes: row.extra_legbyes,
    extraPenalty: row.extra_penalty,
    isLegalDelivery: row.is_legal_delivery,
    isFreeHit: row.is_free_hit,
    wicketKind: row.wicket_kind ?? undefined,
    playerOutId: row.player_out_id ?? undefined,
    fielderId: row.fielder_id ?? undefined,
    voidedAt: row.voided_at ?? undefined,
  };
}

export interface NextBallPosition {
  overNumber: number;
  legalBallsSoFarInOver: number;
}

/**
 * Where the next delivery lands, based only on what's already been bowled
 * (legally) in the innings. An over is done once it has ballsPerOver legal
 * deliveries in it, regardless of how many wides/no-balls padded it out.
 */
export function computeNextBallPosition(priorDeliveries: Delivery[], rules: TournamentRules): NextBallPosition {
  const nonVoided = priorDeliveries.filter((d) => !d.voidedAt);
  if (nonVoided.length === 0) {
    return { overNumber: 0, legalBallsSoFarInOver: 0 };
  }

  const currentOverNumber = Math.max(...nonVoided.map((d) => d.overNumber));
  const legalBallsInCurrentOver = nonVoided.filter((d) => d.overNumber === currentOverNumber && d.isLegalDelivery).length;

  if (legalBallsInCurrentOver >= rules.ballsPerOver) {
    return { overNumber: currentOverNumber + 1, legalBallsSoFarInOver: 0 };
  }
  return { overNumber: currentOverNumber, legalBallsSoFarInOver: legalBallsInCurrentOver };
}
