import type { VercelRequest, VercelResponse } from '@vercel/node';
import { APP_NAME, APP_DESCRIPTION, achievements, channels, getPlayers, getPlayerAchievements } from '../_lib/store.js';

// PRC-6 Endpoint 1: GET /api/metrics
// Returns app metadata, achievements (with live percentCompleted), and channel list.
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const players = await getPlayers();
  const totalPlayers = players.length || 1;

  // Calculate live percentCompleted for each achievement
  const liveAchievements = achievements.map((a) => {
    const count = players.filter((p) => getPlayerAchievements(p).includes(a.name)).length;
    return { ...a, percentCompleted: Math.round((count / totalPlayers) * 1000) / 10 };
  });

  res.json({
    name: APP_NAME,
    description: APP_DESCRIPTION,
    achievements: liveAchievements,
    channels,
  });
}
