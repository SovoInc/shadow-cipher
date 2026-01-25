import * as api from '../../api';
export declare function sendUnshieldedToken(wallet: api.WalletContext, address: string, amount: bigint): Promise<string>;
export declare function sendArbitraryUnshieldedToken(wallet: api.WalletContext, address: string, amount: bigint): Promise<string>;
