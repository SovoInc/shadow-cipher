import express from 'express';
import cors from 'cors';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { fromHex } from '@midnight-ntwrk/midnight-js-utils';
import { type Logger } from 'pino';
import type { WalletContext } from './api.js';
import { signTransactionIntents, configureProviders, deployShadowCipher, submitGuessOnChain, getDustBalance } from './api.js';
import {
  claimPoolEntry,
  getPoolSize,
  createSession,
  getSession,
  updateSession,
  deleteSession,
  recordScore,
  generateRandomCode,
  generateRandomSalt,
  hexToBytes,
  calculatePegs,
} from './kvStore.js';
import { createOnChainGame } from './api.js';
import { enqueueOnChain } from './onChainQueue.js';
import { runPoolRefill, incrementActiveSessions, decrementActiveSessions } from './poolWorker.js';
import { buildLeaderboardRouter } from './leaderboardRoutes.js';

let logger: Logger;
let walletCtxGlobal: WalletContext | null = null;
let providersGlobal: any = null;
let configGlobal: import('./config.js').Config | null = null;
let sharedContractAddress: string | null = null;

export function setSponsorLogger(_logger: Logger): void {
  logger = _logger;
}

export async function startSponsorServer(
  ctx: WalletContext,
  config: import('./config.js').Config,
  port = 3002,
): Promise<void> {
  walletCtxGlobal = ctx;
  configGlobal = config;

  logger.info('Initializing ShadowCipher providers...');
  providersGlobal = await configureProviders(ctx, config);
  logger.info('Providers ready');

  // Deploy or join the shared contract
  const existingAddress = process.env.SHADOWCIPHER_CONTRACT_ADDRESS;
  if (existingAddress) {
    sharedContractAddress = existingAddress;
    logger.info(`Using existing contract: ${sharedContractAddress}`);
  } else {
    logger.info('Deploying shared ShadowCipher contract...');
    const { contractAddress } = await deployShadowCipher(providersGlobal);
    sharedContractAddress = contractAddress;
    logger.info(`
──────────────────────────────────────────────────────────────
  SHADOWCIPHER CONTRACT DEPLOYED
  Address: ${sharedContractAddress}
  Add to .env: SHADOWCIPHER_CONTRACT_ADDRESS=${sharedContractAddress}
──────────────────────────────────────────────────────────────
`);
  }

  // Log current pool size
  getPoolSize().then(size => logger.info(`Game pool: ${size} pre-created games ready`)).catch(() => {});

  // Start background pool refill
  runPoolRefill(providersGlobal, sharedContractAddress!, logger, walletCtxGlobal!).catch(err => {
    logger.error({ err }, 'Pool refill loop crashed');
  });

  const app = express();
  app.use(cors());
  app.use(express.json());

  // ── Leaderboard & achievements (PRC-1/PRC-6, ported from Vercel /api handlers) ──
  app.use('/api', buildLeaderboardRouter());

  // ── Transaction sponsorship ──

  app.post('/sponsor', async (req, res) => {
    logger.info('Sponsor: received tx from client');
    try {
      const { tx: txHex } = req.body as { tx: string };

      const tx = ledger.Transaction.deserialize<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>(
        'signature',
        'proof',
        'pre-binding',
        fromHex(txHex),
      );

      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: new Date(Date.now() + 30 * 60 * 1000), tokenKindsToBalance: ['dust'] },
      );

      const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      }

      const finalized = await ctx.wallet.finalizeRecipe(recipe);
      const txId = await ctx.wallet.submitTransaction(finalized);

      logger.info(`Sponsor: tx submitted, txId=${txId}`);
      res.json({ txId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Sponsor error: ${message}`);
      res.status(500).json({ error: message });
    }
  });

  // ── Game API ──

  app.post('/api/session/start', async (req, res) => {
    try {
      const { demo } = (req.body || {}) as { demo?: boolean };

      if (demo || !sharedContractAddress) {
        // Demo mode — no on-chain game
        const code = generateRandomCode();
        const salt = generateRandomSalt();
        const session = await createSession(code, salt, null, null);
        res.json({
          sessionId: session.sessionId,
          contractAddress: null,
          gameId: null,
        });
        return;
      }

      // Try to claim a pre-generated game from the pool
      const poolEntry = await claimPoolEntry();
      if (poolEntry) {
        logger.info(`Pool entry claimed: game_id=${poolEntry.gameId}`);
        const session = await createSession(
          poolEntry.code,
          poolEntry.salt,
          poolEntry.gameId,
          poolEntry.contractAddress,
        );
        incrementActiveSessions();
        res.json({
          sessionId: session.sessionId,
          contractAddress: poolEntry.contractAddress,
          gameId: poolEntry.gameId,
        });
        return;
      }

      // Pool empty — generate on demand
      logger.warn('Pool empty, generating on demand');
      try {
        const code = generateRandomCode();
        const salt = generateRandomSalt();
        const privateState = { code, salt: hexToBytes(salt) };
        const { gameId } = await enqueueOnChain(() =>
          createOnChainGame(providersGlobal, sharedContractAddress!, privateState),
        );
        const session = await createSession(code, salt, gameId.toString(), sharedContractAddress!);
        incrementActiveSessions();
        res.json({
          sessionId: session.sessionId,
          contractAddress: sharedContractAddress,
          gameId: gameId.toString(),
        });
      } catch (onChainErr) {
        const msg = onChainErr instanceof Error ? onChainErr.message : String(onChainErr);
        logger.warn(`On-chain game creation failed (${msg}), falling back to demo`);
        const code = generateRandomCode();
        const salt = generateRandomSalt();
        const session = await createSession(code, salt, null, null);
        res.json({
          sessionId: session.sessionId,
          contractAddress: null,
          gameId: null,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, `Session start error: ${message}`);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/guess', async (req, res) => {
    try {
      const { sessionId, guess } = req.body as {
        sessionId: string;
        guess: [number, number, number, number];
      };

      const session = await getSession(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      if (session.guesses.length >= 10) {
        return res.status(400).json({ error: 'Max attempts reached' });
      }

      const result = calculatePegs(guess, session.code);
      session.guesses.push({ guess, ...result });
      await updateSession(session);

      res.json({
        black: result.black,
        white: result.white,
        attempt: session.guesses.length,
        solved: result.black === 4,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/declare', async (req, res) => {
    try {
      const { sessionId, guess, address, displayName } = req.body as {
        sessionId: string;
        guess: [number, number, number, number];
        address?: string;
        displayName?: string;
      };

      const session = await getSession(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const result = calculatePegs(guess, session.code);
      session.guesses.push({ guess, ...result });
      const won = result.black === 4;
      const attempts = session.guesses.length;

      let onChain: { correct: boolean; txId: string } | null = null;

      if (session.contractAddress && session.gameId) {
        try {
          const privateState = {
            code: session.code,
            salt: hexToBytes(session.salt),
          };
          onChain = await enqueueOnChain(() =>
            submitGuessOnChain(
              providersGlobal,
              session.contractAddress!,
              privateState,
              BigInt(session.gameId!),
              guess,
            ),
          );
          logger.info(`On-chain guess: correct=${onChain.correct}, txId=${onChain.txId}`);
        } catch (onChainErr) {
          const msg = onChainErr instanceof Error ? onChainErr.message : String(onChainErr);
          logger.warn(`On-chain guess skipped (${msg})`);
        }
      }

      // Record score
      const mode = session.contractAddress ? 'on-chain' : 'demo';
      const playerAddress = address || `DMO_${displayName || 'ANO'}`;
      const playerName = displayName || playerAddress.slice(0, 3);
      await recordScore(playerAddress, playerName, attempts, won, mode);

      // Clean up
      decrementActiveSessions();
      await deleteSession(sessionId);

      res.json({
        correct: won,
        black: result.black,
        white: result.white,
        attempts,
        secret: session.code,
        onChain,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/status', async (_req, res) => {
    const check = async (name: string, url: string): Promise<{ name: string; ok: boolean }> => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        await fetch(url, { method: 'GET', signal: controller.signal });
        clearTimeout(timeout);
        return { name, ok: true };
      } catch {
        return { name, ok: false };
      }
    };

    const [proofServer, node, indexer] = await Promise.all([
      check('proofServer', config.proofServer),
      check('node', config.node),
      check('indexer', config.indexer),
    ]);

    const poolSize = await getPoolSize().catch(() => 0);

    res.json({
      gameServer: true,
      proofServer: proofServer.ok,
      node: node.ok,
      indexer: indexer.ok,
      contractAddress: sharedContractAddress,
      poolSize,
    });
  });

  app.get('/api/dust', async (_req, res) => {
    try {
      if (!walletCtxGlobal) return res.status(503).json({ error: 'Wallet not ready' });
      const dust = await getDustBalance(walletCtxGlobal.wallet);
      res.json({
        available: dust.available.toString(),
        pending: dust.pending.toString(),
        availableCoins: dust.availableCoins,
        pendingCoins: dust.pendingCoins,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/pool', async (_req, res) => {
    try {
      const size = await getPoolSize();
      res.json({ size, target: parseInt(process.env.POOL_TARGET_SIZE ?? '20', 10) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.listen(port, () => {
    logger.info(`ShadowCipher sponsor server listening on :${port}`);
  });
}
