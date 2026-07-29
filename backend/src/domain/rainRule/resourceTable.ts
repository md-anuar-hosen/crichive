/**
 * "CricHive Rain Rule" — an independently-authored resource-percentage
 * model for revising targets in interrupted limited-overs matches.
 *
 * This is NOT the licensed ICC/ECB Duckworth-Lewis-Stern (DLS) method,
 * and no official DLS resource table is reproduced here — those tables
 * are commercially licensed. This module follows the same general shape
 * described in the original, publicly published academic paper
 * (Duckworth & Lewis, 1998, "A fair method for resetting the target in
 * interrupted one-day cricket matches", J. Operational Research Society):
 * a side's batting resource is a function of overs remaining and wickets
 * lost, decaying faster as more wickets fall. The constants below are
 * independently chosen for CricHive, not copied from any licensed table,
 * and the curve is normalised per-format via `totalOvers` rather than
 * assuming a 50-over match.
 *
 * Never surface the word "DLS"/"D/L" against this module's output —
 * label it "CricHive Rain Rule" in API responses and UI copy.
 */

const FULL_RESOURCE_PERCENT = 100;

/** Resource ceiling (%) with all overs still to come, at `wicketsLost` down. */
function resourceCeiling(wicketsLost: number): number {
  if (wicketsLost >= 10) return 0;
  return FULL_RESOURCE_PERCENT * Math.pow(1 - wicketsLost / 10, 1.5);
}

/** Decay-rate constant: how quickly resource saturates towards its ceiling as overs remain. Grows with wickets lost — a side with few wickets in hand gets little extra value from overs it's unlikely to survive to bowl. */
function decayRate(wicketsLost: number): number {
  const B0 = 0.026;
  const GROWTH = 0.256;
  return B0 * Math.exp(GROWTH * Math.min(wicketsLost, 9));
}

function clampWickets(wicketsLost: number): number {
  return Math.min(10, Math.max(0, Math.round(wicketsLost)));
}

/**
 * Resource percentage (0-100) available to a batting side with
 * `oversRemaining` overs left to bowl (out of `totalOvers` for this
 * format) and `wicketsLost` wickets already down.
 *
 * Normalised so that resourcePercent(totalOvers, 0, totalOvers) === 100
 * (full resource, fresh innings) regardless of format.
 */
export function resourcePercent(oversRemaining: number, wicketsLost: number, totalOvers: number): number {
  const w = clampWickets(wicketsLost);
  if (w >= 10 || totalOvers <= 0) return 0;

  const u = Math.min(Math.max(0, oversRemaining), totalOvers);
  if (u === 0) return 0;

  const b = decayRate(w);
  const ceiling = resourceCeiling(w);
  const shape = (1 - Math.exp(-b * u)) / (1 - Math.exp(-b * totalOvers));
  return ceiling * shape;
}
