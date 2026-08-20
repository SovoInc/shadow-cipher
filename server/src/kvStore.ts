// SQLite-backed game pool, sessions, and score recording.
// Single file, no SaaS, no VPC. DB lives at SQLITE_PATH (default ./data.db in cwd).
// The module name stays "kvStore" so existing imports keep working.

import Database from 'better-sqlite3';
import { randomUUID, randomBytes, randomInt } from 'crypto';
import path from 'node:path';
import fs from 'node:fs';

// ── Connection ────────────────────────────────────────────────────────────

const dbPath = process.env.SQLITE_PATH ?? path.resolve(process.cwd(), 'data.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS pool (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id       TEXT    NOT NULL,
    code          TEXT    NOT NULL,
    salt          TEXT    NOT NULL,
    contract_addr TEXT    NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id    TEXT    PRIMARY KEY,
    code          TEXT    NOT NULL,
    salt          TEXT    NOT NULL,
    game_id       TEXT,
    contract_addr TEXT,
    guesses       TEXT    NOT NULL DEFAULT '[]',
    started_at    TEXT    NOT NULL,
    expires_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS players (
    address       TEXT    PRIMARY KEY,
    display_name  TEXT    NOT NULL,
    best_score    INTEGER NOT NULL DEFAULT 0,
    games_played  INTEGER NOT NULL DEFAULT 0,
    games_won     INTEGER NOT NULL DEFAULT 0,
    mode          TEXT    NOT NULL DEFAULT 'demo',
    last_active   TEXT    NOT NULL
  );
`);

// ── Game Pool ─────────────────────────────────────────────────────────────

export interface PoolEntry {
  gameId: string;
  code: [number, number, number, number];
  salt: string;
  contractAddress: string;
}

const insertPool = db.prepare<[string, string, string, string]>(
  'INSERT INTO pool (game_id, code, salt, contract_addr) VALUES (?, ?, ?, ?)',
);
const popPool = db.prepare<[]>(
  'SELECT id, game_id, code, salt, contract_addr FROM pool ORDER BY id ASC LIMIT 1',
);
const deletePool = db.prepare<[number]>('DELETE FROM pool WHERE id = ?');
const poolSize = db.prepare<[]>('SELECT COUNT(*) AS n FROM pool');

const claimTxn = db.transaction((): PoolEntry | null => {
  const row = popPool.get() as
    | { id: number; game_id: string; code: string; salt: string; contract_addr: string }
    | undefined;
  if (!row) return null;
  deletePool.run(row.id);
  return {
    gameId: row.game_id,
    code: JSON.parse(row.code) as [number, number, number, number],
    salt: row.salt,
    contractAddress: row.contract_addr,
  };
});

export async function addToPool(entry: PoolEntry): Promise<void> {
  insertPool.run(entry.gameId, JSON.stringify(entry.code), entry.salt, entry.contractAddress);
}

export async function claimPoolEntry(): Promise<PoolEntry | null> {
  return claimTxn();
}

export async function getPoolSize(): Promise<number> {
  const row = poolSize.get() as { n: number };
  return row.n;
}

// ── Sessions ──────────────────────────────────────────────────────────────

export interface GameSession {
  sessionId: string;
  code: [number, number, number, number];
  salt: string;
  gameId: string | null;
  contractAddress: string | null;
  guesses: Array<{ guess: [number, number, number, number]; black: number; white: number }>;
  startedAt: string;
}

const SESSION_TTL_SECONDS = 3600;

const insertSession = db.prepare<[string, string, string, string | null, string | null, string, string, number]>(
  `INSERT INTO sessions (session_id, code, salt, game_id, contract_addr, guesses, started_at, expires_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
const selectSession = db.prepare<[string, number]>(
  `SELECT session_id, code, salt, game_id, contract_addr, guesses, started_at
   FROM sessions WHERE session_id = ? AND expires_at > ?`,
);
const updateSessionStmt = db.prepare<[string, string, number, string]>(
  `UPDATE sessions SET guesses = ?, code = ?, expires_at = ? WHERE session_id = ?`,
);
const deleteSessionStmt = db.prepare<[string]>('DELETE FROM sessions WHERE session_id = ?');
const sweepSessionsStmt = db.prepare<[number]>('DELETE FROM sessions WHERE expires_at <= ?');
const countExpiredOnChainStmt = db.prepare<[number]>(
  'SELECT COUNT(*) AS n FROM sessions WHERE expires_at <= ? AND contract_addr IS NOT NULL',
);

// Called with the number of expired on-chain sessions the sweep removed, so the
// in-memory active-session counter (poolWorker.ts) can be released — otherwise
// abandoned games would pause pool refill forever.
let onSessionsExpired: ((count: number) => void) | undefined;
export function setOnSessionsExpired(fn: (count: number) => void): void {
  onSessionsExpired = fn;
}

// Sweep expired sessions every 10 min.
setInterval(() => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const { n: expiredOnChain } = countExpiredOnChainStmt.get(now) as { n: number };
    sweepSessionsStmt.run(now);
    if (expiredOnChain > 0) onSessionsExpired?.(expiredOnChain);
  } catch { /* ignore */ }
}, 10 * 60 * 1000).unref();

export async function createSession(
  code: [number, number, number, number],
  salt: string,
  gameId: string | null,
  contractAddress: string | null,
): Promise<GameSession> {
  const sessionId = randomUUID();
  const startedAt = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const session: GameSession = { sessionId, code, salt, gameId, contractAddress, guesses: [], startedAt };
  insertSession.run(sessionId, JSON.stringify(code), salt, gameId, contractAddress, '[]', startedAt, expiresAt);
  return session;
}

export async function getSession(sessionId: string): Promise<GameSession | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = selectSession.get(sessionId, now) as
    | {
        session_id: string;
        code: string;
        salt: string;
        game_id: string | null;
        contract_addr: string | null;
        guesses: string;
        started_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    code: JSON.parse(row.code) as [number, number, number, number],
    salt: row.salt,
    gameId: row.game_id,
    contractAddress: row.contract_addr,
    guesses: JSON.parse(row.guesses),
    startedAt: row.started_at,
  };
}

export async function updateSession(session: GameSession): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  updateSessionStmt.run(JSON.stringify(session.guesses), JSON.stringify(session.code), expiresAt, session.sessionId);
}

export async function deleteSession(sessionId: string): Promise<void> {
  deleteSessionStmt.run(sessionId);
}

// ── Scores ────────────────────────────────────────────────────────────────

export interface PlayerRecord {
  address: string;
  displayName: string;
  bestScore: number;
  gamesPlayed: number;
  gamesWon: number;
  mode: 'demo' | 'on-chain';
  lastActive: string;
}

const selectAllPlayers = db.prepare<[]>(
  `SELECT address, display_name, best_score, games_played, games_won, mode, last_active FROM players`,
);
const selectPlayer = db.prepare<[string]>(
  `SELECT address, display_name, best_score, games_played, games_won, mode, last_active
   FROM players WHERE address = ?`,
);
const upsertPlayer = db.prepare<[string, string, number, number, number, string, string]>(
  `INSERT INTO players (address, display_name, best_score, games_played, games_won, mode, last_active)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(address) DO UPDATE SET
     display_name = excluded.display_name,
     best_score   = excluded.best_score,
     games_played = excluded.games_played,
     games_won    = excluded.games_won,
     mode         = excluded.mode,
     last_active  = excluded.last_active`,
);

type PlayerRow = {
  address: string;
  display_name: string;
  best_score: number;
  games_played: number;
  games_won: number;
  mode: string;
  last_active: string;
};

function rowToPlayer(r: PlayerRow): PlayerRecord {
  return {
    address: r.address,
    displayName: r.display_name,
    bestScore: r.best_score,
    gamesPlayed: r.games_played,
    gamesWon: r.games_won,
    mode: r.mode === 'on-chain' ? 'on-chain' : 'demo',
    lastActive: r.last_active,
  };
}

export async function getPlayers(): Promise<PlayerRecord[]> {
  return (selectAllPlayers.all() as PlayerRow[]).map(rowToPlayer);
}

export async function recordScore(
  address: string,
  displayName: string,
  attempts: number,
  won: boolean,
  mode: 'demo' | 'on-chain',
): Promise<PlayerRecord> {
  const existing = selectPlayer.get(address) as PlayerRow | undefined;
  const nowIso = new Date().toISOString();

  let player: PlayerRecord;
  if (existing) {
    const current = rowToPlayer(existing);
    player = {
      address: current.address,
      displayName: displayName || current.displayName,
      bestScore: won && (current.bestScore === 0 || attempts < current.bestScore) ? attempts : current.bestScore,
      gamesPlayed: current.gamesPlayed + 1,
      gamesWon: current.gamesWon + (won ? 1 : 0),
      mode: current.mode,
      lastActive: nowIso,
    };
  } else {
    player = {
      address,
      displayName,
      bestScore: won ? attempts : 0,
      gamesPlayed: 1,
      gamesWon: won ? 1 : 0,
      mode,
      lastActive: nowIso,
    };
  }

  upsertPlayer.run(
    player.address,
    player.displayName,
    player.bestScore,
    player.gamesPlayed,
    player.gamesWon,
    player.mode,
    player.lastActive,
  );
  return player;
}

const updatePlayerNameStmt = db.prepare<[string, string, string]>(
  'UPDATE players SET display_name = ?, last_active = ? WHERE address = ?',
);

/**
 * Update only the display name of an existing player row (arcade name entry
 * after game over). Never touches gamesPlayed/gamesWon/bestScore — the score
 * itself is recorded exclusively by /api/declare via recordScore().
 */
export async function updateDisplayName(address: string, displayName: string): Promise<PlayerRecord | null> {
  updatePlayerNameStmt.run(displayName, new Date().toISOString(), address);
  const row = selectPlayer.get(address) as PlayerRow | undefined;
  return row ? rowToPlayer(row) : null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function generateRandomCode(): [number, number, number, number] {
  return [randomInt(0, 6), randomInt(0, 6), randomInt(0, 6), randomInt(0, 6)];
}

export function generateRandomSalt(): string {
  return randomBytes(32).toString('hex');
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function calculatePegs(
  guess: [number, number, number, number],
  secret: [number, number, number, number],
): { black: number; white: number } {
  let black = 0;
  let white = 0;
  const secretCopy = [...secret];
  const guessCopy = [...guess];

  for (let i = 0; i < 4; i++) {
    if (guessCopy[i] === secretCopy[i]) {
      black++;
      secretCopy[i] = -1;
      guessCopy[i] = -2;
    }
  }

  for (let i = 0; i < 4; i++) {
    if (guessCopy[i] >= 0) {
      const idx = secretCopy.indexOf(guessCopy[i]);
      if (idx !== -1) {
        white++;
        secretCopy[idx] = -1;
      }
    }
  }

  return { black, white };
}
