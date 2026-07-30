import { describe, expect, it } from 'vitest';
import { generateSingleEliminationBracket, roundName, standardSeedOrder } from '../../src/domain/bracket';

describe('standardSeedOrder', () => {
  it('matches the well-known 8-team bracket order', () => {
    expect(standardSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('matches the well-known 4-team bracket order', () => {
    expect(standardSeedOrder(4)).toEqual([1, 4, 2, 3]);
  });

  it('a 2-team bracket is just the two seeds', () => {
    expect(standardSeedOrder(2)).toEqual([1, 2]);
  });
});

describe('generateSingleEliminationBracket — power-of-two sizes', () => {
  it('4 teams, no byes: 2 round-1 matches feeding one final', () => {
    const teams = ['A', 'B', 'C', 'D']; // seeds 1-4
    const slots = generateSingleEliminationBracket(teams);

    const round1 = slots.filter((s) => s.round === 1);
    expect(round1).toHaveLength(2);
    expect(round1.map((s) => [s.teamAId, s.teamBId])).toEqual([
      ['A', 'D'],
      ['B', 'C'],
    ]);

    const final = slots.find((s) => s.round === 2);
    expect(final).toBeDefined();
    expect(final!.teamAId).toBeNull();
    expect(final!.teamBId).toBeNull();
    expect(final!.nextTempId).toBeNull();

    // Both round-1 matches feed the final, one into each slot.
    expect(round1[0].nextTempId).toBe(final!.tempId);
    expect(round1[1].nextTempId).toBe(final!.tempId);
    expect(new Set(round1.map((s) => s.nextSlot))).toEqual(new Set(['team_a', 'team_b']));
  });

  it('8 teams: seed 1 vs 8, seed 1 and 2 cannot meet before the final', () => {
    const teams = Array.from({ length: 8 }, (_, i) => `T${i + 1}`); // seed k = Tk
    const slots = generateSingleEliminationBracket(teams);

    expect(slots.filter((s) => s.round === 1)).toHaveLength(4);
    expect(slots.filter((s) => s.round === 2)).toHaveLength(2);
    expect(slots.filter((s) => s.round === 3)).toHaveLength(1);

    const round1 = slots.filter((s) => s.round === 1);
    expect(round1.map((s) => [s.teamAId, s.teamBId])).toEqual([
      ['T1', 'T8'],
      ['T4', 'T5'],
      ['T2', 'T7'],
      ['T3', 'T6'],
    ]);

    // Trace seed 1's path and seed 2's path through nextTempId — they must
    // not converge until the final (round 3).
    const seed1Match = round1[0];
    const seed2Match = round1[2];
    expect(seed1Match.nextTempId).not.toBe(seed2Match.nextTempId);

    const seed1SemiTempId = seed1Match.nextTempId;
    const seed2SemiTempId = seed2Match.nextTempId;
    const seed1Semi = slots.find((s) => s.tempId === seed1SemiTempId)!;
    const seed2Semi = slots.find((s) => s.tempId === seed2SemiTempId)!;
    expect(seed1Semi.nextTempId).toBe(seed2Semi.nextTempId); // both semis feed the same final
  });
});

describe('generateSingleEliminationBracket — byes for a non-power-of-two team count', () => {
  it('3 teams: seed 1 gets a bye straight to the final, seeds 2 v 3 play', () => {
    const teams = ['A', 'B', 'C'];
    const slots = generateSingleEliminationBracket(teams);

    // Only one real match should exist (2 v 3) — seed 1's bye never becomes a match row.
    expect(slots).toHaveLength(2); // the 2v3 match, plus the final
    const round1 = slots.filter((s) => s.round === 1);
    expect(round1).toHaveLength(1);
    expect([round1[0].teamAId, round1[0].teamBId].sort()).toEqual(['B', 'C']);

    const final = slots.find((s) => s.round === 2)!;
    // Seed 1 (A) is known immediately in the final, since the bye needed no match.
    expect([final.teamAId, final.teamBId]).toContain('A');
    expect([final.teamAId, final.teamBId]).toContain(null);
  });

  it('5 teams: three byes, only the 4-vs-5 match is real in round 1', () => {
    const teams = ['A', 'B', 'C', 'D', 'E']; // seeds 1-5
    const slots = generateSingleEliminationBracket(teams);

    const round1 = slots.filter((s) => s.round === 1);
    expect(round1).toHaveLength(1);
    expect([round1[0].teamAId, round1[0].teamBId].sort()).toEqual(['D', 'E']);

    // Round 2 (of an 8-slot bracket) has 4 slots: 3 bye-advanced teams
    // (A, B, C) already placed, plus the pending winner of D v E.
    const round2 = slots.filter((s) => s.round === 2);
    expect(round2).toHaveLength(2);
    const round2Teams = round2.flatMap((s) => [s.teamAId, s.teamBId]).filter((t): t is string => t !== null);
    expect(round2Teams.sort()).toEqual(['A', 'B', 'C']);
  });

  it('every real team appears in the generated bracket exactly once', () => {
    const teams = Array.from({ length: 6 }, (_, i) => `T${i + 1}`);
    const slots = generateSingleEliminationBracket(teams);
    const appearances = slots.flatMap((s) => [s.teamAId, s.teamBId]).filter((t): t is string => t !== null);
    expect(appearances.sort()).toEqual([...teams].sort());
  });

  it('rejects fewer than 2 teams', () => {
    expect(() => generateSingleEliminationBracket(['A'])).toThrow();
  });
});

describe('roundName', () => {
  it('labels an 8-team (3-round) bracket', () => {
    expect(roundName(1, 3)).toBe('Quarter-Finals');
    expect(roundName(2, 3)).toBe('Semi-Finals');
    expect(roundName(3, 3)).toBe('Final');
  });

  it('labels a 16-team (4-round) bracket', () => {
    expect(roundName(1, 4)).toBe('Round of 16');
    expect(roundName(2, 4)).toBe('Quarter-Finals');
    expect(roundName(3, 4)).toBe('Semi-Finals');
    expect(roundName(4, 4)).toBe('Final');
  });

  it('a 2-team (1-round) bracket is just a final', () => {
    expect(roundName(1, 1)).toBe('Final');
  });
});
