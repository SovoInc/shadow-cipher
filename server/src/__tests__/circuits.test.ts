/**
 * Contract circuit tests, run against the committed build of the contract
 * (no Compact compiler required).
 *
 * The commit/reveal design is the product's core security claim: the secret code
 * is committed on chain at game start, and a winning guess is proved against
 * that commitment without the code ever being revealed. None of it had test
 * coverage — these exercise the circuit surface and the witnesses the commitment
 * is built from, which is as far as the committed artifacts allow without a
 * proof server.
 */

import { describe, it, expect } from 'vitest';
import { ShadowCipher, shadowCipherWitnesses, type ShadowCipherPrivateState } from '@meshsdk/shadowcipher-contract';

type Code = [number, number, number, number];

const SALT_A = new Uint8Array(32).fill(7);
const SALT_B = new Uint8Array(32).fill(9);

const privateState = (code: Code, salt: Uint8Array = SALT_A): ShadowCipherPrivateState => ({ code, salt });

describe('the shipped contract surface', () => {
  it('exposes exactly the three circuits the product uses', () => {
    const contract = new ShadowCipher.Contract(shadowCipherWitnesses);
    expect(Object.keys(contract.circuits).sort()).toEqual([
      'create_game',
      'delete_game',
      'submit_guess',
    ]);
  });

  it('offers each circuit as a callable, in both impure and provable form', () => {
    // The server calls through contract.circuits; the proof path uses
    // impureCircuits. Both must carry all three, or a call site breaks.
    const contract = new ShadowCipher.Contract(shadowCipherWitnesses);
    for (const name of ['create_game', 'submit_guess', 'delete_game'] as const) {
      expect(typeof contract.circuits[name], name).toBe('function');
      expect(typeof contract.impureCircuits[name], name).toBe('function');
    }
  });

  it('requires the witnesses at construction', () => {
    // Constructing without them would let a caller build a contract that cannot
    // produce the commitment, failing only later inside a circuit.
    expect(() => new (ShadowCipher.Contract as never as new (w: unknown) => unknown)(undefined)).toThrow();
  });

  it('exposes a ledger reader for the games map', () => {
    expect(typeof ShadowCipher.ledger).toBe('function');
  });
});

describe('the witnesses that feed the commitment', () => {
  // The circuit computes the commitment from these two private values, so the
  // server's private state has to hand back exactly what the code committed.
  it('returns the four code positions as field elements', () => {
    const [, code] = shadowCipherWitnesses.secret_code({
      privateState: privateState([0, 1, 4, 5]),
    } as never);
    expect(code).toEqual([0n, 1n, 4n, 5n]);
  });

  it('returns every colour in the 0-5 domain unchanged', () => {
    for (let c = 0; c <= 5; c++) {
      const [, code] = shadowCipherWitnesses.secret_code({
        privateState: privateState([c, c, c, c]),
      } as never);
      expect(code).toEqual([BigInt(c), BigInt(c), BigInt(c), BigInt(c)]);
    }
  });

  it('returns the salt byte-for-byte', () => {
    const [, salt] = shadowCipherWitnesses.salt({
      privateState: privateState([0, 0, 0, 0], SALT_B),
    } as never);
    expect(Buffer.from(salt).equals(Buffer.from(SALT_B))).toBe(true);
  });

  it('is a 32-byte salt, as the commitment expects', () => {
    const [, salt] = shadowCipherWitnesses.salt({
      privateState: privateState([1, 2, 3, 4]),
    } as never);
    expect(salt.length).toBe(32);
  });

  it('leaves the private state unmodified', () => {
    // A witness that mutated state would desynchronise the commitment from what
    // submit_guess later proves against.
    const ps = privateState([1, 2, 3, 4]);
    const snapshot = { code: [...ps.code], salt: Uint8Array.from(ps.salt) };

    const [afterCode] = shadowCipherWitnesses.secret_code({ privateState: ps } as never);
    const [afterSalt] = shadowCipherWitnesses.salt({ privateState: ps } as never);

    expect(afterCode).toBe(ps);
    expect(afterSalt).toBe(ps);
    expect(ps.code).toEqual(snapshot.code);
    expect(Buffer.from(ps.salt).equals(Buffer.from(snapshot.salt))).toBe(true);
  });

  it('distinguishes two games that share a code but not a salt', () => {
    // Same code, different salt — the witnesses must report the difference, or
    // two games would commit identically.
    const [, saltA] = shadowCipherWitnesses.salt({ privateState: privateState([1, 1, 1, 1], SALT_A) } as never);
    const [, saltB] = shadowCipherWitnesses.salt({ privateState: privateState([1, 1, 1, 1], SALT_B) } as never);
    expect(Buffer.from(saltA).equals(Buffer.from(saltB))).toBe(false);
  });
});
