import { Counter, type CounterPrivateState } from '@eddalabs/counter-contract';
import type { ImpureCircuitId, MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
export type CounterCircuits = ImpureCircuitId<Counter.Contract<CounterPrivateState>>;
export declare const CounterPrivateStateId = "counterPrivateState";
export type CounterProviders = MidnightProviders<CounterCircuits, typeof CounterPrivateStateId, CounterPrivateState>;
export type CounterContract = Counter.Contract<CounterPrivateState>;
export type DeployedCounterContract = DeployedContract<CounterContract> | FoundContract<CounterContract>;
export type UserAction = {
    increment: string | undefined;
};
export type DerivedState = {
    readonly round: Counter.Ledger["round"];
};
export declare const emptyState: DerivedState;
