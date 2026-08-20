/**
 * Tests for scripts/repair-leaderboard.mjs — the one-off repair for rows
 * inflated by the pre-fix double-recording bug.
 *
 * This touches live client-visible data, so the properties that matter are:
 * it corrects the rows the same-key double count actually affected, it leaves
 * ambiguous rows alone rather than inventing numbers, it never touches
 * best_score, and it cannot be run twice into already-corrected data.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/repair-leaderboard.mjs', import.meta.url));
const workdir = mkdtempSync(path.join(tmpdir(), 'lb-repair-'));
let dbPath: string;
let n = 0;

type Row = { address: string; games_played: number; games_won: number; best_score: number };

const SCHEMA = `
  CREATE TABLE players (
    address       TEXT    PRIMARY KEY,
    display_name  TEXT    NOT NULL,
    best_score    INTEGER NOT NULL DEFAULT 0,
    games_played  INTEGER NOT NULL DEFAULT 0,
    games_won     INTEGER NOT NULL DEFAULT 0,
    mode          TEXT    NOT NULL DEFAULT 'demo',
    last_active   TEXT    NOT NULL
  );
`;

const seed = (rows: Array<[string, number, number, number, string]>) => {
  dbPath = path.join(workdir, `lb-${n++}.db`);
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  const ins = db.prepare(
    'INSERT INTO players (address, display_name, best_score, games_played, games_won, mode, last_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const [address, best, played, won, mode] of rows) {
    ins.run(address, address.slice(0, 3), best, played, won, mode, '2026-08-01T00:00:00Z');
  }
  db.close();
};

const run = (...args: string[]) => {
  try {
    return { out: execFileSync('node', [script, `--db=${dbPath}`, ...args], { encoding: 'utf8' }), code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 };
  }
};

const rows = (): Record<string, Row> => {
  const db = new Database(dbPath, { readonly: true });
  const all = db.prepare('SELECT address, games_played, games_won, best_score FROM players').all() as Row[];
  db.close();
  return Object.fromEntries(all.map(r => [r.address, r]));
};

afterAll(() => rmSync(workdir, { recursive: true, force: true }));

describe('halve mode', () => {
  beforeEach(() => {
    seed([
      // On-chain row: both write paths used the same key, so every game counted
      // twice — 3 real games (2 won) became 6/4.
      ['mid1qwallet000000', 4, 6, 4, 'on-chain'],
      // Demo row with even counters — same-key double count applies.
      ['DMO_BOB', 5, 4, 2, 'demo'],
      // Demo row with odd counters — a leg was never recorded, so halving
      // would invent a number.
      ['DMO_KIM', 6, 3, 1, 'demo'],
    ]);
  });

  it('restores the true count on doubled rows', () => {
    run('--mode=halve', '--apply');
    const r = rows();
    expect(r['mid1qwallet000000'].games_played).toBe(3);
    expect(r['mid1qwallet000000'].games_won).toBe(2);
    expect(r['DMO_BOB'].games_played).toBe(2);
    expect(r['DMO_BOB'].games_won).toBe(1);
  });

  it('leaves odd-countered rows untouched rather than guessing', () => {
    run('--mode=halve', '--apply');
    expect(rows()['DMO_KIM']).toMatchObject({ games_played: 3, games_won: 1 });
  });

  it('never changes best_score', () => {
    const before = rows();
    run('--mode=halve', '--apply');
    const after = rows();
    for (const addr of Object.keys(before)) {
      expect(after[addr].best_score, addr).toBe(before[addr].best_score);
    }
  });

  it('never drops a played game below one', () => {
    seed([['DMO_SOLO', 3, 1, 1, 'demo']]);
    run('--mode=halve', '--apply');
    expect(rows()['DMO_SOLO'].games_played).toBeGreaterThanOrEqual(1);
  });

  it('writes a backup before changing anything', () => {
    run('--mode=halve', '--apply');
    expect(readdirSync(workdir).some(f => f.endsWith('.bak'))).toBe(true);
  });
});

describe('re-run protection', () => {
  beforeEach(() => {
    seed([['mid1qwallet000000', 4, 6, 4, 'on-chain']]);
  });

  it('refuses a second halve and leaves the corrected data alone', () => {
    run('--mode=halve', '--apply');
    const corrected = rows();

    const second = run('--mode=halve', '--apply');
    expect(second.code).toBe(1);
    expect(second.out).toMatch(/Refusing to halve again/);
    expect(rows()).toEqual(corrected);
  });
});

describe('dry run is the default', () => {
  beforeEach(() => {
    seed([['mid1qwallet000000', 4, 6, 4, 'on-chain']]);
  });

  it('changes nothing without --apply', () => {
    const before = rows();
    run('--mode=halve');
    expect(rows()).toEqual(before);
  });

  it('reports without --mode', () => {
    const before = rows();
    const { out } = run();
    expect(out).toMatch(/Would halve/);
    expect(rows()).toEqual(before);
  });
});

describe('reset mode', () => {
  it('empties the table only with --apply', () => {
    seed([
      ['mid1qwallet000000', 4, 6, 4, 'on-chain'],
      ['DMO_BOB', 5, 4, 2, 'demo'],
    ]);

    run('--mode=reset');
    expect(Object.keys(rows())).toHaveLength(2);

    run('--mode=reset', '--apply');
    expect(Object.keys(rows())).toHaveLength(0);
  });
});

describe('argument handling', () => {
  beforeEach(() => {
    seed([['DMO_BOB', 5, 4, 2, 'demo']]);
  });

  it('rejects an unknown mode', () => {
    const { code, out } = run('--mode=bogus');
    expect(code).toBe(2);
    expect(out).toMatch(/Unknown mode/);
  });

  it('rejects a missing database', () => {
    const missing = path.join(workdir, 'does-not-exist.db');
    let code = 0;
    try {
      execFileSync('node', [script, `--db=${missing}`], { encoding: 'utf8' });
    } catch (e) {
      code = (e as { status?: number }).status ?? 1;
    }
    expect(code).toBe(2);
  });

  it('reports cleanly on an empty table', () => {
    seed([]);
    expect(existsSync(dbPath)).toBe(true);
    expect(run().out).toMatch(/nothing to repair/i);
  });
});
