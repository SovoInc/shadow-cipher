import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPlayers, channels, getRankedEntries, getPlayerAchievements } from '../../_lib/store.js';

// PRC-6 Endpoint 3: GET /api/metrics/users/:address
// Returns identity and per-channel stats for a wallet address.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { address } = req.query;
  const addr = Array.isArray(address) ? address[0] : address;

  if (!addr) {
    return res.status(400).json({ error: 'Missing address parameter' });
  }

  const players = await getPlayers();
  const player = players.find((p) => p.address === addr);
  if (!player) {
    return res.status(404).json({ error: `Player '${addr}' not found` });
  }

  const identity = {
    address: player.address,
    delegatedFrom: [] as string[],
    displayName: player.displayName || null,
  };

  // Parse channel query param (can be repeated: ?channel=leaderboard&channel=transactions)
  const channelParam = req.query.channel;
  const requestedChannels = channelParam
    ? (Array.isArray(channelParam) ? channelParam : [channelParam])
    : [];

  const response: Record<string, unknown> = {
    identity,
    achievements: getPlayerAchievements(player),
  };

  if (requestedChannels.length > 0) {
    const now = new Date().toISOString();
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const channelsData: Record<string, unknown> = {};

    for (const chId of requestedChannels) {
      const channelDef = channels.find((c) => c.id === chId);
      if (!channelDef) continue;

      const ranked = await getRankedEntries(chId);
      if (!ranked) continue;

      const entry = ranked.entries.find((e) => e.address === player.address);
      const stats = {
        score: entry?.score ?? 0,
        rank: entry?.rank ?? ranked.totalPlayers + 1,
        matchesPlayed: player.gamesPlayed,
      };

      const channelEntry: Record<string, unknown> = { stats };
      if (channelDef.type !== 'snapshot') {
        channelEntry.startDate = (req.query.startDate as string) || oneYearAgo;
        channelEntry.endDate = (req.query.endDate as string) || now;
      }

      channelsData[chId] = channelEntry;
    }

    response.channels = channelsData;
  }

  res.json(response);
}
