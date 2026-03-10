import type { VercelRequest, VercelResponse } from '@vercel/node';
import { achievements, getPlayers, getPlayerAchievements } from '../../_lib/store.js';

// PRC-1 Endpoint: GET /api/achievements/public/list
// Returns all available achievements with live percentCompleted.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const players = await getPlayers();
  const totalPlayers = players.length || 1;

  let filtered = achievements;

  const isActive = req.query.isActive;
  if (isActive === 'true') {
    filtered = filtered.filter((a) => a.isActive);
  } else if (isActive === 'false') {
    filtered = filtered.filter((a) => !a.isActive);
  }

  const liveAchievements = filtered.map((a) => {
    const count = players.filter((p) => getPlayerAchievements(p).includes(a.name)).length;
    return { ...a, percentCompleted: Math.round((count / totalPlayers) * 1000) / 10 };
  });

  res.json({
    id: 'shadowcipher',
    name: 'ShadowCipher',
    version: '1.1',
    block: 0,
    caip2: 'midnight:preview',
    time: new Date().toISOString(),
    achievements: liveAchievements,
  });
}
