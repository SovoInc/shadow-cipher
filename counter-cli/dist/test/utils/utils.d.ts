/**
 * Convert mnemonic phrase to seed buffer using BIP39 standard
 * This generates a 64-byte seed as expected by Midnight HD wallet
 */
export declare const mnemonicToSeed: (mnemonic: string) => Promise<Buffer>;
export declare const randomBytes: (length: number) => Uint8Array;
export declare const tokenValue: (value: bigint) => bigint;
