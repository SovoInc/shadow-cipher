/**
 * API compatibility tests.
 *
 * The leaderboard and achievement endpoints are consumed by an external site,
 * so their paths are a published contract: removing or renaming one breaks a
 * caller we do not control. POST /api/metrics/scores in particular was kept
 * (rather than deleted) when scoring moved server-side, and it must stay
 * mounted while no longer writing client-supplied results.
 */

import { describe, it, expect } from 'vitest';
import { buildLeaderboardRouter } from '../leaderboardRoutes.js';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

const routes = () =>
  (buildLeaderboardRouter().stack as unknown as Layer[])
    .filter(l => l.route)
    .map(l => ({
      path: l.route!.path,
      methods: Object.keys(l.route!.methods).filter(m => l.route!.methods[m]).sort(),
    }));

const has = (path: string, method: string) =>
  routes().some(r => r.path === path && r.methods.includes(method));

describe('published endpoint paths', () => {
  // Each of these is called by the external site. Deleting one is a breaking
  // change, so this list should only ever grow.
  const required: Array<[string, string]> = [
    ['/metrics', 'get'],
    ['/metrics/scores', 'post'],
    ['/metrics/users/:address', 'get'],
    ['/metrics/:channel', 'get'],
    ['/achievements/public/list', 'get'],
    ['/achievements/wallet/:wallet', 'get'],
  ];

  for (const [path, method] of required) {
    it(`serves ${method.toUpperCase()} ${path}`, () => {
      expect(has(path, method), `${method.toUpperCase()} ${path} is not mounted`).toBe(true);
    });
  }
});

describe('route ordering', () => {
  it('registers the specific /metrics paths before the :channel catch-all', () => {
    // Express matches in declaration order, so /metrics/:channel would swallow
    // /metrics/scores and /metrics/users/:address if it came first.
    const paths = routes().map(r => r.path);
    const channel = paths.indexOf('/metrics/:channel');
    expect(channel).toBeGreaterThan(paths.indexOf('/metrics/scores'));
    expect(channel).toBeGreaterThan(paths.indexOf('/metrics/users/:address'));
  });
});
