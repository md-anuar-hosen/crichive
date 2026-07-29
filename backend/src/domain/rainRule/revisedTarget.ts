import { resourcePercent } from './resourceTable';

export interface RainInterruption {
  oversRemainingBefore: number;
  oversRemainingAfter: number;
  wicketsLostAt: number;
}

/**
 * Resource percentage actually available to a side across its innings,
 * after zero or more interruptions. Each interruption removes whatever
 * resource existed between "before" and "after" at the wickets down when
 * it happened; multiple interruptions during the same innings simply
 * stack (this generalises to any number of stoppages without needing to
 * special-case the count).
 */
export function resourceAvailablePercent(interruptions: readonly RainInterruption[], totalOvers: number): number {
  let used = 0;
  for (const event of interruptions) {
    const before = resourcePercent(event.oversRemainingBefore, event.wicketsLostAt, totalOvers);
    const after = resourcePercent(event.oversRemainingAfter, event.wicketsLostAt, totalOvers);
    used += Math.max(0, before - after);
  }
  return Math.max(0, 100 - used);
}

export interface RevisedTargetInput {
  firstInningsRuns: number;
  firstInningsResourcePercent: number;
  secondInningsResourcePercent: number;
}

/**
 * CricHive Rain Rule par score: the score at which the two sides'
 * resource-adjusted efforts are level. Useful for a live "current score
 * vs. par" readout during a chase.
 *
 * Simplification vs. official DLS: this always scales by the resource
 * ratio, including the rarer case where the chasing side ends up with
 * MORE resource than the side that batted first (official DLS switches
 * to an average-score table there instead). Adding that would require an
 * average-total-score constant we have no reliable source for at
 * grassroots level, so it's out of scope for now.
 */
export function computeParScore({ firstInningsRuns, firstInningsResourcePercent, secondInningsResourcePercent }: RevisedTargetInput): number {
  if (firstInningsResourcePercent <= 0) return firstInningsRuns;
  return (firstInningsRuns * secondInningsResourcePercent) / firstInningsResourcePercent;
}

/** CricHive Rain Rule revised target (runs needed to win) for the chasing side. */
export function computeRevisedTarget(input: RevisedTargetInput): number {
  return Math.floor(computeParScore(input)) + 1;
}
