import { DISMISSALS_ALLOWED_ON_FREE_HIT } from './types';
import type { Delivery, TournamentRules } from './types';

export type DeliveryProposal = Pick<
  Delivery,
  'overNumber' | 'bowlerId' | 'isLegalDelivery' | 'isFreeHit' | 'wicketKind'
>;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const ok: ValidationResult = { valid: true };

/**
 * Checks a proposed delivery against everything bowled so far in the innings,
 * BEFORE it's accepted — bowler quota, no consecutive overs, and dismissals
 * that are illegal on a free hit.
 */
export function validateDelivery(proposal: DeliveryProposal, priorDeliveries: Delivery[], rules: TournamentRules): ValidationResult {
  if (proposal.isFreeHit && proposal.wicketKind && !DISMISSALS_ALLOWED_ON_FREE_HIT.has(proposal.wicketKind)) {
    return { valid: false, error: `${proposal.wicketKind} is not a valid dismissal on a free hit` };
  }

  const priorInThisOver = priorDeliveries.filter((d) => !d.voidedAt && d.overNumber === proposal.overNumber);
  const isFirstBallOfOverForBowler = !priorInThisOver.some((d) => d.bowlerId === proposal.bowlerId);

  if (isFirstBallOfOverForBowler) {
    const oversBowled = new Set(
      priorDeliveries.filter((d) => !d.voidedAt && d.bowlerId === proposal.bowlerId).map((d) => d.overNumber),
    );
    if (oversBowled.size >= rules.maxOversPerBowler) {
      return { valid: false, error: `${proposal.bowlerId} has already bowled their full quota of ${rules.maxOversPerBowler} over(s)` };
    }

    const previousOverNumber = proposal.overNumber - 1;
    const previousOverBowler = priorDeliveries.find((d) => !d.voidedAt && d.overNumber === previousOverNumber)?.bowlerId;
    if (previousOverBowler && previousOverBowler === proposal.bowlerId) {
      return { valid: false, error: 'A bowler may not bowl two consecutive overs' };
    }
  }

  return ok;
}
