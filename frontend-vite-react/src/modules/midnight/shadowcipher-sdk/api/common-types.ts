import type { ImpureCircuitId, MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';

// Types will be generated from compact contract - for now define interfaces
export interface ShadowCipherLedger {
  readonly commitment: Uint8Array;
  readonly attempts: bigint;
  readonly black_pegs: bigint;
  readonly white_pegs: bigint;
  readonly solved: boolean;
}

export type ShadowCipherPrivateState = {
  secret: [number, number, number, number];
  commitment: Uint8Array;
};

export interface ShadowCipherContract {
  circuits: {
    initialize: (context: unknown, commitment: Uint8Array) => unknown;
    verify_guess: (
      context: unknown,
      guess_0: bigint,
      guess_1: bigint,
      guess_2: bigint,
      guess_3: bigint
    ) => unknown;
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
    black_pegs: 0n,
    white_pegs: 0n,
    solved: false,
  },
  privateState: {
    secret: [0, 0, 0, 0],
    commitment: new Uint8Array(32),
  },
  userAction: { action: 'idle' },
  guessHistory: [],
};
