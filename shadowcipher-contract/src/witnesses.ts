// ShadowCipher private state — holds the secret 4-color code and per-game salt
export type ShadowCipherPrivateState = {
  code: [number, number, number, number]; // 4 color values (0-5)
  salt: Uint8Array; // 32 random bytes, generated fresh per game
};

export const shadowCipherWitnesses = {
  secret_code: ({
    privateState,
  }: {
    privateState: ShadowCipherPrivateState;
  }): [ShadowCipherPrivateState, bigint[]] => {
    return [
      privateState,
      [
        BigInt(privateState.code[0]),
        BigInt(privateState.code[1]),
        BigInt(privateState.code[2]),
        BigInt(privateState.code[3]),
      ],
    ];
  },
  salt: ({
    privateState,
  }: {
    privateState: ShadowCipherPrivateState;
  }): [ShadowCipherPrivateState, Uint8Array] => {
    return [privateState, privateState.salt];
  },
};

// No vacant witnesses — this contract requires secret_code and salt
export const witnesses = shadowCipherWitnesses;
