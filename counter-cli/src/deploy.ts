import { createLogger } from './logger.js';
import * as api from './api.js';
import { PreviewConfig } from './config.js';
import path from 'node:path';
import { currentDir } from './config.js';
import 'dotenv/config';

const config = new PreviewConfig();
const logDir = path.resolve(currentDir, '..', 'logs', 'deploy', `${new Date().toISOString()}.log`);
const logger = await createLogger(logDir);

async function deploy() {
  api.setLogger(logger);
  
  logger.info('Starting contract deployment...');
  
  // Get mnemonic from env or create fresh wallet
  const mnemonic = process.env.MY_PREVIEW_MNEMONIC;
  let walletContext;
  
  if (mnemonic) {
    logger.info('Using mnemonic from .env file...');
    walletContext = await api.buildWalletAndWaitForFunds(config, mnemonic);
  } else {
    logger.info('No mnemonic found in .env, creating fresh wallet...');
    logger.warn('NOTE: You will need to fund this wallet from the faucet: https://faucet.preview.midnight.network/');
    walletContext = await api.buildFreshWallet(config);
  }
  
  logger.info(`Wallet address: ${walletContext.unshieldedKeystore.getBech32Address().asString()}`);
  
  // Register for dust if needed
  await api.registerNightForDust(walletContext);
  
  // Configure providers
  const providers = await api.configureProviders(walletContext, config);
  
  // Deploy contract
  logger.info('Deploying contract...');
  const deployedContract = await api.deploy(providers, { privateCounter: 0 });
  
  const contractAddress = deployedContract.deployTxData.public.contractAddress;
  logger.info(`✅ Contract deployed successfully!`);
  logger.info(`Contract address: ${contractAddress}`);
  logger.info(`\nAdd this to your frontend .env file:`);
  logger.info(`VITE_CONTRACT_ADDRESS="${contractAddress}"`);
  
  // Clean up
  await api.closeWallet(walletContext);
  
  process.exit(0);
}

deploy().catch((error) => {
  logger.error('Deployment failed:', error);
  process.exit(1);
});
