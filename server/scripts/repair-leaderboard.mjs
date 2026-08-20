#!/usr/bin/env node
/**
 * Repair leaderboard rows inflated by the pre-fix double-recording bug.
 *
 * Before the fix, one finished game was recorded twice: POST /api/declare
 * recorded it server-side, and the client then POSTed /api/metrics/scores,
 * which recorded it again. The two paths did not always agree on the address,
 * so rows are not uniformly doubled:
 *
 *   on-chain play  server key: address (16-char wallet slice)
 *                  client key: displayAddress.slice(0, 16)   → SAME key
 *                  ⇒ that row counted every game twice.
 *
 *   demo play      server key: `DMO_${displayName || 'ANO'}` — declare usually
 *                              ran before the name overlay, so 'DMO_ANO'
 *                  client key: `DMO_${arcadeName}`
 *                  ⇒ ONE game split across two rows, each counting it once.
 *
 * So halving every row would be wrong twice over: it would under-count the
 * split demo rows, and it cannot tell a genuine 2-game player from a
 * double-counted 1-game player.
 *
 * What this script does, therefore, is deliberately conservative:
 *
 *   --mode=halve   halve games_played / games_won on rows that were subject to
 *                  the same-key double count (on-chain rows, and demo rows whose
 *                  counters are even), leaving best_score alone — best_score was
 *                  a min() over attempts, so it never inflated.
 *
 *   --mode=reset   delete every player row and start clean. Correct if the
 *                  leaderboard is not treated as durable history; this is the
 *                  only option that is guaranteed to leave no wrong number.
 *
 * Neither mode can reunite a split demo player: the DMO_ANO row and the
 * DMO_<name> row are indistinguishable from two different people. --mode=halve
 * reports them so they can be judged by hand.
 *
 * Always writes a timestamped .bak copy of the database first, and always runs
 * as a single transaction. Pass --apply to commit; the default is a dry run.
 *
 * Usage, on the box:
 *   node server/scripts/repair-leaderboard.mjs --db=/opt/shadow-cipher/data.db
 *   node server/scripts/repair-leaderboard.mjs --db=/opt/shadow-cipher/data.db --mode=halve --apply
 */

import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';

const args = new Map(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const dbPath = args.get('db');
const mode = args.get('mode') ?? 'report';
const apply = args.has('apply');

if (!dbPath || dbPath === true) {
  console.error('Usage: repair-leaderboard.mjs --db=<path> [--mode=report|halve|reset] [--apply]');
  process.exit(2);
}
if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(2);
}
if (!['report', 'halve', 'reset'].includes(mode)) {
  console.error(`Unknown mode "${mode}" — expected report, halve, or reset.`);
  process.exit(2);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

// Running --mode=halve twice would halve already-corrected rows and destroy
// good data, so record that the repair ran and refuse to halve again.
db.exec(`
  CREATE TABLE IF NOT EXISTS leaderboard_repair (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    mode       TEXT    NOT NULL,
    applied_at TEXT    NOT NULL,
    rows_changed INTEGER NOT NULL
  );
`);
const priorRepair = db.prepare('SELECT mode, applied_at, rows_changed FROM leaderboard_repair WHERE id = 1').get();

const players = db.prepare(
  'SELECT address, display_name, best_score, games_played, games_won, mode FROM players ORDER BY games_played DESC',
).all();

if (players.length === 0) {
  console.log('No player rows — nothing to repair.');
  process.exit(0);
}

const isDemo = p => p.address.startsWith('DMO_');
const anonymous = players.filter(p => p.address === 'DMO_ANO');
const namedDemo = players.filter(p => isDemo(p) && p.address !== 'DMO_ANO');

// Rows the same-key double count applies to: on-chain rows always, and demo
// rows whose counters are even (odd counters mean at least one leg was missed,
// so halving would invent a number rather than restore one).
const halveable = players.filter(p => {
  if (!isDemo(p)) return true;
  return p.games_played % 2 === 0 && p.games_won % 2 === 0 && p.games_played > 0;
});
const skipped = players.filter(p => !halveable.includes(p));

const total = players.reduce((n, p) => n + p.games_played, 0);
const totalWon = players.reduce((n, p) => n + p.games_won, 0);

console.log(`Database: ${dbPath}`);
console.log(`Mode:     ${mode}${apply ? ' (APPLY)' : ' (dry run)'}\n`);
console.log(`${players.length} player rows — ${total} games played, ${totalWon} won.\n`);

if (priorRepair) {
  console.log(`A repair already ran on this database: mode=${priorRepair.mode}, ` +
    `at ${priorRepair.applied_at}, ${priorRepair.rows_changed} row(s) changed.`);
  if (mode === 'halve') {
    console.error('\nRefusing to halve again — that would halve already-corrected rows and');
    console.error('destroy good data. Restore a .bak copy first if the earlier run was wrong.');
    process.exit(1);
  }
  console.log();
}

if (anonymous.length && namedDemo.length) {
  console.log('Split demo players — a DMO_ANO row exists alongside named demo rows.');
  console.log('One game may be spread across two of these; they cannot be reunited');
  console.log('automatically, since two rows look the same as two players:');
  for (const p of [...anonymous, ...namedDemo]) {
    console.log(`  ${p.address.padEnd(24)} ${String(p.games_played).padStart(4)} played  ${String(p.games_won).padStart(4)} won`);
  }
  console.log();
}

if (mode === 'report') {
  console.log(`Would halve ${halveable.length} row(s); would leave ${skipped.length} untouched.`);
  if (skipped.length) {
    console.log('\nLeft untouched (odd counters — at least one leg was never recorded):');
    for (const p of skipped) {
      console.log(`  ${p.address.padEnd(24)} ${String(p.games_played).padStart(4)} played  ${String(p.games_won).padStart(4)} won`);
    }
  }
  console.log('\nRe-run with --mode=halve or --mode=reset, and add --apply to commit.');
  process.exit(0);
}

if (apply) {
  const backup = `${dbPath}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  copyFileSync(dbPath, backup);
  console.log(`Backup written: ${backup}\n`);
}

const recordRepair = db.prepare(
  `INSERT INTO leaderboard_repair (id, mode, applied_at, rows_changed) VALUES (1, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, applied_at = excluded.applied_at,
     rows_changed = excluded.rows_changed`,
);

if (mode === 'reset') {
  console.log(`${apply ? 'Deleting' : 'Would delete'} all ${players.length} player row(s).`);
  if (apply) {
    db.transaction(() => {
      db.prepare('DELETE FROM players').run();
      recordRepair.run('reset', new Date().toISOString(), players.length);
    })();
    console.log('Done — the leaderboard is empty and will rebuild from real play.');
  }
  process.exit(0);
}

// mode === 'halve'
const update = db.prepare('UPDATE players SET games_played = ?, games_won = ? WHERE address = ?');
const changes = halveable.map(p => ({
  address: p.address,
  fromPlayed: p.games_played,
  toPlayed: Math.max(1, Math.floor(p.games_played / 2)),
  fromWon: p.games_won,
  toWon: Math.floor(p.games_won / 2),
}));

for (const c of changes) {
  console.log(
    `  ${c.address.padEnd(24)} played ${String(c.fromPlayed).padStart(4)} → ${String(c.toPlayed).padStart(4)}` +
    `   won ${String(c.fromWon).padStart(4)} → ${String(c.toWon).padStart(4)}`,
  );
}

if (apply) {
  db.transaction(() => {
    for (const c of changes) update.run(c.toPlayed, c.toWon, c.address);
    recordRepair.run('halve', new Date().toISOString(), changes.length);
  })();
  const after = db.prepare('SELECT SUM(games_played) played, SUM(games_won) won FROM players').get();
  console.log(`\nDone — ${changes.length} row(s) updated. Now ${after.played} games played, ${after.won} won.`);
  console.log('best_score was left alone: it was a minimum over attempts, so it never inflated.');
} else {
  console.log(`\nDry run — ${changes.length} row(s) would change. Add --apply to commit.`);
}
