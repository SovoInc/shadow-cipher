import path from 'path';
import * as api from '../api';
import { type CounterProviders } from '../common-types';
import { Config, currentDir } from '../config';
import { createLogger } from '../logger';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import 'dotenv/config';
import * as Rx from 'rxjs';
import { TestEnvironment } from './simulators/simulator';
import { Counter } from '@eddalabs/counter-contract';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v7';
import { ShieldedAddress, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { tokenValue } from './utils/utils';

const logDir = path.resolve(currentDir, '..', 'logs', 'public-provider', `${new Date().toISOString()}.log`);
const logger = await createLogger(logDir);

describe('API', () => {
  let testEnvironment: TestEnvironment;
  let wallet: api.WalletContext;
  let providers: CounterProviders;
  let configuration: Config;

  beforeAll(
    async () => {
      api.setLogger(logger);
      testEnvironment = new TestEnvironment(logger);
      const testConfiguration = await testEnvironment.start();
      logger.info(`Test configuration: ${JSON.stringify(testConfiguration)}`);
      configuration = testConfiguration.dappConfig;
    },
    1000 * 60 * 45,
  );

  beforeEach(
    async () => {
      wallet = await testEnvironment.getWallet();
      providers = await api.configureProviders(wallet, configuration);
    },
    1000 * 60 * 45,
  );

  afterAll(async () => {
    await testEnvironment.shutdown();
  });

  it('allows to transfer shielded tokens only', async () => {
    const state = await Rx.firstValueFrom(wallet.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
    const stateReceiverAddress = state.shielded.address;
    const ledgerReceiverAddress = ShieldedAddress.codec
      .encode(configuration.networkId, stateReceiverAddress)
      .asString();
    logger.info({ section: 'Shielded Address', stateReceiverAddress });
    logger.info({ section: 'ledgerReceiverAddress', ledgerReceiverAddress });

    const coin = ledger.createShieldedCoinInfo(ledger.shieldedToken().raw, tokenValue(1n));
    const output = ledger.ZswapOutput.new(
      coin,
      0,
      wallet.shieldedSecretKeys.coinPublicKey,
      wallet.shieldedSecretKeys.encryptionPublicKey,
    );
    const outputOffer = ledger.ZswapOffer.fromOutput(output, ledger.shieldedToken().raw, tokenValue(1n));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arbitraryTx = ledger.Transaction.fromParts(configuration.networkId as any, outputOffer);

    const recipe = await wallet.wallet.balanceUnboundTransaction(
      arbitraryTx as any,
      { shieldedSecretKeys: wallet.shieldedSecretKeys, dustSecretKey: wallet.dustSecretKey },
      { ttl: new Date(Date.now() + 60 * 60 * 1000) },
    );

    const finalizedTx = await wallet.wallet.finalizeRecipe(recipe);
    const submittedTxHash = await wallet.wallet.submitTransaction(finalizedTx);
    logger.info({ section: 'Submitted Transaction Hash', submittedTxHash });

    await Rx.firstValueFrom(
      wallet.wallet
        .state()
        .pipe(Rx.filter((s) => s.shielded.availableCoins.some((c) => c.coin.value === tokenValue(1n)))),
    );
  });

  it('allows to transfer unshielded tokens', async () => {
    const state = await Rx.firstValueFrom(wallet.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
    const stateReceiverAddress = state.unshielded.address;
    const ledgerReceiverAddress = UnshieldedAddress.codec
      .encode(configuration.networkId, stateReceiverAddress)
      .asString();
    logger.info({ section: 'Unshielded Address', stateReceiverAddress });
    logger.info({ section: 'ledgerReceiverAddress', ledgerReceiverAddress });

    const outputs = [
      {
        type: unshieldedToken().raw,
        value: tokenValue(1n),
        owner: wallet.unshieldedKeystore.getAddress(),
      },
    ];

    const intent = ledger.Intent.new(new Date(Date.now() + 30 * 60 * 1000));
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([], outputs, []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arbitraryTx = ledger.Transaction.fromParts(configuration.networkId as any, undefined, undefined, intent);

    const recipe = await wallet.wallet.balanceUnboundTransaction(
      arbitraryTx as any,
      { shieldedSecretKeys: wallet.shieldedSecretKeys, dustSecretKey: wallet.dustSecretKey },
      { ttl: new Date(Date.now() + 30 * 60 * 1000) },
    );

    const finalizedTx = await wallet.wallet.finalizeRecipe(recipe);
    const submittedTxHash = await wallet.wallet.submitTransaction(finalizedTx);
    logger.info({ section: 'Submitted Transaction Hash', submittedTxHash });

    await Rx.firstValueFrom(
      wallet.wallet
        .state()
        .pipe(Rx.filter((s) => s.unshielded.availableCoins.some((c) => c.utxo.value === tokenValue(1n)))),
    );
  });

  it('allows to balance and submit an arbitrary shielded transaction', async () => {
    const coin = ledger.createShieldedCoinInfo(ledger.shieldedToken().raw, tokenValue(1n));
    const output = ledger.ZswapOutput.new(
      coin,
      0,
      wallet.shieldedSecretKeys.coinPublicKey,
      wallet.shieldedSecretKeys.encryptionPublicKey,
    );
    const outputOffer = ledger.ZswapOffer.fromOutput(output, ledger.shieldedToken().raw, tokenValue(1n));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arbitraryTx = ledger.Transaction.fromParts(configuration.networkId as any, outputOffer);

    const recipe = await wallet.wallet.balanceUnboundTransaction(
      arbitraryTx as any,
      { shieldedSecretKeys: wallet.shieldedSecretKeys, dustSecretKey: wallet.dustSecretKey },
      { ttl: new Date(Date.now() + 30 * 60 * 1000) },
    );

    const finalizedTx = await wallet.wallet.finalizeRecipe(recipe);
    const submittedTxHash = await wallet.wallet.submitTransaction(finalizedTx);
    logger.info({ section: 'Submitted Transaction Hash', submittedTxHash });

    await Rx.firstValueFrom(
      wallet.wallet
        .state()
        .pipe(Rx.filter((s) => s.shielded.availableCoins.some((c) => c.coin.value === tokenValue(1n)))),
    );
  });

  it('allows to balance and submit an arbitrary unshielded transaction', async () => {
    const outputs = [
      {
        type: unshieldedToken().raw,
        value: tokenValue(1n),
        owner: wallet.unshieldedKeystore.getAddress(),
      },
    ];

    const intent = ledger.Intent.new(new Date(Date.now() + 30 * 60 * 1000));
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([], outputs, []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arbitraryTx = ledger.Transaction.fromParts(configuration.networkId as any, undefined, undefined, intent);

    const recipe = await wallet.wallet.balanceUnboundTransaction(
      arbitraryTx as any,
      { shieldedSecretKeys: wallet.shieldedSecretKeys, dustSecretKey: wallet.dustSecretKey },
      { ttl: new Date(Date.now() + 30 * 60 * 1000) },
    );

    const finalizedTx = await wallet.wallet.finalizeRecipe(recipe);
    const submittedTxHash = await wallet.wallet.submitTransaction(finalizedTx);
    logger.info({ section: 'Submitted Transaction Hash', submittedTxHash });

    await Rx.firstValueFrom(
      wallet.wallet
        .state()
        .pipe(Rx.filter((s) => s.unshielded.availableCoins.some((c) => c.utxo.value === tokenValue(1n)))),
    );
  });
});
