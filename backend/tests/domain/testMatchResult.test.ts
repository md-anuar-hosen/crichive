import { describe, expect, it } from 'vitest';
import { isFollowOnEligible, resolveTestMatchResult } from '../../src/domain/scoring';
import type { TestInningsSummary } from '../../src/domain/scoring';
import type { TournamentRules } from '../../src/domain/scoring';

const TEAM_A = 'team-a';
const TEAM_B = 'team-b';

function rules(overrides: Partial<TournamentRules> = {}): TournamentRules {
  return {
    matchType: 'test',
    daysPerMatch: 5,
    oversPerInnings: null,
    ballsPerOver: 6,
    maxOversPerBowler: null,
    powerplayOvers: 0,
    playersPerSide: 11,
    wideRuns: 1,
    noballRuns: 1,
    freeHitAfterNoball: false,
    pointsWin: 12,
    pointsTie: 6,
    pointsNoResult: 2,
    pointsLoss: 0,
    pointsDraw: 4,
    superOverOnTie: false,
    dlsEnabled: false,
    followOnEnabled: true,
    followOnMargin: 200,
    ...overrides,
  };
}

function innings(inningsNumber: number, battingTeamId: string, runs: number, wickets: number, declared = false): TestInningsSummary {
  return { inningsNumber, battingTeamId, runs, wickets, declared };
}

describe('isFollowOnEligible', () => {
  it('is eligible once the lead reaches the configured margin', () => {
    expect(isFollowOnEligible({ runs: 500 }, { runs: 300 }, rules())).toBe(true);
    expect(isFollowOnEligible({ runs: 499 }, { runs: 300 }, rules())).toBe(false);
  });

  it('is never eligible when the rules disable it, regardless of lead', () => {
    expect(isFollowOnEligible({ runs: 600 }, { runs: 100 }, rules({ followOnEnabled: false }))).toBe(false);
  });
});

describe('resolveTestMatchResult', () => {
  it('is undecided with fewer than 3 innings closed', () => {
    const soFar = [innings(1, TEAM_A, 300, 10), innings(2, TEAM_B, 250, 10)];
    expect(resolveTestMatchResult(soFar, rules(), TEAM_A, TEAM_B)).toEqual({ decided: false });
  });

  it('is undecided after innings 3 closes with no follow-on (both sides still owed an innings)', () => {
    const soFar = [innings(1, TEAM_A, 300, 10), innings(2, TEAM_B, 250, 10), innings(3, TEAM_A, 200, 10)];
    expect(resolveTestMatchResult(soFar, rules(), TEAM_A, TEAM_B)).toEqual({ decided: false });
  });

  it('normal order: chasing side wins by wickets when it overtakes the target', () => {
    // A: 300 + 200 = 500. B: 250 + 253/6 = 503 -> B wins by 4 wickets.
    const soFar = [
      innings(1, TEAM_A, 300, 10),
      innings(2, TEAM_B, 250, 10),
      innings(3, TEAM_A, 200, 10),
      innings(4, TEAM_B, 253, 6),
    ];
    expect(resolveTestMatchResult(soFar, rules(), TEAM_A, TEAM_B)).toEqual({
      decided: true,
      outcome: { kind: 'wickets_win', winningTeamId: TEAM_B, marginWickets: 4 },
    });
  });

  it('normal order: bowling side wins by runs when the chase falls short all out', () => {
    // A: 300 + 200 = 500. B: 250 + 240 (all out) = 490 -> A wins by 10 runs.
    const soFar = [
      innings(1, TEAM_A, 300, 10),
      innings(2, TEAM_B, 250, 10),
      innings(3, TEAM_A, 200, 10),
      innings(4, TEAM_B, 240, 10),
    ];
    expect(resolveTestMatchResult(soFar, rules(), TEAM_A, TEAM_B)).toEqual({
      decided: true,
      outcome: { kind: 'runs_win', winningTeamId: TEAM_A, marginRuns: 10 },
    });
  });

  it('exact aggregate equality after all 4 innings is a tie (no Super Over)', () => {
    const soFar = [
      innings(1, TEAM_A, 300, 10),
      innings(2, TEAM_B, 250, 10),
      innings(3, TEAM_A, 200, 10),
      innings(4, TEAM_B, 250, 10),
    ];
    expect(resolveTestMatchResult(soFar, rules(), TEAM_A, TEAM_B)).toEqual({ decided: true, outcome: { kind: 'tie' } });
  });

  it('follow-on enforced, trailing side never overtakes: win by an innings', () => {
    // A: 500 (1 innings only). B: 200 + 250 = 450 -> A wins by an innings and 50 runs, no innings 4.
    const soFar = [innings(1, TEAM_A, 500, 10), innings(2, TEAM_B, 200, 10), innings(3, TEAM_B, 250, 10)];
    expect(resolveTestMatchResult(soFar, rules(), TEAM_A, TEAM_B)).toEqual({
      decided: true,
      outcome: { kind: 'innings_win', winningTeamId: TEAM_A, marginRuns: 50 },
    });
  });

  it('follow-on enforced but the trailing side claws back ahead: innings 4 needed, plain runs/wickets result', () => {
    // A: 500 (1 innings). B: 200 + 350 = 550 -> B now needs A to bat again (innings 4), chasing 51.
    const afterInnings3 = [innings(1, TEAM_A, 500, 10), innings(2, TEAM_B, 200, 10), innings(3, TEAM_B, 350, 10)];
    expect(resolveTestMatchResult(afterInnings3, rules(), TEAM_A, TEAM_B)).toEqual({ decided: false });

    // A bats innings 4 and falls short, all out for 40 -> B wins by an innings margin comparison:
    // A total = 500 + 40 = 540, B total = 550 -> B wins by 10 runs (A has batted twice, so not an innings win).
    const afterInnings4 = [...afterInnings3, innings(4, TEAM_A, 40, 10)];
    expect(resolveTestMatchResult(afterInnings4, rules(), TEAM_A, TEAM_B)).toEqual({
      decided: true,
      outcome: { kind: 'runs_win', winningTeamId: TEAM_B, marginRuns: 10 },
    });
  });

  it('a declared innings decides the match the same way as an all-out one', () => {
    // A: 300 + 200 (declared) = 500. B: 250 + 253/4 (target reached) = 503 -> B wins by 6 wickets.
    const soFar = [
      innings(1, TEAM_A, 300, 10),
      innings(2, TEAM_B, 250, 10),
      innings(3, TEAM_A, 200, 4, true),
      innings(4, TEAM_B, 253, 4),
    ];
    expect(resolveTestMatchResult(soFar, rules(), TEAM_A, TEAM_B)).toEqual({
      decided: true,
      outcome: { kind: 'wickets_win', winningTeamId: TEAM_B, marginWickets: 6 },
    });
  });
});
