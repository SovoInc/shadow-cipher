import { useState, useCallback, useMemo } from 'react';
import { useWallet } from '../../wallet-widget/hooks/useWallet';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { toHex, fromHex } from '@midnight-ntwrk/compact-runtime';
import { CachedFetchZkConfigProvider } from '../../wallet-widget/utils/providersWrappers/zkConfigProvider';
import { proofClient } from '../../wallet-widget/utils/providersWrappers/proofClient';
import { inMemoryPrivateStateProvider } from '../../wallet-widget/utils/customImplementations/in-memory-private-state-provider';
import { ShadowCipherController } from '../api/contractController';
import { ShadowCipherPrivateState, ShadowCipherPrivateStateId, ShadowCipherCircuits } from '../api/common-types';
import { logger } from '@/routes/__root';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as ledger from '@midnight-ntwrk/ledger-v7';

export const useShadowCipherContract = () => {
  const { serviceUriConfig, shieldedAddresses, connectedAPI, status } = useWallet();
  const [controller, setController] = useState<ShadowCipherController | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);

  const isWalletConnected = status?.status === 'connected';

  // Build providers when wallet is connected
  const providers = useMemo(() => {
    if (!serviceUriConfig || !connectedAPI || !shieldedAddresses) {
      return null;
    }

    const privateStateProvider = inMemoryPrivateStateProvider<string, ShadowCipherPrivateState>();

    const publicDataProvider = indexerPublicDataProvider(
      serviceUriConfig.indexerUri,
      serviceUriConfig.indexerWsUri
    );

    const zkConfigProvider = new CachedFetchZkConfigProvider<ShadowCipherCircuits>(
      `${window.location.origin}/midnight/shadowcipher`,
      fetch.bind(window),
      () => {}
    );

    // Use env override, or fall back to local proof server if wallet's configured URI is unreachable.
    // The Lace wallet may provide a preprod proof server URL that no longer resolves.
    const proofServerUri = import.meta.env.VITE_PROOF_SERVER_URI || 'http://127.0.0.1:6300';
    console.log('[ShadowCipher] Using proof server URI:', proofServerUri);

    // New API: httpClientProofProvider requires zkConfigProvider as second arg
    const proofProvider = proofClient(proofServerUri, zkConfigProvider, () => {
      console.log('[ShadowCipher] Proof provider callback triggered');
    });

    // New WalletProvider interface:
    // balanceTx takes an already-proven UnboundTransaction and returns FinalizedTransaction
    // The DApp connector's balanceUnsealedTransaction handles balancing the proven tx
    // Use ledger-v7 Transaction (browser-compatible WASM) for deserialization
    const walletProvider = {
      getCoinPublicKey: () => shieldedAddresses.shieldedCoinPublicKey as unknown as ledger.CoinPublicKey,
      getEncryptionPublicKey: () => shieldedAddresses.shieldedEncryptionPublicKey as unknown as ledger.EncPublicKey,
      async balanceTx(tx: any, ttl?: Date) {
        const serializedTx = toHex(tx.serialize());
        const received = await connectedAPI.balanceUnsealedTransaction(serializedTx);
        // Result from wallet is a fully balanced+finalized transaction
        // Deserialize using ledger-v7 with finalized type markers
        const transaction = ledger.Transaction.deserialize(
          'signature',
          'proof',
          'binding',
          fromHex(received.tx)
        );
        return transaction as any;
      },
    };

    const midnightProvider = {
      submitTx: async (tx: ledger.FinalizedTransaction) => {
        await connectedAPI.submitTransaction(toHex(tx.serialize()));
        return tx.identifiers()[0];
      },
    };

    return {
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider,
    };
  }, [serviceUriConfig, connectedAPI, shieldedAddresses, status]);

  const deployContract = useCallback(async () => {
    if (!providers) {
      setDeployError('Wallet not connected');
      return null;
    }

    setIsDeploying(true);
    setDeployError(null);

    try {
      // Set network ID from wallet connection
      const walletNetworkId = status?.status === 'connected' ? status.networkId : 'preview';
      setNetworkId(walletNetworkId ?? 'preview');

      const newController = await ShadowCipherController.deploy(
        ShadowCipherPrivateStateId,
        providers as any,
        logger
      );

      setController(newController);
      setContractAddress(newController.deployedContractAddress);
      setIsDeploying(false);

      return newController;
    } catch (error) {
      console.error('Deploy error:', error);

      // Extract the deepest meaningful error message from FiberFailure chain
      let errorMessage = 'Deployment failed';
      if (error && typeof error === 'object' && 'cause' in error) {
        const cause = (error as any).cause;
        console.error('Deploy error cause:', cause);
        logger?.error(cause || error, 'Deploy error details');
        if (cause && typeof cause === 'object' && 'failure' in cause) {
          const failure = (cause as any).failure;
          if (failure && typeof failure === 'object' && 'message' in failure) {
            console.error('Actual error message:', failure.message);
            errorMessage = failure.message || errorMessage;
          }
        }
      }
      if (errorMessage === 'Deployment failed' && error instanceof Error) {
        errorMessage = error.message || errorMessage;
      }

      setDeployError(errorMessage);
      setIsDeploying(false);
      // Re-throw with the clean message so the caller gets it
      throw new Error(errorMessage);
    }
  }, [providers]);

  return {
    isWalletConnected,
    providers,
    controller,
    contractAddress,
    isDeploying,
    deployError,
    deployContract,
  };
};
