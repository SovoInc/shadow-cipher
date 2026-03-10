import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPlayers, achievements, getPlayerAchievements } from '../../_lib/store.js';

// PRC-1 Endpoint: GET /api/achievements/wallet/:wallet
// Returns completed achievements for a wallet address.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { wallet } = req.query;
  const addr = Array.isArray(wallet) ? wallet[0] : wallet;

  if (!addr) {
    return res.status(400).json({ error: 'Missing wallet parameter' });
  }

  const players = await getPlayers();
  const player = players.find((p) => p.address === addr);
  if (!player) {
    return res.status(404).json({ error: `Wallet '${addr}' not found` });
  }

  const earned = getPlayerAchievements(player);

  // Optional name filter: ?name=first_crack,perfect_solver
  const nameFilter = req.query.name;
  const filterNames = nameFilter
    ? (Array.isArray(nameFilter) ? nameFilter : nameFilter.split(','))
    : null;

  const allAchievements = achievements
    .map((a) => {
      if (filterNames && !filterNames.includes(a.name)) return null;
      const completed = earned.includes(a.name);
      return {
        name: a.name,
        completed,
        completedDate: completed ? player.lastActive : undefined,
      };
    })
    .filter(Boolean);

  res.json({
    block: 0,
    caip2: 'midnight:preview',
    time: new Date().toISOString(),
    wallet: player.address,
    userName: player.displayName || undefined,
    completed: earned.length,
    achievements: allAchievements,
  });
}
