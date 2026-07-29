import type { DismissalKind } from './types';

export interface DismissalDetail {
  kind: DismissalKind;
  bowlerId?: string;
  bowlerName?: string;
  fielderId?: string;
  fielderName?: string;
}

/**
 * Standard cricket scorecard dismissal notation, e.g. "c Rahman b Islam",
 * "lbw b Islam", "run out (Rahman)". Degrades to a bare kind label if a
 * name is missing (shouldn't normally happen for a completed delivery).
 */
export function formatDismissal({ kind, bowlerId, bowlerName, fielderId, fielderName }: DismissalDetail): string {
  switch (kind) {
    case 'bowled':
      return bowlerName ? `b ${bowlerName}` : 'bowled';
    case 'lbw':
      return bowlerName ? `lbw b ${bowlerName}` : 'lbw';
    case 'caught':
      if (fielderId && bowlerId && fielderId === bowlerId) return bowlerName ? `c & b ${bowlerName}` : 'c & b';
      if (fielderName && bowlerName) return `c ${fielderName} b ${bowlerName}`;
      return bowlerName ? `c b ${bowlerName}` : 'caught';
    case 'stumped':
      return fielderName && bowlerName ? `st ${fielderName} b ${bowlerName}` : 'stumped';
    case 'hit_wicket':
      return bowlerName ? `hit wicket b ${bowlerName}` : 'hit wicket';
    case 'run_out':
      return fielderName ? `run out (${fielderName})` : 'run out';
    case 'retired_hurt':
      return 'retired hurt';
    case 'retired_out':
      return 'retired out';
    case 'obstructing_the_field':
      return 'obstructing the field';
    case 'hit_ball_twice':
      return 'hit the ball twice';
    case 'timed_out':
      return 'timed out';
  }
}
