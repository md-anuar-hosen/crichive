import { describe, expect, it } from 'vitest';
import { computeMatchPoints, computeNetRunRate, rankStandings } from '../../src/domain/standings';
import type { InningsNrrInput, StandingsRow } from '../../src/domain/standings';

const BALLS_PER_OVER = 6;

describe('computeNetRunRate', () => {
  it('pads a bowled-out innings to the full overs quota, not the overs actually faced', () => {
    const innings: InningsNrrInput[] = [
      {
        battingTeamId: 'A',
        bowlingTeamId: 'B',
        runsScored: 90,
        legalBallsBowled: 48, // 8 overs — but A was bowled out well short of the 10-over quota
        battingTeamAllOut: true,
        oversAllotted: 10,
        isSuperOver: false,
        isNoResult: false,
      },
      {
        battingTeamId: 'B',
        bowlingTeamId: 'A',
        runsScored: 95,
        legalBallsBowled: 54, // 9 overs, chased down without losing all wickets
        battingTeamAllOut: false,
        oversAllotted: 10,
        isSuperOver: false,
        isNoResult: false,
      },
    ];

    // A: for = 90/10 (padded, not 90/8), against = 95/9 (actual, B wasn't all out)
    const expected = 90 / 10 - 95 / 9;
    expect(computeNetRunRate('A', innings, BALLS_PER_OVER)).toBeCloseTo(expected, 6);
    expect(computeNetRunRate('A', innings, BALLS_PER_OVER)).toBeCloseTo(-1.5556, 3);
  });

  it('excludes no-result matches entirely, regardless of runs scored', () => {
    const baseline: InningsNrrInput[] = [
      {
        battingTeamId: 'A',
        bowlingTeamId: 'B',
        runsScored: 90,
        legalBallsBowled: 48,
        battingTeamAllOut: true,
        oversAllotted: 10,
        isSuperOver: false,
        isNoResult: false,
      },
      {
        battingTeamId: 'B',
        bowlingTeamId: 'A',
        runsScored: 95,
        legalBallsBowled: 54,
        battingTeamAllOut: false,
        oversAllotted: 10,
        isSuperOver: false,
        isNoResult: false,
      },
    ];
    const withNoResultMatch: InningsNrrInput[] = [
      ...baseline,
      {
        battingTeamId: 'A',
        bowlingTeamId: 'B',
        runsScored: 999, // absurdly large — must not move the needle
        legalBallsBowled: 6,
        battingTeamAllOut: false,
        oversAllotted: 10,
        isSuperOver: false,
        isNoResult: true,
      },
    ];

    expect(computeNetRunRate('A', withNoResultMatch, BALLS_PER_OVER)).toBeCloseTo(
      computeNetRunRate('A', baseline, BALLS_PER_OVER),
      6,
    );
  });

  it('excludes super overs entirely', () => {
    const baseline: InningsNrrInput[] = [
      {
        battingTeamId: 'A',
        bowlingTeamId: 'B',
        runsScored: 90,
        legalBallsBowled: 60,
        battingTeamAllOut: false,
        oversAllotted: 10,
        isSuperOver: false,
        isNoResult: false,
      },
    ];
    const withSuperOver: InningsNrrInput[] = [
      ...baseline,
      {
        battingTeamId: 'A',
        bowlingTeamId: 'B',
        runsScored: 20,
        legalBallsBowled: 6,
        battingTeamAllOut: false,
        oversAllotted: 1,
        isSuperOver: true,
        isNoResult: false,
      },
    ];

    expect(computeNetRunRate('A', withSuperOver, BALLS_PER_OVER)).toBeCloseTo(
      computeNetRunRate('A', baseline, BALLS_PER_OVER),
      6,
    );
  });
});

describe('computeMatchPoints', () => {
  const rules = { pointsWin: 2, pointsTie: 1, pointsNoResult: 1, pointsLoss: 0 };

  it('maps each outcome to the tournament-configured points', () => {
    expect(computeMatchPoints('win', rules)).toBe(2);
    expect(computeMatchPoints('tie', rules)).toBe(1);
    expect(computeMatchPoints('no_result', rules)).toBe(1);
    expect(computeMatchPoints('loss', rules)).toBe(0);
  });
});

describe('rankStandings', () => {
  function row(overrides: Partial<StandingsRow>): StandingsRow {
    return {
      teamId: overrides.teamId ?? 'x',
      teamName: overrides.teamName ?? 'X',
      played: 0,
      won: 0,
      lost: 0,
      tied: 0,
      noResult: 0,
      points: 0,
      netRunRate: 0,
      ...overrides,
    };
  }

  it('ranks by points first', () => {
    const rows = [row({ teamId: 'a', teamName: 'A', points: 2 }), row({ teamId: 'b', teamName: 'B', points: 4 })];
    const ranked = rankStandings(rows, () => 0);
    expect(ranked.map((r) => r.teamId)).toEqual(['b', 'a']);
  });

  it('breaks a points tie with net run rate', () => {
    const rows = [
      row({ teamId: 'a', teamName: 'A', points: 2, netRunRate: -0.5 }),
      row({ teamId: 'b', teamName: 'B', points: 2, netRunRate: 1.2 }),
    ];
    const ranked = rankStandings(rows, () => 0);
    expect(ranked.map((r) => r.teamId)).toEqual(['b', 'a']);
  });

  it('breaks a points+NRR tie with head-to-head', () => {
    const rows = [
      row({ teamId: 'a', teamName: 'A', points: 2, netRunRate: 0.5 }),
      row({ teamId: 'b', teamName: 'B', points: 2, netRunRate: 0.5 }),
    ];
    // B beat A head-to-head.
    const ranked = rankStandings(rows, (x, y) => (x === 'b' && y === 'a' ? 1 : x === 'a' && y === 'b' ? -1 : 0));
    expect(ranked.map((r) => r.teamId)).toEqual(['b', 'a']);
  });

  it('falls back to alphabetical when everything else is level', () => {
    const rows = [
      row({ teamId: 'z', teamName: 'Zebras', points: 2, netRunRate: 0.5 }),
      row({ teamId: 'a', teamName: 'Antelopes', points: 2, netRunRate: 0.5 }),
    ];
    const ranked = rankStandings(rows, () => 0);
    expect(ranked.map((r) => r.teamId)).toEqual(['a', 'z']);
  });
});
