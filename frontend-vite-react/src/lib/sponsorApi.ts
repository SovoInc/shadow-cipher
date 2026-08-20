// HTTP client for the ShadowCipher sponsor server.
// The sponsor server handles on-chain game creation, guess submission,
// and DUST sponsorship — the frontend never touches the wallet SDK directly.

// When blank, browser uses relative paths (same-origin, nginx reverse-proxies to server).
// In dev Vite's proxy (see vite.config.ts) forwards /api to localhost:3003.
const SPONSOR_URL = (import.meta.env.VITE_SPONSOR_URL as string | undefined) ?? '';

export interface StartGameResponse {
  sessionId: string;
  contractAddress: string | null;
  gameId: string | null;
}

export interface GuessResponse {
  black: number;
  white: number;
  attempt: number;
  solved: boolean;
}

export interface DeclareResponse {
  correct: boolean;
  black: number;
  white: number;
  attempts: number;
  secret: [number, number, number, number];
  onChain: { correct: boolean; txId: string } | null;
}

export interface StatusResponse {
  gameServer: boolean;
  proofServer: boolean;
  node: boolean;
  indexer: boolean;
  contractAddress: string | null;
  poolSize: number;
}

async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${SPONSOR_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${SPONSOR_URL}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Start a new game session. Pass demo=true for local-only mode. */
export const startGame = (demo = false): Promise<StartGameResponse> =>
  post('/api/session/start', { demo });

/** Submit a guess and get black/white peg feedback. */
export const submitGuess = (
  sessionId: string,
  guess: [number, number, number, number],
): Promise<GuessResponse> =>
  post('/api/guess', { sessionId, guess });

/** Declare final answer — submits ZK proof on-chain if available. */
export const declareAnswer = (
  sessionId: string,
  guess: [number, number, number, number],
  address?: string,
  displayName?: string,
): Promise<DeclareResponse> =>
  post('/api/declare', { sessionId, guess, address, displayName });

/** Associate an arcade display name with a finished session's leaderboard row.
 *  Rename only — the score itself was already recorded by declareAnswer. */
export const submitDisplayName = (
  sessionId: string,
  displayName: string,
): Promise<{ updated: boolean }> =>
  post('/api/session/name', { sessionId, displayName });

/** Check sponsor server health. */
export const getStatus = (): Promise<StatusResponse> =>
  get('/api/status');

/** Get current game pool size. */
export const getPoolInfo = (): Promise<{ size: number; target: number }> =>
  get('/api/pool');
