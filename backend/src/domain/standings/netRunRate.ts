import type { InningsNrrInput } from './types';

/**
 * NRR = (runs scored / overs faced) − (runs conceded / overs bowled).
 *
 * The trap: a team that's bowled out is credited with having faced its FULL
 * overs quota, not however many overs it actually took to lose its last
 * wicket — otherwise getting bowled out cheaply would inflate your own run
 * rate. This padding only ever applies to the batting side's "overs faced"
 * figure; the bowling side's "overs bowled" is always the real figure.
 *
 * No-result matches and super overs are excluded entirely.
 */
export function computeNetRunRate(teamId: string, innings: InningsNrrInput[], ballsPerOver: number): number {
  let runsFor = 0;
  let oversFacedFor = 0;
  let runsAgainst = 0;
  let oversBowledAgainst = 0;

  for (const inn of innings) {
    if (inn.isSuperOver || inn.isNoResult) continue;

    const actualOvers = inn.legalBallsBowled / ballsPerOver;

    if (inn.battingTeamId === teamId) {
      runsFor += inn.runsScored;
      oversFacedFor += inn.battingTeamAllOut ? inn.oversAllotted : actualOvers;
    } else if (inn.bowlingTeamId === teamId) {
      runsAgainst += inn.runsScored;
      oversBowledAgainst += actualOvers;
    }
  }

  const forRate = oversFacedFor > 0 ? runsFor / oversFacedFor : 0;
  const againstRate = oversBowledAgainst > 0 ? runsAgainst / oversBowledAgainst : 0;
  return forRate - againstRate;
}
