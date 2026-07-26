import type { StandingsRow } from './types';

/**
 * 1 if a beat b head-to-head, -1 if b beat a, 0 if unknown/level (no games
 * between them, or they split their meetings).
 */
export type HeadToHead = (teamAId: string, teamBId: string) => number;

/**
 * Rank by points, then net run rate, then head-to-head, then alphabetically
 * by name — in that order, each only breaking a tie left by the one before it.
 */
export function rankStandings(rows: StandingsRow[], headToHead: HeadToHead): StandingsRow[] {
  return [...rows].sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    if (a.netRunRate !== b.netRunRate) return b.netRunRate - a.netRunRate;

    const h2h = headToHead(a.teamId, b.teamId);
    if (h2h !== 0) return -h2h;

    return a.teamName.localeCompare(b.teamName);
  });
}
