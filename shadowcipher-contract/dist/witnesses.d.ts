export type ShadowCipherPrivateState = {
    secret: [number, number, number, number];
    commitment: Uint8Array;
};
export declare const createPrivateState: (secret: [number, number, number, number], commitment: Uint8Array) => ShadowCipherPrivateState;
export declare const generateRandomSecret: () => [number, number, number, number];
export declare const computeCommitment: (secret: [number, number, number, number]) => Uint8Array;
export declare const witnesses: {};
