import type { VercelRequest, VercelResponse } from '@vercel/node';
import { recordScore } from '../_lib/store.js';

// POST /api/metrics/scores
// Records a game result. Called by the frontend when a game ends.
//
// Body: { address: string, displayName: string, attempts: number, won: boolean, mode: "demo" | "on-chain" }
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address, displayName, attempts, won, mode } = req.body || {};

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'address is required' });
  }
  if (typeof attempts !== 'number' || attempts < 1 || attempts > 10) {
    return res.status(400).json({ error: 'attempts must be 1-10' });
  }
  if (typeof won !== 'boolean') {
    return res.status(400).json({ error: 'won must be a boolean' });
  }

  const player = await recordScore(
    address,
    displayName || address.slice(0, 3),
    attempts,
    won,
    mode === 'on-chain' ? 'on-chain' : 'demo'
  );

  res.json({
    recorded: true,
    player: {
      address: player.address,
      displayName: player.displayName,
      bestScore: player.bestScore,
      gamesPlayed: player.gamesPlayed,
      gamesWon: player.gamesWon,
    },
  });
}
