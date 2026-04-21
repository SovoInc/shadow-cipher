import { type Logger } from 'pino';
import { type WalletContext, createOnChainGame, type ShadowCipherPrivateState } from './api.js';
import { addToPool, getPoolSize, generateRandomCode, generateRandomSalt, hexToBytes } from './kvStore.js';
import { enqueuePoolRefill } from './onChainQueue.js';

const TARGET_POOL_SIZE = parseInt(process.env.POOL_TARGET_SIZE ?? '20', 10);
const REFILL_INTERVAL_MS = 10_000;

let activeGameSessions = 0;
export function isGameSessionActive() { return activeGameSessions > 0; }
export function incrementActiveSessions() { activeGameSessions++; }
export function decrementActiveSessions() { activeGameSessions = Math.max(0, activeGameSessions - 1); }

export async function runPoolRefill(
  providers: any,
  contractAddress: string,
  logger: Logger,
  walletCtx: WalletContext,
): Promise<never> {
  logger.info(`Pool worker started (target: ${TARGET_POOL_SIZE} games)`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const poolSize = await getPoolSize();

      if (poolSize >= TARGET_POOL_SIZE) {
        await sleep(REFILL_INTERVAL_MS);
        continue;
      }

      if (isGameSessionActive()) {
        logger.info('Active game session — pausing pool refill');
        await sleep(REFILL_INTERVAL_MS);
        continue;
      }

      const needed = TARGET_POOL_SIZE - poolSize;
      logger.info(`Pool: ${poolSize}/${TARGET_POOL_SIZE}, creating ${needed} games`);

      for (let i = 0; i < needed; i++) {
        if (isGameSessionActive()) {
          logger.info('Active game session appeared — pausing mid-refill');
          break;
        }

        try {
          const code = generateRandomCode();
          const salt = generateRandomSalt();
          const privateState: ShadowCipherPrivateState = {
            code,
            salt: hexToBytes(salt),
          };

          const { gameId } = await enqueuePoolRefill(() =>
            createOnChainGame(providers, contractAddress, privateState),
          );

          await addToPool({
            gameId: gameId.toString(),
            code,
            salt,
            contractAddress,
          });

          logger.info(`Pool: added game_id=${gameId} (${poolSize + i + 1}/${TARGET_POOL_SIZE})`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`Pool: failed to create game: ${msg}`);
          await sleep(5_000);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Pool refill iteration error');
    }

    await sleep(REFILL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
