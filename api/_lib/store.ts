// PRC-6 metrics data store.
// Uses Vercel KV (Redis) for persistence when available, falls back to seed data.

import { kv } from '@vercel/kv';

export interface Achievement {
  name: string;
  displayName: string;
  description: string;
  isActive: boolean;
  iconURI?: string;
  percentCompleted?: number;
}

export interface Channel {
  id: string;
  name: string;
  description: string;
  scoreUnit: string;
  sortOrder: 'ASC' | 'DESC';
  type?: 'cumulative' | 'snapshot';
  auth?: boolean;
}

export interface PlayerRecord {
  address: string;
  displayName: string;
  bestScore: number; // Fewest attempts in a single win (0 = never won)
  gamesPlayed: number;
  gamesWon: number;
  mode: 'demo' | 'on-chain';
  lastActive: string;
}

// -- App metadata --

export const APP_NAME = 'ShadowCipher';
export const APP_DESCRIPTION = 'ZK-based codebreaker game on Midnight Network. Crack the 4-color secret code using zero-knowledge proofs.';

export const achievements: Achievement[] = [
  {
    name: 'first_crack',
    displayName: 'First Crack',
    description: 'Complete your first game.',
    isActive: true,
  },
  {
    name: 'perfect_solver',
    displayName: 'Perfect Solver',
    description: 'Solve the cipher in 4 or fewer attempts.',
    isActive: true,
  },
  {
    name: 'on_chain_player',
    displayName: 'On-Chain Player',
    description: 'Complete a game in Midnight Mode (on-chain).',
    isActive: true,
  },
  {
    name: 'persistence',
    displayName: 'Persistence',
    description: 'Play 10 games.',
    isActive: true,
  },
  {
    name: 'speed_run',
    displayName: 'Speed Run',
    description: 'Solve the cipher in under 60 seconds.',
    isActive: true,
  },
];

export const channels: Channel[] = [
  {
    id: 'leaderboard',
    name: 'Fewest Attempts',
    description: 'Best game solved in fewest attempts (all-time best).',
    scoreUnit: 'Attempts',
    sortOrder: 'ASC',
  },
  {
    id: 'transactions',
    name: 'Games Played',
    description: 'Total games completed.',
    scoreUnit: 'Games',
    sortOrder: 'DESC',
  },
];

// -- KV helpers --

const KV_PLAYERS_KEY = 'shadowcipher:players';

// Check if KV is configured (env vars present)
function isKvAvailable(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// Seed data for when KV isn't configured
const seedPlayers: PlayerRecord[] = [
  { address: 'DMO_AAA', displayName: 'AAA', bestScore: 4, gamesPlayed: 12, gamesWon: 10, mode: 'demo', lastActive: '2026-03-08T14:30:00.000Z' },
  { address: 'DMO_ZKP', displayName: 'ZKP', bestScore: 5, gamesPlayed: 8, gamesWon: 6, mode: 'demo', lastActive: '2026-03-07T09:15:00.000Z' },
  { address: 'DMO_MID', displayName: 'MID', bestScore: 6, gamesPlayed: 3, gamesWon: 2, mode: 'demo', lastActive: '2026-03-06T21:45:00.000Z' },
];

export async function getPlayers(): Promise<PlayerRecord[]> {
  if (!isKvAvailable()) return seedPlayers;
  try {
    const players = await kv.get<PlayerRecord[]>(KV_PLAYERS_KEY);
    return players && players.length > 0 ? players : seedPlayers;
  } catch {
    return seedPlayers;
  }
}

export async function recordScore(
  address: string,
  displayName: string,
  attempts: number,
  won: boolean,
  mode: 'demo' | 'on-chain'
): Promise<PlayerRecord> {
  const players = await getPlayers();
  let player = players.find((p) => p.address === address);

  if (player) {
    player.gamesPlayed++;
    if (won) {
      player.gamesWon++;
      if (player.bestScore === 0 || attempts < player.bestScore) {
        player.bestScore = attempts;
      }
    }
    player.lastActive = new Date().toISOString();
    if (displayName) player.displayName = displayName;
  } else {
    player = {
      address,
      displayName,
      bestScore: won ? attempts : 0,
      gamesPlayed: 1,
      gamesWon: won ? 1 : 0,
      mode,
      lastActive: new Date().toISOString(),
    };
    players.push(player);
  }

  if (isKvAvailable()) {
    try {
      await kv.set(KV_PLAYERS_KEY, players);
    } catch {
      // Silently fail if KV write fails
    }
  }

  return player;
}

// Compute achievements for a player
export function getPlayerAchievements(player: PlayerRecord): string[] {
  const earned: string[] = [];
  if (player.gamesWon >= 1) earned.push('first_crack');
  if (player.bestScore > 0 && player.bestScore <= 4) earned.push('perfect_solver');
  if (player.mode === 'on-chain') earned.push('on_chain_player');
  if (player.gamesPlayed >= 10) earned.push('persistence');
  return earned;
}

// Get ranked entries for a channel
export async function getRankedEntries(channelId: string, limit = 50, offset = 0) {
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) return null;

  const players = await getPlayers();

  let sorted: PlayerRecord[];
  if (channelId === 'leaderboard') {
    // Only include players who have won at least once, sort by fewest attempts ASC
    sorted = players.filter((p) => p.bestScore > 0).sort((a, b) => a.bestScore - b.bestScore);
  } else if (channelId === 'transactions') {
    sorted = [...players].sort((a, b) => b.gamesPlayed - a.gamesPlayed);
  } else {
    sorted = [...players];
  }

  const totalScore = channelId === 'transactions'
    ? sorted.reduce((sum, p) => sum + p.gamesPlayed, 0)
    : sorted.reduce((sum, p) => sum + p.bestScore, 0);

  const entries = sorted.slice(offset, offset + limit).map((p, i) => ({
    rank: offset + i + 1,
    address: p.address,
    displayName: p.displayName || null,
    score: channelId === 'transactions' ? p.gamesPlayed : p.bestScore,
  }));

  return { totalPlayers: sorted.length, totalScore, entries };
}
