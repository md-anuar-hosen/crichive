import { describe, expect, it } from 'vitest';
import { computeParScore, computeRevisedTarget, resourceAvailablePercent, resourcePercent } from '../../src/domain/rainRule';
import type { RainInterruption } from '../../src/domain/rainRule';

describe('resourcePercent', () => {
  it('is 100% with a fresh innings and no wickets down, for any format', () => {
    expect(resourcePercent(10, 0, 10)).toBeCloseTo(100, 5);
    expect(resourcePercent(20, 0, 20)).toBeCloseTo(100, 5);
    expect(resourcePercent(50, 0, 50)).toBeCloseTo(100, 5);
  });

  it('is 0 with no overs left, regardless of wickets in hand', () => {
    expect(resourcePercent(0, 0, 10)).toBe(0);
    expect(resourcePercent(0, 5, 10)).toBe(0);
  });

  it('is 0 once all-out', () => {
    expect(resourcePercent(5, 10, 10)).toBe(0);
  });

  it('decreases monotonically as wickets fall, overs held constant', () => {
    const values = Array.from({ length: 10 }, (_, w) => resourcePercent(5, w, 10));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1]);
    }
  });

  it('decreases monotonically as overs remaining shrink, wickets held constant', () => {
    const values = [10, 8, 6, 4, 2, 0].map((u) => resourcePercent(u, 3, 10));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
  });
});

describe('resourceAvailablePercent', () => {
  it('is 100 with no interruptions', () => {
    expect(resourceAvailablePercent([], 10)).toBe(100);
  });

  it('removes exactly the resource lost by a single stoppage', () => {
    const totalOvers = 10;
    const event: RainInterruption = { oversRemainingBefore: 6, oversRemainingAfter: 4, wicketsLostAt: 2 };
    const expectedLoss = resourcePercent(6, 2, totalOvers) - resourcePercent(4, 2, totalOvers);
    expect(resourceAvailablePercent([event], totalOvers)).toBeCloseTo(100 - expectedLoss, 5);
  });

  it('stacks multiple interruptions in the same innings', () => {
    const totalOvers = 10;
    const first: RainInterruption = { oversRemainingBefore: 8, oversRemainingAfter: 6, wicketsLostAt: 1 };
    const second: RainInterruption = { oversRemainingBefore: 4, oversRemainingAfter: 2, wicketsLostAt: 4 };
    const lossA = resourcePercent(8, 1, totalOvers) - resourcePercent(6, 1, totalOvers);
    const lossB = resourcePercent(4, 4, totalOvers) - resourcePercent(2, 4, totalOvers);
    expect(resourceAvailablePercent([first, second], totalOvers)).toBeCloseTo(100 - lossA - lossB, 5);
  });

  it('never goes below 0', () => {
    const totalOvers = 10;
    const wipeout: RainInterruption = { oversRemainingBefore: 10, oversRemainingAfter: 0, wicketsLostAt: 0 };
    expect(resourceAvailablePercent([wipeout, wipeout], totalOvers)).toBe(0);
  });
});

describe('computeParScore / computeRevisedTarget', () => {
  it('matches the first innings total when resources are equal (no interruption)', () => {
    const input = { firstInningsRuns: 120, firstInningsResourcePercent: 100, secondInningsResourcePercent: 100 };
    expect(computeParScore(input)).toBeCloseTo(120, 5);
    expect(computeRevisedTarget(input)).toBe(121);
  });

  it('scales the target down when the chasing side has less resource', () => {
    const input = { firstInningsRuns: 150, firstInningsResourcePercent: 100, secondInningsResourcePercent: 60 };
    expect(computeParScore(input)).toBeCloseTo(90, 5);
    expect(computeRevisedTarget(input)).toBe(91);
  });

  it('scales the target up when the chasing side unusually has more resource', () => {
    const input = { firstInningsRuns: 100, firstInningsResourcePercent: 80, secondInningsResourcePercent: 100 };
    expect(computeParScore(input)).toBeCloseTo(125, 5);
    expect(computeRevisedTarget(input)).toBe(126);
  });

  it('falls back to runs + 1 if the first innings somehow used zero resource', () => {
    const input = { firstInningsRuns: 50, firstInningsResourcePercent: 0, secondInningsResourcePercent: 50 };
    expect(computeRevisedTarget(input)).toBe(51);
  });
});
