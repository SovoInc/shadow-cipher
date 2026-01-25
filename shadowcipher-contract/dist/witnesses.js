export const createPrivateState = (secret, commitment) => {
    return { secret, commitment };
};
export const generateRandomSecret = () => {
    return [
        Math.floor(Math.random() * 6),
        Math.floor(Math.random() * 6),
        Math.floor(Math.random() * 6),
        Math.floor(Math.random() * 6),
    ];
};
// Compute commitment hash from secret (simplified)
export const computeCommitment = (secret) => {
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
//# sourceMappingURL=witnesses.js.map