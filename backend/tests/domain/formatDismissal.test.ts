import { describe, expect, it } from 'vitest';
import { formatDismissal } from '../../src/domain/scoring';

describe('formatDismissal', () => {
  it('formats bowled', () => {
    expect(formatDismissal({ kind: 'bowled', bowlerName: 'Islam' })).toBe('b Islam');
  });

  it('formats lbw', () => {
    expect(formatDismissal({ kind: 'lbw', bowlerName: 'Islam' })).toBe('lbw b Islam');
  });

  it('formats caught with a different fielder', () => {
    expect(
      formatDismissal({ kind: 'caught', bowlerId: 'b1', bowlerName: 'Islam', fielderId: 'f1', fielderName: 'Rahman' }),
    ).toBe('c Rahman b Islam');
  });

  it('formats caught and bowled when fielder and bowler are the same player', () => {
    expect(
      formatDismissal({ kind: 'caught', bowlerId: 'p1', bowlerName: 'Islam', fielderId: 'p1', fielderName: 'Islam' }),
    ).toBe('c & b Islam');
  });

  it('formats stumped', () => {
    expect(
      formatDismissal({ kind: 'stumped', bowlerName: 'Islam', fielderName: 'Rahman' }),
    ).toBe('st Rahman b Islam');
  });

  it('formats hit wicket', () => {
    expect(formatDismissal({ kind: 'hit_wicket', bowlerName: 'Islam' })).toBe('hit wicket b Islam');
  });

  it('formats run out with the fielder credited', () => {
    expect(formatDismissal({ kind: 'run_out', fielderName: 'Rahman' })).toBe('run out (Rahman)');
  });

  it('formats run out with no fielder credited', () => {
    expect(formatDismissal({ kind: 'run_out' })).toBe('run out');
  });

  it('formats the no-bowler-involved kinds without needing any names', () => {
    expect(formatDismissal({ kind: 'retired_hurt' })).toBe('retired hurt');
    expect(formatDismissal({ kind: 'retired_out' })).toBe('retired out');
    expect(formatDismissal({ kind: 'obstructing_the_field' })).toBe('obstructing the field');
    expect(formatDismissal({ kind: 'hit_ball_twice' })).toBe('hit the ball twice');
    expect(formatDismissal({ kind: 'timed_out' })).toBe('timed out');
  });

  it('degrades gracefully when a name is missing', () => {
    expect(formatDismissal({ kind: 'bowled' })).toBe('bowled');
    expect(formatDismissal({ kind: 'caught' })).toBe('caught');
  });
});
