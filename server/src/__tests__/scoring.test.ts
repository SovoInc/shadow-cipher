/**
 * Leaderboard integrity tests.
 *
 * Every game used to be recorded twice: /api/declare recorded it server-side and
 * the client also POSTed the result to /api/metrics/scores, so gamesPlayed and
 * gamesWon both advanced by 2 — and because the two paths keyed on different
 * addresses, one player could occupy two rows.
 *
 * recordScore is now the single write path, and the name-entry overlay uses
 * updateDisplayName, which renames a row without touching any counter. These
 * tests pin both halves of that arrangement.
 */

import { describe, it, expect } from 'vitest';
import { recordScore, updateDisplayName, getPlayers } from '../kvStore.js';

let seq = 0;
const freshAddress = () => `TEST_${process.pid}_${seq++}`;

const playerFor = async (address: string) =>
  (await getPlayers()).find(p => p.address === address);

describe('recordScore', () => {
  it('counts one game per call', async () => {
    const addr = freshAddress();
    await recordScore(addr, 'AAA', 4, true, 'demo');

    const p = await playerFor(addr);
    expect(p?.gamesPlayed).toBe(1);
    expect(p?.gamesWon).toBe(1);
  });

  it('accumulates across games without skipping or doubling', async () => {
    const addr = freshAddress();
    await recordScore(addr, 'BBB', 5, true, 'demo');
    await recordScore(addr, 'BBB', 7, false, 'demo');
    await recordScore(addr, 'BBB', 3, true, 'demo');

    const p = await playerFor(addr);
    expect(p?.gamesPlayed).toBe(3);
    expect(p?.gamesWon).toBe(2);
  });

  it('does not count a loss as a win', async () => {
    const addr = freshAddress();
    await recordScore(addr, 'CCC', 10, false, 'demo');

    const p = await playerFor(addr);
    expect(p?.gamesPlayed).toBe(1);
    expect(p?.gamesWon).toBe(0);
  });

  it('keeps one row per address', async () => {
    const addr = freshAddress();
    await recordScore(addr, 'DDD', 4, true, 'demo');
    await recordScore(addr, 'DDD', 6, false, 'demo');

    const rows = (await getPlayers()).filter(p => p.address === addr);
    expect(rows).toHaveLength(1);
  });

  it('tracks the best score as the fewest attempts among wins', async () => {
    const addr = freshAddress();
    await recordScore(addr, 'EEE', 8, true, 'demo');
    expect((await playerFor(addr))?.bestScore).toBe(8);

    await recordScore(addr, 'EEE', 5, true, 'demo');
    expect((await playerFor(addr))?.bestScore).toBe(5);

    // A worse win must not replace it...
    await recordScore(addr, 'EEE', 9, true, 'demo');
    expect((await playerFor(addr))?.bestScore).toBe(5);

    // ...and a loss must not either, however few attempts it used.
    await recordScore(addr, 'EEE', 1, false, 'demo');
    expect((await playerFor(addr))?.bestScore).toBe(5);
  });

  it('records the first win even when a loss came first', async () => {
    const addr = freshAddress();
    await recordScore(addr, 'FFF', 10, false, 'demo');
    expect((await playerFor(addr))?.bestScore).toBe(0);

    await recordScore(addr, 'FFF', 6, true, 'demo');
    expect((await playerFor(addr))?.bestScore).toBe(6);
  });
});

describe('updateDisplayName', () => {
  it('renames the row without touching any counter', async () => {
    // This is the guarantee that makes the name-entry overlay safe: it can
    // rename, but it can never inflate a score.
    const addr = freshAddress();
    await recordScore(addr, 'OLD', 4, true, 'demo');
    const before = await playerFor(addr);

    const updated = await updateDisplayName(addr, 'NEW');

    expect(updated?.displayName).toBe('NEW');
    expect(updated?.gamesPlayed).toBe(before?.gamesPlayed);
    expect(updated?.gamesWon).toBe(before?.gamesWon);
    expect(updated?.bestScore).toBe(before?.bestScore);
  });

  it('creates nothing for an address that has no game recorded', async () => {
    const addr = freshAddress();
    const result = await updateDisplayName(addr, 'GHOST');

    expect(result).toBeNull();
    expect(await playerFor(addr)).toBeUndefined();
  });

  it('leaves other players untouched', async () => {
    const a = freshAddress();
    const b = freshAddress();
    await recordScore(a, 'AAA', 4, true, 'demo');
    await recordScore(b, 'BBB', 5, true, 'demo');

    await updateDisplayName(a, 'ZZZ');

    const other = await playerFor(b);
    expect(other?.displayName).toBe('BBB');
    expect(other?.gamesPlayed).toBe(1);
  });
});

describe('one game produces one row', () => {
  it('matches the declare-then-name flow used by the demo path', async () => {
    // Reproduces the real sequence: /api/declare records the result under a
    // session-derived key, then the overlay renames that same row. The old bug
    // was a second write here, which doubled the counters.
    const addr = freshAddress();

    await recordScore(addr, addr.slice(0, 3), 4, true, 'demo');
    await updateDisplayName(addr, 'JON');

    const rows = (await getPlayers()).filter(p => p.address === addr);
    expect(rows).toHaveLength(1);
    expect(rows[0].gamesPlayed).toBe(1);
    expect(rows[0].gamesWon).toBe(1);
    expect(rows[0].displayName).toBe('JON');
  });
});
