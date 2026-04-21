// Express routes ported from the former Vercel /api/metrics/* and /api/achievements/* handlers.
// Mounted by sponsor-server.ts.

import { Router, type Request, type Response } from 'express';
import { recordScore } from './kvStore.js';
import {
  APP_NAME,
  APP_DESCRIPTION,
  achievements,
  channels,
  getPlayers,
  getPlayerAchievements,
  getRankedEntries,
} from './leaderboardStore.js';

export function buildLeaderboardRouter(): Router {
  const router = Router();

  // GET /api/metrics — app metadata + live achievement percentages + channel list
  router.get('/metrics', async (_req: Request, res: Response) => {
    const players = await getPlayers();
    const totalPlayers = players.length || 1;
    const liveAchievements = achievements.map((a) => {
      const count = players.filter((p) => getPlayerAchievements(p).includes(a.name)).length;
      return { ...a, percentCompleted: Math.round((count / totalPlayers) * 1000) / 10 };
    });
    res.json({ name: APP_NAME, description: APP_DESCRIPTION, achievements: liveAchievements, channels });
  });

  // POST /api/metrics/scores — record a game result (client-reported, trusted-ish)
  router.post('/metrics/scores', async (req: Request, res: Response) => {
    const { address, displayName, attempts, won, mode } = req.body || {};
    if (!address || typeof address !== 'string') return res.status(400).json({ error: 'address is required' });
    if (typeof attempts !== 'number' || attempts < 1 || attempts > 10) return res.status(400).json({ error: 'attempts must be 1-10' });
    if (typeof won !== 'boolean') return res.status(400).json({ error: 'won must be a boolean' });

    const player = await recordScore(
      address,
      displayName || address.slice(0, 3),
      attempts,
      won,
      mode === 'on-chain' ? 'on-chain' : 'demo',
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
  });

  // GET /api/metrics/users/:address — identity + per-channel stats for a wallet
  router.get('/metrics/users/:address', async (req: Request, res: Response) => {
    const addr = req.params.address;
    if (!addr) return res.status(400).json({ error: 'Missing address parameter' });

    const players = await getPlayers();
    const player = players.find((p) => p.address === addr);
    if (!player) return res.status(404).json({ error: `Player '${addr}' not found` });

    const channelParam = req.query.channel;
    const requestedChannels = channelParam
      ? Array.isArray(channelParam) ? (channelParam as string[]) : [channelParam as string]
      : [];

    const response: Record<string, unknown> = {
      identity: { address: player.address, delegatedFrom: [] as string[], displayName: player.displayName || null },
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
  });

  // GET /api/metrics/:channel — ranked entries for a channel (leaderboard, transactions)
  // Registered AFTER /metrics/users/:address and /metrics/scores so those static/specific
  // paths win; Express matches in declaration order.
  router.get('/metrics/:channel', async (req: Request, res: Response) => {
    const channelId = String(req.params.channel ?? '');
    if (!channelId) return res.status(400).json({ error: 'Missing channel parameter' });
    if (channelId === 'users') return res.status(400).json({ error: 'Use /api/metrics/users/{address} for user profiles' });

    const channelDef = channels.find((c) => c.id === channelId);
    if (!channelDef) return res.status(404).json({ error: `Channel '${channelId}' not found` });

    const limit = Math.min(Number(req.query.limit) || 50, 1000);
    const offset = Number(req.query.offset) || 0;

    const result = await getRankedEntries(channelId, limit, offset);
    if (!result) return res.status(404).json({ error: `Channel '${channelId}' not found` });

    const now = new Date().toISOString();
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const response: Record<string, unknown> = {
      channel: channelId,
      totalPlayers: result.totalPlayers,
      totalScore: result.totalScore,
      entries: result.entries,
    };
    if (channelDef.type !== 'snapshot') {
      response.startDate = (req.query.startDate as string) || oneYearAgo;
      response.endDate = (req.query.endDate as string) || now;
    }
    res.json(response);
  });

  // GET /api/achievements/public/list — all achievements with live percentCompleted
  router.get('/achievements/public/list', async (req: Request, res: Response) => {
    const players = await getPlayers();
    const totalPlayers = players.length || 1;
    let filtered = achievements;
    const isActive = req.query.isActive;
    if (isActive === 'true') filtered = filtered.filter((a) => a.isActive);
    else if (isActive === 'false') filtered = filtered.filter((a) => !a.isActive);

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
  });

  // GET /api/achievements/wallet/:wallet — completed achievements for a wallet
  router.get('/achievements/wallet/:wallet', async (req: Request, res: Response) => {
    const addr = req.params.wallet;
    if (!addr) return res.status(400).json({ error: 'Missing wallet parameter' });

    const players = await getPlayers();
    const player = players.find((p) => p.address === addr);
    if (!player) return res.status(404).json({ error: `Wallet '${addr}' not found` });

    const earned = getPlayerAchievements(player);
    const nameFilter = req.query.name;
    const filterNames = nameFilter
      ? Array.isArray(nameFilter) ? (nameFilter as string[]) : (nameFilter as string).split(',')
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
  });

  return router;
}
