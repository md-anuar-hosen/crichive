/**
 * Pure single-elimination bracket generation. No DB, no I/O — the route
 * layer maps the temp ids this returns onto real match rows.
 */

export interface BracketMatchSlot {
  tempId: string;
  round: number; // 1-indexed, increasing toward the final
  teamAId: string | null;
  teamBId: string | null;
  seedA: number | null; // only known immediately for a bye/round-1 team; null once a slot depends on a later winner
  seedB: number | null;
  nextTempId: string | null; // which match this one's winner feeds into
  nextSlot: 'team_a' | 'team_b' | null;
}

type SlotValue = { kind: 'team'; teamId: string; seed: number } | { kind: 'pending'; matchTempId: string } | { kind: 'empty' };

/**
 * Standard bracket seed order for a power-of-two size N: seed 1 and 2 can
 * only meet in the final, seeds 1-4 can't meet before the semi-final, etc.
 * E.g. standardSeedOrder(8) = [1,8,4,5,2,7,3,6], pairing (1v8),(4v5),(2v7),(3v6).
 */
export function standardSeedOrder(bracketSize: number): number[] {
  let seeds = [1];
  while (seeds.length < bracketSize) {
    const size = seeds.length * 2;
    const next: number[] = [];
    for (const s of seeds) {
      next.push(s, size + 1 - s);
    }
    seeds = next;
  }
  return seeds;
}

function buildRound(inputs: SlotValue[], round: number, slots: BracketMatchSlot[]): SlotValue[] {
  const outputs: SlotValue[] = [];
  const byTempId = new Map(slots.map((s) => [s.tempId, s]));

  for (let i = 0; i < inputs.length / 2; i++) {
    const a = inputs[i * 2];
    const b = inputs[i * 2 + 1];

    // A bye: the smallest bracket size >= team count means a pair can never
    // be two empty slots, only a team facing an empty one.
    if (a.kind === 'empty') {
      outputs.push(b);
      continue;
    }
    if (b.kind === 'empty') {
      outputs.push(a);
      continue;
    }

    const tempId = `r${round}-${i}`;
    const slot: BracketMatchSlot = {
      tempId,
      round,
      teamAId: a.kind === 'team' ? a.teamId : null,
      teamBId: b.kind === 'team' ? b.teamId : null,
      seedA: a.kind === 'team' ? a.seed : null,
      seedB: b.kind === 'team' ? b.seed : null,
      nextTempId: null,
      nextSlot: null,
    };
    slots.push(slot);
    byTempId.set(tempId, slot);

    if (a.kind === 'pending') {
      const prev = byTempId.get(a.matchTempId);
      if (prev) {
        prev.nextTempId = tempId;
        prev.nextSlot = 'team_a';
      }
    }
    if (b.kind === 'pending') {
      const prev = byTempId.get(b.matchTempId);
      if (prev) {
        prev.nextTempId = tempId;
        prev.nextSlot = 'team_b';
      }
    }

    outputs.push({ kind: 'pending', matchTempId: tempId });
  }

  return outputs;
}

/**
 * teamIdsBySeed[0] is seed 1 (the top seed), etc. Byes go to the top seeds
 * first if the team count isn't a power of two.
 */
export function generateSingleEliminationBracket(teamIdsBySeed: string[]): BracketMatchSlot[] {
  const n = teamIdsBySeed.length;
  if (n < 2) throw new Error('A knockout bracket needs at least 2 teams');

  let bracketSize = 1;
  while (bracketSize < n) bracketSize *= 2;

  const order = standardSeedOrder(bracketSize);
  let inputs: SlotValue[] = order.map((seed) => (seed <= n ? { kind: 'team', teamId: teamIdsBySeed[seed - 1], seed } : { kind: 'empty' }));

  const slots: BracketMatchSlot[] = [];
  let round = 1;
  while (inputs.length > 1) {
    inputs = buildRound(inputs, round, slots);
    round++;
  }
  return slots;
}

/** e.g. roundName(1, 4) => 'Round of 16', roundName(3, 4) => 'Semi-Finals', roundName(4, 4) => 'Final'. */
export function roundName(round: number, totalRounds: number): string {
  const roundsFromFinal = totalRounds - round;
  if (roundsFromFinal === 0) return 'Final';
  if (roundsFromFinal === 1) return 'Semi-Finals';
  if (roundsFromFinal === 2) return 'Quarter-Finals';
  const teamsEnteringThisRound = 2 ** (roundsFromFinal + 1);
  return `Round of ${teamsEnteringThisRound}`;
}
