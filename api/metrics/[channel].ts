import type { VercelRequest, VercelResponse } from '@vercel/node';
import { channels, getRankedEntries } from '../_lib/store.js';

// PRC-6 Endpoint 2: GET /api/metrics/:channel
// Returns ranked entries for a specific channel.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { channel } = req.query;
  const channelId = Array.isArray(channel) ? channel[0] : channel;

  if (!channelId) {
    return res.status(400).json({ error: 'Missing channel parameter' });
  }

  // Handle /metrics/users/* — Vercel routes [channel] before users/[address]
  if (channelId === 'users') {
    return res.status(400).json({ error: 'Use /api/metrics/users/{address} for user profiles' });
  }

  const channelDef = channels.find((c) => c.id === channelId);
  if (!channelDef) {
    return res.status(404).json({ error: `Channel '${channelId}' not found` });
  }

  const limit = Math.min(Number(req.query.limit) || 50, 1000);
  const offset = Number(req.query.offset) || 0;

  const result = await getRankedEntries(channelId, limit, offset);
  if (!result) {
    return res.status(404).json({ error: `Channel '${channelId}' not found` });
  }

  const now = new Date().toISOString();
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

  const response: Record<string, unknown> = {
    channel: channelId,
    totalPlayers: result.totalPlayers,
    totalScore: result.totalScore,
    entries: result.entries,
  };

  // Cumulative channels include date range
  if (channelDef.type !== 'snapshot') {
    response.startDate = (req.query.startDate as string) || oneYearAgo;
    response.endDate = (req.query.endDate as string) || now;
  }

  res.json(response);
}
