import { type Logger } from 'pino';
import { type CounterContract, type CounterProviders, type DeployedCounterContract } from './common-types';
import { type Config } from './config';
import { type CounterPrivateState } from '@eddalabs/counter-contract';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { type FinalizedTxData, type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { type UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
export declare function setLogger(_logger: Logger): void;
export interface WalletContext {
    wallet: WalletFacade;
    shieldedSecretKeys: ledger.ZswapSecretKeys;
    dustSecretKey: ledger.DustSecretKey;
    unshieldedKeystore: UnshieldedKeystore;
}
export declare const getCounterLedgerState: (providers: CounterProviders, contractAddress: ContractAddress) => Promise<bigint | null>;
export declare const counterContractInstance: CounterContract;
export declare const joinContract: (providers: CounterProviders, contractAddress: string) => Promise<DeployedCounterContract>;
export declare const deploy: (providers: CounterProviders, privateState: CounterPrivateState) => Promise<DeployedCounterContract>;
export declare const increment: (counterContract: DeployedCounterContract) => Promise<FinalizedTxData>;
export declare const displayCounterValue: (providers: CounterProviders, counterContract: DeployedCounterContract) => Promise<{
    counterValue: bigint | null;
    contractAddress: string;
}>;
export declare const createWalletAndMidnightProvider: (walletContext: WalletContext) => Promise<WalletProvider & MidnightProvider>;
export declare const waitForSync: (wallet: WalletFacade) => Promise<import("@midnight-ntwrk/wallet-sdk-facade").FacadeState>;
export declare const waitForFunds: (wallet: WalletFacade) => Promise<bigint>;
/**
 * Display wallet balances (unshielded, shielded, total)
 */
export declare const displayWalletBalances: (wallet: WalletFacade) => Promise<{
    unshielded: any;
    shielded: bigint;
    total: bigint;
}>;
/**
 * Register unshielded Night UTXOs for dust generation
 * This is required before the wallet can pay transaction fees
 */
export declare const registerNightForDust: (walletContext: WalletContext) => Promise<boolean>;
/**
 * Initialize wallet with seed using the new wallet SDK
 */
export declare const initWalletWithSeed: (seed: Buffer, config: Config) => Promise<WalletContext>;
/**
 * Build wallet from mnemonic and wait for funds
 */
export declare const buildWalletAndWaitForFunds: (config: Config, mnemonic: string) => Promise<WalletContext>;
/**
 * Generate a fresh wallet with random mnemonic
 */
export declare const buildFreshWallet: (config: Config) => Promise<WalletContext>;
/**
 * Build wallet from hex seed (for backwards compatibility with genesis wallet)
 */
export declare const buildWalletFromHexSeed: (config: Config, hexSeed: string) => Promise<WalletContext>;
export declare const configureProviders: (walletContext: WalletContext, config: Config) => Promise<{
    privateStateProvider: import("@midnight-ntwrk/midnight-js-types").PrivateStateProvider<"counterPrivateState", any>;
    publicDataProvider: import("@midnight-ntwrk/midnight-js-types").PublicDataProvider;
    zkConfigProvider: NodeZkConfigProvider<"increment">;
    proofProvider: import("@midnight-ntwrk/midnight-js-types").ProofProvider<string>;
    walletProvider: WalletProvider & MidnightProvider;
    midnightProvider: WalletProvider & MidnightProvider;
}>;
export declare const closeWallet: (walletContext: WalletContext) => Promise<void>;
