import { describe, expect, it } from 'vitest';
import { computePerformanceScore, selectBestPerformer } from '../../src/domain/scoring';
import type { PlayerPerformance } from '../../src/domain/scoring';

function perf(overrides: Partial<PlayerPerformance> & { playerId: string }): PlayerPerformance {
  return { runs: 0, fours: 0, sixes: 0, wickets: 0, maidens: 0, catches: 0, stumpings: 0, runOuts: 0, ...overrides };
}

describe('computePerformanceScore', () => {
  it('weights runs, boundaries, wickets, maidens and fielding', () => {
    const p = perf({ playerId: 'p1', runs: 50, fours: 4, sixes: 2, wickets: 3, maidens: 1, catches: 1, stumpings: 0, runOuts: 0 });
    // 50 + 4 + 4 + 60 + 10 + 10 = 138
    expect(computePerformanceScore(p)).toBe(138);
  });

  it('is 0 for a player with no recorded contribution', () => {
    expect(computePerformanceScore(perf({ playerId: 'p1' }))).toBe(0);
  });
});

describe('selectBestPerformer', () => {
  it('returns null for an empty list', () => {
    expect(selectBestPerformer([])).toBeNull();
  });

  it('picks the single highest-scoring player', () => {
    const performances = [
      perf({ playerId: 'batter', runs: 80, fours: 8 }),
      perf({ playerId: 'bowler', wickets: 2 }),
    ];
    expect(selectBestPerformer(performances)).toBe('batter');
  });

  it('an all-round performance can outscore a big century', () => {
    const centurion = perf({ playerId: 'centurion', runs: 100, fours: 10 });
    const allRounder = perf({ playerId: 'allrounder', runs: 60, fours: 5, wickets: 4, catches: 2 });
    // centurion: 100 + 10 = 110. allrounder: 60 + 5 + 80 + 20 = 165.
    expect(selectBestPerformer([centurion, allRounder])).toBe('allrounder');
  });

  it('breaks a tied score by runs, then wickets, then playerId, deterministically', () => {
    const a = perf({ playerId: 'b-player', wickets: 2 }); // 40
    const b = perf({ playerId: 'a-player', runs: 40 }); // 40 — same score, more runs wins
    expect(selectBestPerformer([a, b])).toBe('a-player');

    const c = perf({ playerId: 'zzz', runs: 20, wickets: 1 }); // 40
    const d = perf({ playerId: 'aaa', runs: 20, wickets: 1 }); // 40 — fully tied, lower playerId wins
    expect(selectBestPerformer([c, d])).toBe('aaa');
  });
});
