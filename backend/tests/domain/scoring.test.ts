import { describe, expect, it } from 'vitest';
import {
  buildScorecard,
  computeNextStrikers,
  isNextDeliveryFreeHit,
  resolveMatchResult,
  validateDelivery,
} from '../../src/domain/scoring';
import type { Delivery, DeliveryProposal, TournamentRules } from '../../src/domain/scoring';

const rules: TournamentRules = {
  oversPerInnings: 10,
  ballsPerOver: 6,
  maxOversPerBowler: 2,
  powerplayOvers: 3,
  playersPerSide: 11,
  wideRuns: 1,
  noballRuns: 1,
  freeHitAfterNoball: true,
  pointsWin: 2,
  pointsTie: 1,
  pointsNoResult: 1,
  pointsLoss: 0,
  superOverOnTie: true,
};

function makeDelivery(overrides: Partial<Delivery> & Pick<Delivery, 'sequence' | 'ballInOver'>): Delivery {
  return {
    overNumber: 0,
    strikerId: 'S1',
    nonStrikerId: 'S2',
    bowlerId: 'B1',
    runsOffBat: 0,
    extraWides: 0,
    extraNoballs: 0,
    extraByes: 0,
    extraLegbyes: 0,
    extraPenalty: 0,
    isLegalDelivery: true,
    isFreeHit: false,
    ...overrides,
  };
}

/** Six legal deliveries filling one over for a given bowler. */
function overOf(overNumber: number, bowlerId: string, seqStart: number): Delivery[] {
  return Array.from({ length: 6 }, (_, i) =>
    makeDelivery({ overNumber, bowlerId, sequence: seqStart + i, ballInOver: i + 1 }),
  );
}

describe('1. a clean over of six dot balls', () => {
  it('gives 0/0, 6 legal balls, and a bowler maiden', () => {
    const card = buildScorecard(overOf(0, 'B1', 1), rules);
    expect(card.runs).toBe(0);
    expect(card.wickets).toBe(0);
    expect(card.legalBalls).toBe(6);
    expect(card.bowlingCards.find((b) => b.playerId === 'B1')?.maidens).toBe(1);
  });
});

describe('2. wide then a legal ball', () => {
  it('counts 1 legal ball and 1 extra run', () => {
    const deliveries = [
      makeDelivery({ sequence: 1, ballInOver: 0, isLegalDelivery: false, extraWides: 1 }),
      makeDelivery({ sequence: 2, ballInOver: 1, isLegalDelivery: true }),
    ];
    const card = buildScorecard(deliveries, rules);
    expect(card.legalBalls).toBe(1);
    expect(card.extras).toBe(1);
    expect(card.runs).toBe(1);
  });
});

describe('3. no-ball with 4 off the bat', () => {
  it('credits the batter +4 runs and +1 ball faced, and the bowler +5', () => {
    const delivery = makeDelivery({ sequence: 1, ballInOver: 0, isLegalDelivery: false, extraNoballs: 1, runsOffBat: 4 });
    const card = buildScorecard([delivery], rules);
    const batter = card.battingCards.find((b) => b.playerId === 'S1')!;
    expect(batter.runs).toBe(4);
    expect(batter.ballsFaced).toBe(1);
    expect(card.legalBalls).toBe(0);
    const bowler = card.bowlingCards.find((b) => b.playerId === 'B1')!;
    expect(bowler.runsConceded).toBe(5);
  });
});

describe('4. free hit dismissal restrictions', () => {
  it('rejects bowled as invalid and accepts run out', () => {
    const bowledProposal: DeliveryProposal = { overNumber: 0, bowlerId: 'B1', isLegalDelivery: true, isFreeHit: true, wicketKind: 'bowled' };
    expect(validateDelivery(bowledProposal, [], rules).valid).toBe(false);

    const runOutProposal: DeliveryProposal = { overNumber: 0, bowlerId: 'B1', isLegalDelivery: true, isFreeHit: true, wicketKind: 'run_out' };
    expect(validateDelivery(runOutProposal, [], rules).valid).toBe(true);
  });
});

describe('5. free hit persists through an illegal delivery', () => {
  it('keeps the next ball a free hit after a free-hit wide', () => {
    const noball = makeDelivery({ sequence: 1, ballInOver: 0, isLegalDelivery: false, extraNoballs: 1 });
    expect(isNextDeliveryFreeHit(noball, rules)).toBe(true);

    const freeHitWide = makeDelivery({ sequence: 2, ballInOver: 0, isLegalDelivery: false, extraWides: 1, isFreeHit: true });
    expect(isNextDeliveryFreeHit(freeHitWide, rules)).toBe(true);
  });
});

describe('6. three leg-byes', () => {
  it('credits the team, not the batter or bowler, and swaps strike', () => {
    const delivery = makeDelivery({ sequence: 1, ballInOver: 1, extraLegbyes: 3 });
    const card = buildScorecard([delivery], rules);
    expect(card.runs).toBe(3);
    const batter = card.battingCards.find((b) => b.playerId === 'S1')!;
    expect(batter.runs).toBe(0);
    expect(batter.ballsFaced).toBe(1);
    expect(card.bowlingCards[0].runsConceded).toBe(0);

    const next = computeNextStrikers(delivery, rules);
    expect(next.strikerId).toBe('S2');
  });
});

describe('7. even runs do not swap strike mid-over, but the over boundary does', () => {
  it('leaves strike unchanged on an even-run ball, and swaps it at the end of the over regardless', () => {
    const midOver = makeDelivery({ sequence: 3, ballInOver: 3, runsOffBat: 2 });
    expect(computeNextStrikers(midOver, rules).strikerId).toBe('S1');

    const lastBallOfOver = makeDelivery({ sequence: 6, ballInOver: 6, runsOffBat: 0 });
    expect(computeNextStrikers(lastBallOfOver, rules).strikerId).toBe('S2');
  });
});

describe('8. one run on the last ball of an over', () => {
  it('swaps strike twice, so the same batter faces the next over', () => {
    const lastBallOfOver = makeDelivery({ sequence: 6, ballInOver: 6, runsOffBat: 1 });
    expect(computeNextStrikers(lastBallOfOver, rules).strikerId).toBe('S1');
  });
});

describe('9. bowler quota', () => {
  it('rejects a third over when the quota is two', () => {
    const prior = [...overOf(0, 'B1', 1), ...overOf(1, 'B1', 7)];
    const proposal: DeliveryProposal = { overNumber: 2, bowlerId: 'B1', isLegalDelivery: true, isFreeHit: false };
    const result = validateDelivery(proposal, prior, rules);
    expect(result.valid).toBe(false);
  });
});

describe('10. no consecutive overs', () => {
  it('rejects the same bowler for the very next over', () => {
    const prior = overOf(0, 'B1', 1);
    const proposal: DeliveryProposal = { overNumber: 1, bowlerId: 'B1', isLegalDelivery: true, isFreeHit: false };
    const result = validateDelivery(proposal, prior, rules);
    expect(result.valid).toBe(false);
  });
});

describe('11. run out on the non-striker with one run completed', () => {
  it('dismisses the correct batter and puts the incoming batter on strike', () => {
    const delivery = makeDelivery({
      sequence: 1,
      ballInOver: 1,
      runsOffBat: 1,
      wicketKind: 'run_out',
      playerOutId: 'S2',
    });
    const card = buildScorecard([delivery], rules);
    expect(card.battingCards.find((b) => b.playerId === 'S2')?.isOut).toBe(true);
    expect(card.battingCards.find((b) => b.playerId === 'S2')?.dismissedByBowlerId).toBeUndefined();

    const next = computeNextStrikers(delivery, rules, 'S3');
    expect(next.strikerId).toBe('S3');
    expect(next.nonStrikerId).toBe('S1');
  });
});

describe('12. ninth wicket in a 10-a-side tournament', () => {
  it('ends the innings and ignores anything bowled after', () => {
    const rules10 = { ...rules, playersPerSide: 10 };
    const deliveries: Delivery[] = [];
    for (let i = 1; i <= 9; i++) {
      deliveries.push(
        makeDelivery({
          sequence: i,
          overNumber: Math.floor((i - 1) / 6),
          ballInOver: ((i - 1) % 6) + 1,
          strikerId: `P${i}`,
          nonStrikerId: `P${i + 1}`,
          wicketKind: 'bowled',
          playerOutId: `P${i}`,
        }),
      );
    }
    // A 10th delivery that should never be reached.
    deliveries.push(makeDelivery({ sequence: 10, overNumber: 1, ballInOver: 4, strikerId: 'P10', nonStrikerId: 'P11', runsOffBat: 6 }));

    const card = buildScorecard(deliveries, rules10);
    expect(card.wickets).toBe(9);
    expect(card.legalBalls).toBe(9);
    expect(card.isComplete).toBe(true);
    expect(card.completionReason).toBe('all_out');
  });
});

describe('13. chase passing the target mid-over', () => {
  it('ends the innings on that ball with the correct win margin', () => {
    const firstInnings = { runs: 50, wickets: 5 };
    const deliveries = [
      ...Array.from({ length: 6 }, (_, i) => makeDelivery({ sequence: i + 1, overNumber: 0, ballInOver: i + 1, runsOffBat: 6 })),
      makeDelivery({ sequence: 7, overNumber: 1, ballInOver: 1, runsOffBat: 6 }),
      makeDelivery({ sequence: 8, overNumber: 1, ballInOver: 2, runsOffBat: 6 }),
      makeDelivery({ sequence: 9, overNumber: 1, ballInOver: 3, runsOffBat: 4 }), // 36+6+6+4 = 52, passes target 51
      makeDelivery({ sequence: 10, overNumber: 1, ballInOver: 4, runsOffBat: 4 }), // must be ignored
    ];

    const card = buildScorecard(deliveries, rules, { target: 51 });
    expect(card.runs).toBe(52);
    expect(card.legalBalls).toBe(9);
    expect(card.isComplete).toBe(true);
    expect(card.completionReason).toBe('target_reached');

    const outcome = resolveMatchResult(firstInnings, { runs: card.runs, wickets: card.wickets }, rules);
    expect(outcome).toEqual({ kind: 'chasing_side_won', marginWickets: 10 });
  });
});

describe('14. scores level at the end of the second innings', () => {
  it('is a tie and requires a super over when the rule is on', () => {
    const outcome = resolveMatchResult({ runs: 120, wickets: 8 }, { runs: 120, wickets: 9 }, rules);
    expect(outcome).toEqual({ kind: 'tie', superOverNeeded: true });
  });
});

describe('15. a voided delivery', () => {
  it('is excluded from every total', () => {
    const deliveries = [
      makeDelivery({ sequence: 1, ballInOver: 1, runsOffBat: 4 }),
      makeDelivery({ sequence: 2, ballInOver: 2, runsOffBat: 6, voidedAt: new Date() }),
    ];
    const card = buildScorecard(deliveries, rules);
    expect(card.runs).toBe(4);
    expect(card.legalBalls).toBe(1);
  });
});

describe('16. full innings segment replay', () => {
  // Three overs, three different bowlers, a wide, a no-ball + free hit, leg-byes,
  // a bowled, a caught and a run-out dismissal — every mechanic in one hand-computed
  // sequence, checked against the totals, every batting line and every bowling line.
  it('matches hand-computed totals and every player line', () => {
    const deliveries: Delivery[] = [
      // Over 0 — B1. P1/P2 open.
      makeDelivery({ sequence: 1, overNumber: 0, ballInOver: 1, bowlerId: 'B1', strikerId: 'P1', nonStrikerId: 'P2', runsOffBat: 1 }),
      makeDelivery({ sequence: 2, overNumber: 0, ballInOver: 2, bowlerId: 'B1', strikerId: 'P2', nonStrikerId: 'P1', runsOffBat: 0 }),
      makeDelivery({ sequence: 3, overNumber: 0, ballInOver: 2, bowlerId: 'B1', strikerId: 'P2', nonStrikerId: 'P1', isLegalDelivery: false, extraWides: 1 }),
      makeDelivery({ sequence: 4, overNumber: 0, ballInOver: 3, bowlerId: 'B1', strikerId: 'P2', nonStrikerId: 'P1', runsOffBat: 4 }),
      makeDelivery({ sequence: 5, overNumber: 0, ballInOver: 4, bowlerId: 'B1', strikerId: 'P2', nonStrikerId: 'P1', runsOffBat: 0, wicketKind: 'bowled', playerOutId: 'P2' }),
      makeDelivery({ sequence: 6, overNumber: 0, ballInOver: 5, bowlerId: 'B1', strikerId: 'P3', nonStrikerId: 'P1', runsOffBat: 2 }),
      makeDelivery({ sequence: 7, overNumber: 0, ballInOver: 6, bowlerId: 'B1', strikerId: 'P3', nonStrikerId: 'P1', runsOffBat: 1 }),

      // Over 1 — B2.
      makeDelivery({ sequence: 8, overNumber: 1, ballInOver: 1, bowlerId: 'B2', strikerId: 'P3', nonStrikerId: 'P1', runsOffBat: 0 }),
      makeDelivery({ sequence: 9, overNumber: 1, ballInOver: 1, bowlerId: 'B2', strikerId: 'P3', nonStrikerId: 'P1', isLegalDelivery: false, extraNoballs: 1, runsOffBat: 4 }),
      makeDelivery({ sequence: 10, overNumber: 1, ballInOver: 2, bowlerId: 'B2', strikerId: 'P3', nonStrikerId: 'P1', isFreeHit: true, runsOffBat: 6 }),
      makeDelivery({ sequence: 11, overNumber: 1, ballInOver: 3, bowlerId: 'B2', strikerId: 'P3', nonStrikerId: 'P1', extraByes: 3 }),
      makeDelivery({ sequence: 12, overNumber: 1, ballInOver: 4, bowlerId: 'B2', strikerId: 'P1', nonStrikerId: 'P3', runsOffBat: 0, wicketKind: 'caught', playerOutId: 'P1', fielderId: 'F1' }),
      makeDelivery({ sequence: 13, overNumber: 1, ballInOver: 5, bowlerId: 'B2', strikerId: 'P4', nonStrikerId: 'P3', runsOffBat: 1 }),
      makeDelivery({ sequence: 14, overNumber: 1, ballInOver: 6, bowlerId: 'B2', strikerId: 'P3', nonStrikerId: 'P4', runsOffBat: 2 }),

      // Over 2 — B3.
      makeDelivery({ sequence: 15, overNumber: 2, ballInOver: 1, bowlerId: 'B3', strikerId: 'P4', nonStrikerId: 'P3', runsOffBat: 0 }),
      makeDelivery({ sequence: 16, overNumber: 2, ballInOver: 2, bowlerId: 'B3', strikerId: 'P4', nonStrikerId: 'P3', runsOffBat: 1, wicketKind: 'run_out', playerOutId: 'P3' }),
      makeDelivery({ sequence: 17, overNumber: 2, ballInOver: 3, bowlerId: 'B3', strikerId: 'P5', nonStrikerId: 'P4', runsOffBat: 0 }),
      makeDelivery({ sequence: 18, overNumber: 2, ballInOver: 4, bowlerId: 'B3', strikerId: 'P5', nonStrikerId: 'P4', runsOffBat: 4 }),
      makeDelivery({ sequence: 19, overNumber: 2, ballInOver: 5, bowlerId: 'B3', strikerId: 'P5', nonStrikerId: 'P4', runsOffBat: 0 }),
      makeDelivery({ sequence: 20, overNumber: 2, ballInOver: 6, bowlerId: 'B3', strikerId: 'P5', nonStrikerId: 'P4', runsOffBat: 0 }),
    ];

    const card = buildScorecard(deliveries, rules);

    expect(card.runs).toBe(31);
    expect(card.wickets).toBe(3);
    expect(card.legalBalls).toBe(18);
    expect(card.extras).toBe(5);

    const byId = Object.fromEntries(card.battingCards.map((b) => [b.playerId, b]));
    expect(byId.P1).toMatchObject({ runs: 1, ballsFaced: 2, fours: 0, sixes: 0, isOut: true, dismissalKind: 'caught', dismissedByBowlerId: 'B2', fielderId: 'F1', position: 1 });
    expect(byId.P2).toMatchObject({ runs: 4, ballsFaced: 3, fours: 1, sixes: 0, isOut: true, dismissalKind: 'bowled', dismissedByBowlerId: 'B1', position: 2 });
    expect(byId.P3).toMatchObject({ runs: 15, ballsFaced: 7, fours: 1, sixes: 1, isOut: true, dismissalKind: 'run_out', position: 3 });
    expect(byId.P3.dismissedByBowlerId).toBeUndefined();
    expect(byId.P4).toMatchObject({ runs: 2, ballsFaced: 3, fours: 0, sixes: 0, isOut: false, position: 4 });
    expect(byId.P5).toMatchObject({ runs: 4, ballsFaced: 4, fours: 1, sixes: 0, isOut: false, position: 5 });

    const bowlerById = Object.fromEntries(card.bowlingCards.map((b) => [b.playerId, b]));
    expect(bowlerById.B1).toMatchObject({ legalBalls: 6, runsConceded: 9, wickets: 1, maidens: 0, wides: 1, noballs: 0 });
    expect(bowlerById.B2).toMatchObject({ legalBalls: 6, runsConceded: 14, wickets: 1, maidens: 0, wides: 0, noballs: 1 });
    expect(bowlerById.B3).toMatchObject({ legalBalls: 6, runsConceded: 5, wickets: 0, maidens: 0, wides: 0, noballs: 0 });

    expect(card.partnerships).toHaveLength(4);
    expect(card.partnerships[0]).toMatchObject({ wicketNumber: 1, playerAId: 'P1', playerBId: 'P2', runs: 6, balls: 4, isUnbeaten: false });
    expect(card.partnerships[1]).toMatchObject({ wicketNumber: 2, playerAId: 'P3', playerBId: 'P1', runs: 17, balls: 6, isUnbeaten: false });
    expect(card.partnerships[2]).toMatchObject({ wicketNumber: 3, playerAId: 'P4', playerBId: 'P3', runs: 4, balls: 4, isUnbeaten: false });
    expect(card.partnerships[3]).toMatchObject({ wicketNumber: 4, playerAId: 'P5', playerBId: 'P4', runs: 4, balls: 4, isUnbeaten: true });
  });
});
