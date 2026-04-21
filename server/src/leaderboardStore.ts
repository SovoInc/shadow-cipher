// PRC-1 / PRC-6 leaderboard + achievements helpers.
// Players are stored in kvStore.ts (Upstash Redis). This module adds the
// achievement catalogue, channel definitions, and ranking logic on top.

import { getPlayers as kvGetPlayers, type PlayerRecord } from './kvStore.js';

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

export const APP_NAME = 'ShadowCipher';
export const APP_DESCRIPTION =
  'ZK-based codebreaker game on Midnight Network. Crack the 4-color secret code using zero-knowledge proofs.';

export const achievements: Achievement[] = [
  { name: 'first_crack', displayName: 'First Crack', description: 'Complete your first game.', isActive: true },
  { name: 'perfect_solver', displayName: 'Perfect Solver', description: 'Solve the cipher in 4 or fewer attempts.', isActive: true },
  { name: 'on_chain_player', displayName: 'On-Chain Player', description: 'Complete a game in Midnight Mode (on-chain).', isActive: true },
  { name: 'persistence', displayName: 'Persistence', description: 'Play 10 games.', isActive: true },
  { name: 'speed_run', displayName: 'Speed Run', description: 'Solve the cipher in under 60 seconds.', isActive: true },
];

export const channels: Channel[] = [
  { id: 'leaderboard', name: 'Fewest Attempts', description: 'Best game solved in fewest attempts (all-time best).', scoreUnit: 'Attempts', sortOrder: 'ASC' },
  { id: 'transactions', name: 'Games Played', description: 'Total games completed.', scoreUnit: 'Games', sortOrder: 'DESC' },
];

export async function getPlayers(): Promise<PlayerRecord[]> {
  return kvGetPlayers();
}

export function getPlayerAchievements(player: PlayerRecord): string[] {
  const earned: string[] = [];
  if (player.gamesWon >= 1) earned.push('first_crack');
  if (player.bestScore > 0 && player.bestScore <= 4) earned.push('perfect_solver');
  if (player.mode === 'on-chain') earned.push('on_chain_player');
  if (player.gamesPlayed >= 10) earned.push('persistence');
  return earned;
}

export async function getRankedEntries(channelId: string, limit = 50, offset = 0) {
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) return null;

  const players = await getPlayers();

  let sorted: PlayerRecord[];
  if (channelId === 'leaderboard') {
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
