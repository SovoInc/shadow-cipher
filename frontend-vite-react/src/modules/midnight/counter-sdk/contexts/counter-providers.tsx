import {
  type MidnightProvider,
  type WalletProvider,
  PrivateStateProvider,
  ZKConfigProvider,
  ProofProvider,
  PublicDataProvider,
} from "@midnight-ntwrk/midnight-js-types";
import * as ledger from "@midnight-ntwrk/ledger";
import { createContext, useCallback, useMemo, useState } from "react";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { Logger } from "pino";
import type {
  CounterCircuits,
  CounterPrivateStateId,
} from "../api/common-types";
import { CounterProviders } from "../api/common-types";
import { useWallet } from "../../wallet-widget/hooks/useWallet";
import {
  ActionMessages,
  ProviderAction,
  WrappedPublicDataProvider,
} from "../../wallet-widget/utils/providersWrappers/publicDataProvider";
import { CachedFetchZkConfigProvider } from "../../wallet-widget/utils/providersWrappers/zkConfigProvider";
import {
  noopProofClient,
  proofClient,
} from "../../wallet-widget/utils/providersWrappers/proofClient";
import { inMemoryPrivateStateProvider } from "../../wallet-widget/utils/customImplementations/in-memory-private-state-provider";
import { CounterPrivateState } from "@eddalabs/counter-contract";
import {
  fromHex,
  toHex,
} from "@midnight-ntwrk/compact-runtime";

export interface ProvidersState {
  privateStateProvider: PrivateStateProvider<typeof CounterPrivateStateId>;
  zkConfigProvider?: ZKConfigProvider<CounterCircuits>;
  proofProvider: ProofProvider;
  publicDataProvider?: PublicDataProvider;
  walletProvider?: WalletProvider;
  midnightProvider?: MidnightProvider;
  providers?: CounterProviders;
  flowMessage?: string;
}

interface ProviderProps {
  children: React.ReactNode;
  logger: Logger;
}

export const ProvidersContext = createContext<ProvidersState | undefined>(
  undefined
);

const ACTION_MESSAGES: Readonly<ActionMessages> = {
  proveTxStarted: "Proving transaction...",
  proveTxDone: undefined,
  balanceTxStarted: "Signing the transaction with Midnight Lace wallet...",
  balanceTxDone: undefined,
  downloadProverStarted: "Downloading prover key...",
  downloadProverDone: undefined,
  submitTxStarted: "Submitting transaction...",
  submitTxDone: undefined,
  watchForTxDataStarted: "Waiting for transaction finalization on blockchain...",
  watchForTxDataDone: undefined,
} as const;

export const Provider = ({ children, logger }: ProviderProps) => {
  const [flowMessage, setFlowMessage] = useState<string | undefined>(undefined);

  const { serviceUriConfig, shieldedAddresses, connectedAPI, status } = useWallet();

  const providerCallback = useCallback(
    (action: ProviderAction): void => {
      setFlowMessage(ACTION_MESSAGES[action]);
    },
    []
  );

  const privateStateProvider: PrivateStateProvider<
    typeof CounterPrivateStateId
  > = useMemo(
    () =>
      inMemoryPrivateStateProvider<string, CounterPrivateState>(),
    [logger, status]
  );

  const publicDataProvider: PublicDataProvider | undefined = useMemo(
    () =>
      serviceUriConfig
        ? new WrappedPublicDataProvider(
            indexerPublicDataProvider(
              serviceUriConfig.indexerUri,
              serviceUriConfig.indexerWsUri
            ),
            providerCallback,
            logger
          )
        : undefined,
    [serviceUriConfig, providerCallback, logger, status]
  );

  const zkConfigProvider = useMemo(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    return new CachedFetchZkConfigProvider<CounterCircuits>(
      `${window.location.origin}/midnight/counter`,
      fetch.bind(window),
      () => {}
    );
  }, [status]);

  const proofProvider = useMemo(
    () =>
      serviceUriConfig?.proverServerUri && zkConfigProvider
        ? proofClient(serviceUriConfig.proverServerUri, zkConfigProvider, providerCallback)
        : noopProofClient(),
    [serviceUriConfig, zkConfigProvider, providerCallback, status]
  );

  const walletProvider: WalletProvider = useMemo(
    () =>
      connectedAPI
        ? {
            getCoinPublicKey() {
              return shieldedAddresses?.shieldedCoinPublicKey as any;
            },
            getEncryptionPublicKey() {
              return shieldedAddresses?.shieldedEncryptionPublicKey as any;
            },
            async balanceTx(
              tx: any,
              ttl?: Date
            ): Promise<ledger.FinalizedTransaction> {
              try {
                logger.info("Balancing transaction via wallet");
                const serializedTx = toHex(tx.serialize());
                const received =
                  await connectedAPI.balanceUnsealedTransaction(serializedTx);
                const transaction = ledger.Transaction.deserialize(
                  "signature",
                  "proof",
                  "binding",
                  fromHex(received.tx)
                );
                return transaction as ledger.FinalizedTransaction;
              } catch (e) {
                logger.error(
                  { error: e },
                  "Error balancing transaction via wallet"
                );
                throw e;
              }
            },
          }
        : {
            getCoinPublicKey() {
              return "" as any;
            },
            getEncryptionPublicKey() {
              return "" as any;
            },
            balanceTx: () => Promise.reject(new Error("readonly")),
          },
    [connectedAPI, providerCallback, status]
  );

  const midnightProvider: MidnightProvider = useMemo(
    () =>
      connectedAPI
        ? {
            submitTx: async (
              tx: ledger.FinalizedTransaction
            ): Promise<ledger.TransactionId> => {
              await connectedAPI.submitTransaction(toHex((tx as any).serialize()));
              const txIdentifiers = (tx as any).identifiers();
              const txId = txIdentifiers[0];
              logger.info(
                { txIdentifiers },
                "Submitted transaction via wallet"
              );
              return txId;
            },
          }
        : {
            submitTx: (): Promise<ledger.TransactionId> =>
              Promise.reject(new Error("readonly")),
          },
    [connectedAPI, providerCallback, status]
  );

  const combinedProviders: ProvidersState = useMemo(() => {
    return {
      privateStateProvider,
      publicDataProvider,
      proofProvider,
      zkConfigProvider,
      walletProvider,
      midnightProvider,
      providers:
        publicDataProvider && zkConfigProvider
          ? {
              privateStateProvider,
              publicDataProvider,
              zkConfigProvider,
              proofProvider,
              walletProvider,
              midnightProvider,
            }
          : undefined,
      flowMessage,
    };
  }, [
    privateStateProvider,
    publicDataProvider,
    proofProvider,
    zkConfigProvider,
    walletProvider,
    midnightProvider,
    flowMessage,
  ]);

  return (
    <ProvidersContext.Provider value={combinedProviders}>
      {children}
    </ProvidersContext.Provider>
  );
};
