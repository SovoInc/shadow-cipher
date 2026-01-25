export type ShadowCipherPrivateState = {
  secret: [number, number, number, number]; // 4 color values (0-5)
  commitment: Uint8Array; // 32 bytes
};

export const createPrivateState = (
  secret: [number, number, number, number],
  commitment: Uint8Array
): ShadowCipherPrivateState => {
  return { secret, commitment };
};

export const generateRandomSecret = (): [number, number, number, number] => {
  return [
    Math.floor(Math.random() * 6),
    Math.floor(Math.random() * 6),
    Math.floor(Math.random() * 6),
    Math.floor(Math.random() * 6),
  ];
};

// Compute commitment hash from secret (simplified)
export const computeCommitment = (
  secret: [number, number, number, number]
): Uint8Array => {
  const buffer = new Uint8Array(32);
  buffer[0] = secret[0];
  buffer[1] = secret[1];
  buffer[2] = secret[2];
  buffer[3] = secret[3];
  for (let i = 4; i < 32; i++) {
    buffer[i] = (secret[i % 4] * 37 + i) % 256;
  }
  return buffer;
};

// No witnesses needed for this simple contract
export const witnesses = {};
