/**
 * calculatePegs is the core game rule: it turns a guess into black pegs (right
 * colour, right position) and white pegs (right colour, wrong position).
 *
 * Duplicate colours are where Mastermind peg counting goes wrong quietly — a
 * naive implementation double-counts a repeated guess colour against a single
 * occurrence in the secret. These tests pin that behaviour.
 */

import { describe, it, expect } from 'vitest';
import { calculatePegs } from '../kvStore.js';

type Code = [number, number, number, number];

const pegs = (guess: Code, secret: Code) => calculatePegs(guess, secret);

describe('calculatePegs — exact and empty cases', () => {
  it('scores a solved code as four black pegs', () => {
    expect(pegs([0, 1, 2, 3], [0, 1, 2, 3])).toEqual({ black: 4, white: 0 });
  });

  it('scores a fully disjoint guess as nothing', () => {
    expect(pegs([0, 0, 1, 1], [2, 2, 3, 3])).toEqual({ black: 0, white: 0 });
  });

  it('scores a full permutation as four white pegs', () => {
    expect(pegs([3, 2, 1, 0], [0, 1, 2, 3])).toEqual({ black: 0, white: 4 });
  });
});

describe('calculatePegs — mixed positions', () => {
  it('separates correct positions from correct colours', () => {
    // 0 and 3 are in place; 1 and 2 are present but swapped.
    expect(pegs([0, 2, 1, 3], [0, 1, 2, 3])).toEqual({ black: 2, white: 2 });
  });

  it('never reports more than four pegs in total', () => {
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        const guess: Code = [a, b, a, b];
        const secret: Code = [b, a, b, a];
        const { black, white } = pegs(guess, secret);
        expect(black + white).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('calculatePegs — duplicate colours', () => {
  it('does not credit a repeated guess colour twice against one occurrence', () => {
    // Secret holds a single 0; the guess offers three. Exactly one can score.
    expect(pegs([0, 0, 0, 1], [0, 2, 2, 2])).toEqual({ black: 1, white: 0 });
  });

  it('credits a repeated colour once when it is out of position', () => {
    expect(pegs([0, 0, 0, 0], [1, 1, 1, 0])).toEqual({ black: 1, white: 0 });
    expect(pegs([0, 1, 1, 1], [1, 0, 0, 0])).toEqual({ black: 0, white: 2 });
  });

  it('matches duplicates in the secret only as often as they appear', () => {
    // Two 5s in the secret, one in position; the guess has two 5s.
    expect(pegs([5, 5, 0, 1], [5, 2, 2, 5])).toEqual({ black: 1, white: 1 });
  });

  it('prefers black pegs over white for the same colour', () => {
    // A greedy white-first implementation would consume the secret's 0 and
    // under-report the exact match at index 0.
    expect(pegs([0, 0, 1, 1], [0, 2, 2, 2])).toEqual({ black: 1, white: 0 });
  });
});

describe('calculatePegs — invariants over the whole domain', () => {
  it('is symmetric in total peg count', () => {
    // Swapping guess and secret preserves black, and total pegs, for any pair.
    const codes: Code[] = [
      [0, 0, 1, 2], [3, 3, 3, 3], [0, 1, 2, 3],
      [5, 4, 5, 4], [1, 1, 2, 2], [2, 0, 0, 5],
    ];
    for (const g of codes) {
      for (const s of codes) {
        const a = pegs(g, s);
        const b = pegs(s, g);
        expect(a.black).toBe(b.black);
        expect(a.black + a.white).toBe(b.black + b.white);
      }
    }
  });

  it('reports four black pegs only for an identical code', () => {
    const codes: Code[] = [[0, 1, 2, 3], [4, 4, 5, 5], [2, 2, 2, 2]];
    for (const g of codes) {
      for (const s of codes) {
        const identical = g.every((v, i) => v === s[i]);
        expect(pegs(g, s).black === 4).toBe(identical);
      }
    }
  });
});
