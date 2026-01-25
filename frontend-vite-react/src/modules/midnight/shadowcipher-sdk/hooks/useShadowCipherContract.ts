import { useState, useCallback, useMemo, useEffect } from 'react';
import { useWallet } from '../../wallet-widget/hooks/useWallet';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { fromHex, toHex } from '@midnight-ntwrk/compact-runtime';
import { CachedFetchZkConfigProvider } from '../../wallet-widget/utils/providersWrappers/zkConfigProvider';
import { proofClient } from '../../wallet-widget/utils/providersWrappers/proofClient';
import { inMemoryPrivateStateProvider } from '../../wallet-widget/utils/customImplementations/in-memory-private-state-provider';
import { ShadowCipherController } from '../api/contractController';
import { ShadowCipherPrivateState, ShadowCipherPrivateStateId, ShadowCipherCircuits } from '../api/common-types';
import { logger } from '@/routes/__root';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

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

    // Note: When using wallet extension, the wallet handles network ID
    // We don't need to set it ourselves

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

    // For preview network, use local proof server (http://127.0.0.1:6300) like the CLI does
    // The wallet extension may provide a remote proof server, but for local development
    // we should use the local Docker proof server
    const networkId = status?.status === 'connected' ? status.networkId : null;
    const proofServerUri = networkId === 'preview' 
      ? 'http://127.0.0.1:6300'
      : serviceUriConfig.proverServerUri;
    
    const proofProvider = proofClient(proofServerUri, () => {});

    const walletProvider = {
      getCoinPublicKey: () => shieldedAddresses.shieldedCoinPublicKey as unknown as ledger.CoinPublicKey,
      getEncryptionPublicKey: () => shieldedAddresses.shieldedEncryptionPublicKey as unknown as ledger.EncPublicKey,
      async balanceTx(tx: ledger.UnprovenTransaction) {
        const serializedTx = toHex(tx.serialize());
        const received = await connectedAPI.balanceUnsealedTransaction(serializedTx);
        const transaction = ledger.Transaction.deserialize(
          'signature',
          'pre-proof',
          'pre-binding',
          fromHex(received.tx)
        );
        return { type: 'TransactionToProve' as const, transaction };
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
      // Preview network uses 'preview' network ID
      setNetworkId('preview');
      
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
      // Log the full error including cause for FiberFailure
      if (error && typeof error === 'object' && 'cause' in error) {
        const cause = (error as any).cause;
        console.error('Deploy error cause:', cause);
        logger?.error(cause || error, 'Deploy error details');
        // Extract failure message from nested structure
        if (cause && typeof cause === 'object' && 'failure' in cause) {
          const failure = (cause as any).failure;
          if (failure && typeof failure === 'object' && 'message' in failure) {
            console.error('Actual error message:', failure.message);
            const errorMessage = failure.message || 'Deployment failed';
            setDeployError(errorMessage);
            setIsDeploying(false);
            return null;
          }
        }
      }
      const errorMessage = error instanceof Error 
        ? (error.cause ? String(error.cause) : error.message) || 'Deployment failed'
        : 'Deployment failed';
      setDeployError(errorMessage);
      setIsDeploying(false);
      return null;
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
