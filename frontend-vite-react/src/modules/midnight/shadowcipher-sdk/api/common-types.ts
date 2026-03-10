import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { ImpureCircuitId } from '@midnight-ntwrk/compact-js';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';

// Matches the Compact contract ledger: commitment, attempts, solved
export interface ShadowCipherLedger {
  readonly commitment: Uint8Array;
  readonly attempts: bigint;
  readonly solved: boolean;
}

export type ShadowCipherPrivateState = {
  secret: [number, number, number, number];
  commitment: Uint8Array;
};

// Matches the Compact contract circuits: initialize, record_guess
export interface ShadowCipherContract {
  circuits: {
    initialize: (context: unknown, commitment: Uint8Array) => unknown;
    record_guess: (context: unknown, is_solved: boolean) => unknown;
  };
}

export const ShadowCipherPrivateStateId = 'shadowCipherPrivateState';

export type ShadowCipherCircuits = ImpureCircuitId<ShadowCipherContract>;

export type ShadowCipherProviders = MidnightProviders<
  ShadowCipherCircuits,
  typeof ShadowCipherPrivateStateId,
  ShadowCipherPrivateState
>;

export type DeployedShadowCipherContract = 
  | DeployedContract<ShadowCipherContract>
  | FoundContract<ShadowCipherContract>;

export type GuessResult = {
  black: number;
  white: number;
};

export type UserAction = {
  action: 'idle' | 'initializing' | 'guessing' | 'verifying';
  message?: string;
};

export type DerivedState = {
  readonly ledger: ShadowCipherLedger;
  readonly privateState: ShadowCipherPrivateState;
  readonly userAction: UserAction;
  readonly guessHistory: Array<{
    guess: [number, number, number, number];
    black: number;
    white: number;
  }>;
};

export const emptyState: DerivedState = {
  ledger: {
    commitment: new Uint8Array(32),
    attempts: 0n,
    solved: false,
  },
  privateState: {
    secret: [0, 0, 0, 0],
    commitment: new Uint8Array(32),
  },
  userAction: { action: 'idle' },
  guessHistory: [],
};
