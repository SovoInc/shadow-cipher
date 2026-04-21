import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  secret_code(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint[]];
  salt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  create_game(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  submit_guess(context: __compactRuntime.CircuitContext<PS>,
               game_id_0: bigint,
               g0_0: bigint,
               g1_0: bigint,
               g2_0: bigint,
               g3_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  delete_game(context: __compactRuntime.CircuitContext<PS>, game_id_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  create_game(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  submit_guess(context: __compactRuntime.CircuitContext<PS>,
               game_id_0: bigint,
               g0_0: bigint,
               g1_0: bigint,
               g2_0: bigint,
               g3_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  delete_game(context: __compactRuntime.CircuitContext<PS>, game_id_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  create_game(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  submit_guess(context: __compactRuntime.CircuitContext<PS>,
               game_id_0: bigint,
               g0_0: bigint,
               g1_0: bigint,
               g2_0: bigint,
               g3_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  delete_game(context: __compactRuntime.CircuitContext<PS>, game_id_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly next_game_id: bigint;
  games: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): { commitment: Uint8Array, active: boolean };
    [Symbol.iterator](): Iterator<[bigint, { commitment: Uint8Array, active: boolean }]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
