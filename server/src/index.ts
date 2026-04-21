import 'dotenv/config';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { getConfig } from './config.js';
import { buildWalletAndWaitForFunds, setLogger as setApiLogger } from './api.js';
import { setSponsorLogger, startSponsorServer } from './sponsor-server.js';

const logger = pino({
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

async function main() {
  const config = getConfig();
  const seed = process.env.WALLET_SEED;
  const port = parseInt(process.env.PORT ?? '3002', 10);

  if (!seed) {
    console.error('WALLET_SEED env var is required (mnemonic or hex seed)');
    process.exit(1);
  }

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ShadowCipher Sponsor Server                                ║
║  Network: ${config.networkId.padEnd(48)}║
╚══════════════════════════════════════════════════════════════╝
`);

  setApiLogger(logger);
  setSponsorLogger(logger);
  setNetworkId(config.networkId);

  logger.info('Building wallet...');
  const walletCtx = await buildWalletAndWaitForFunds(config, seed);

  logger.info('Starting sponsor server...');
  await startSponsorServer(walletCtx, config, port);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
