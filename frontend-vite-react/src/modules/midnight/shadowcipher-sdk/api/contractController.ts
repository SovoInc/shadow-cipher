import { type Logger } from 'pino';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import * as Rx from 'rxjs';
import {
  DerivedState,
  emptyState,
  GuessResult,
  ShadowCipherPrivateState,
  ShadowCipherPrivateStateId,
  ShadowCipherProviders,
  UserAction,
} from './common-types';
import { ShadowCipher } from '@meshsdk/shadowcipher-contract';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';

export const shadowCipherCompiledContract = CompiledContract.make('shadowcipher', ShadowCipher.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets('shadowcipher'),
);

// Helper functions for game logic (client-side)
export const generateRandomSecret = (): [number, number, number, number] => {
  return [
    Math.floor(Math.random() * 6),
    Math.floor(Math.random() * 6),
    Math.floor(Math.random() * 6),
    Math.floor(Math.random() * 6),
  ] as [number, number, number, number];
};

export const computeCommitment = async (secret: [number, number, number, number]): Promise<Uint8Array> => {
  const data = new Uint8Array([secret[0], secret[1], secret[2], secret[3]]);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
};

// Calculate pegs client-side for immediate feedback
export const calculatePegs = (
  guess: [number, number, number, number],
  secret: [number, number, number, number]
): GuessResult => {
  let black = 0;
  let white = 0;
  const secretCopy = [...secret];
  const guessCopy = [...guess];

  // First pass: count exact matches (black pegs)
  for (let i = 0; i < 4; i++) {
    if (guessCopy[i] === secretCopy[i]) {
      black++;
      secretCopy[i] = -1;
      guessCopy[i] = -2;
    }
  }

  // Second pass: count color matches in wrong position (white pegs)
  for (let i = 0; i < 4; i++) {
    if (guessCopy[i] >= 0) {
      const idx = secretCopy.indexOf(guessCopy[i]);
      if (idx !== -1) {
        white++;
        secretCopy[idx] = -1;
      }
    }
  }

  return { black, white };
};

export interface ShadowCipherControllerInterface {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Rx.Observable<DerivedState>;
  initialize: () => Promise<void>;
  submitGuess: (guess: [number, number, number, number]) => Promise<GuessResult>;
  getSecret: () => [number, number, number, number];
}

export class ShadowCipherController implements ShadowCipherControllerInterface {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Rx.Observable<DerivedState>;
  readonly privateStates$: Rx.Subject<ShadowCipherPrivateState>;
  readonly actions$: Rx.Subject<UserAction>;
  readonly guessHistory$: Rx.BehaviorSubject<
    Array<{ guess: [number, number, number, number]; black: number; white: number }>
  >;

  private currentPrivateState: ShadowCipherPrivateState;

  private constructor(
    public readonly contractPrivateStateId: typeof ShadowCipherPrivateStateId,
    public readonly deployedContract: any,
    public readonly providers: ShadowCipherProviders,
    private readonly logger: Logger
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    this.actions$ = new Rx.Subject<UserAction>();
    this.privateStates$ = new Rx.Subject<ShadowCipherPrivateState>();
    this.guessHistory$ = new Rx.BehaviorSubject<
      Array<{ guess: [number, number, number, number]; black: number; white: number }>
    >([]);

    // Initialize private state with random secret
    // Note: commitment is set asynchronously after construction via initCommitment()
    const secret = generateRandomSecret();
    this.currentPrivateState = { secret, commitment: new Uint8Array(32) };
    this.initCommitment(secret);

    this.state$ = Rx.combineLatest([
      providers.publicDataProvider
        .contractStateObservable(this.deployedContractAddress, { type: 'all' })
        .pipe(
          Rx.map((contractState) => {
            const ledgerState = ShadowCipher.ledger(contractState.data);
            return {
              commitment: ledgerState.commitment,
              attempts: ledgerState.attempts,
              solved: ledgerState.solved,
            };
          })
        ),
      Rx.concat(Rx.of(this.currentPrivateState), this.privateStates$),
      Rx.concat(Rx.of<UserAction>({ action: 'idle' }), this.actions$),
      this.guessHistory$,
    ]).pipe(
      Rx.map(([ledger, privateState, userAction, guessHistory]) => ({
        ledger,
        privateState,
        userAction,
        guessHistory,
      })),
      Rx.retry({ delay: 500 })
    );
  }

  private async initCommitment(secret: [number, number, number, number]) {
    const commitment = await computeCommitment(secret);
    this.currentPrivateState = { ...this.currentPrivateState, commitment };
    this.privateStates$.next(this.currentPrivateState);
  }

  getSecret(): [number, number, number, number] {
    return this.currentPrivateState.secret;
  }

  async initialize(): Promise<void> {
    this.logger?.info('Initializing game with new secret');
    this.actions$.next({ action: 'initializing', message: 'Generating ZK commitment...' });

    try {
      const secret = generateRandomSecret();
      const commitment = await computeCommitment(secret);
      this.currentPrivateState = { secret, commitment };
      this.privateStates$.next(this.currentPrivateState);
      this.guessHistory$.next([]);

      // Call initialize circuit with commitment
      await this.deployedContract.callTx.initialize(commitment);

      this.actions$.next({ action: 'idle' });
      this.logger?.info('Game initialized successfully');
    } catch (e) {
      this.actions$.next({ action: 'idle' });
      throw e;
    }
  }

  async submitGuess(guess: [number, number, number, number]): Promise<GuessResult> {
    this.logger?.info({ guess }, 'Submitting guess');
    this.actions$.next({ action: 'guessing', message: 'Generating ZK proof...' });

    try {
      // Calculate result client-side first (for immediate feedback)
      const result = calculatePegs(guess, this.currentPrivateState.secret);
      const isSolved = result.black === 4;

      // Call record_guess circuit
      await this.deployedContract.callTx.record_guess(isSolved);

      // Update guess history
      const history = this.guessHistory$.value;
      this.guessHistory$.next([...history, { guess, black: result.black, white: result.white }]);

      this.actions$.next({ action: 'idle' });
      return result;
    } catch (e) {
      this.actions$.next({ action: 'idle' });
      throw e;
    }
  }

  static async deploy(
    contractPrivateStateId: typeof ShadowCipherPrivateStateId,
    providers: ShadowCipherProviders,
    logger: Logger
  ): Promise<ShadowCipherController> {
    logger.info('Deploying ShadowCipher contract');

    try {
      // Network ID is set by the caller (useShadowCipherContract hook) before deploy
      // setNetworkId() sets a global state that the ledger library uses when:
      // - Creating transactions via deployContract() -> createUnprovenDeployTx()
      // - The ledger reads this via @midnight-ntwrk/midnight-js-network-id
      // This MUST be set synchronously before deployContract() is called
      
      const secret = generateRandomSecret();
      const commitment = await computeCommitment(secret);
      const initialPrivateState: ShadowCipherPrivateState = { secret, commitment };

      // deployContract() from @midnight-ntwrk/midnight-js-contracts will:
      // 1. Create unproven transaction using the network ID from setNetworkId()
      // 2. Call walletProvider.balanceTx() which sends tx to wallet extension
      // 3. Wallet extension balances the transaction (may embed its own network ID)
      // 4. The balanced transaction is returned and then proven/submitted
      const deployedContract = await deployContract(providers, {
        privateStateId: contractPrivateStateId,
        compiledContract: shadowCipherCompiledContract,
        initialPrivateState,
      });

      logger.info({
        contractAddress: deployedContract.deployTxData.public.contractAddress,
      }, 'Contract deployed');

      return new ShadowCipherController(
        contractPrivateStateId,
        deployedContract,
        providers,
        logger
      );
    } catch (error) {
      logger.error(error, 'Error deploying ShadowCipher contract');
      // Log cause if it exists (for FiberFailure)
      if (error && typeof error === 'object' && 'cause' in error) {
        const cause = (error as any).cause;
        logger.error(cause, 'Deploy error cause');
        // Extract failure message from nested structure
        if (cause && typeof cause === 'object' && 'failure' in cause) {
          const failure = (cause as any).failure;
          if (failure && typeof failure === 'object' && 'message' in failure) {
            logger.error({ failureMessage: failure.message, failure }, 'Deploy error failure details');
            console.error('Actual error message:', failure.message);
          }
        }
      }
      throw error;
    }
  }

  static async join(
    contractPrivateStateId: typeof ShadowCipherPrivateStateId,
    providers: ShadowCipherProviders,
    contractAddress: ContractAddress,
    logger: Logger
  ): Promise<ShadowCipherController> {
    logger.info({ contractAddress }, 'Joining ShadowCipher contract');

    const secret = generateRandomSecret();
    const commitment = await computeCommitment(secret);
    const initialPrivateState: ShadowCipherPrivateState = { secret, commitment };

    const deployedContract = await findDeployedContract(providers, {
      contractAddress,
      compiledContract: shadowCipherCompiledContract,
      privateStateId: contractPrivateStateId,
      initialPrivateState,
    });

    return new ShadowCipherController(
      contractPrivateStateId,
      deployedContract,
      providers,
      logger
    );
  }
}
