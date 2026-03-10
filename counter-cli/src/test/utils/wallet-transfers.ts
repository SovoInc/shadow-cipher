import * as api from '../../api';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v7';
import { tokenValue } from './utils';
import { MidnightBech32m, ShieldedAddress, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

/**
 * Transfer unshielded tokens using the new wallet SDK API.
 * Uses balanceUnboundTransaction + finalizeRecipe instead of the removed
 * transferTransaction + signTransaction pattern.
 */
export async function sendUnshieldedToken(wallet: api.WalletContext, address: string, amount: bigint): Promise<string> {
  const outputs = [
    {
      type: unshieldedToken().raw,
      value: tokenValue(amount),
      owner: address,
    },
  ];

  const intent = ledger.Intent.new(new Date(Date.now() + 30 * 60 * 1000));
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([], outputs, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arbitraryTx = ledger.Transaction.fromParts(getNetworkId() as any, undefined, undefined, intent);

  const recipe = await wallet.wallet.balanceUnboundTransaction(
    arbitraryTx as any,
    { shieldedSecretKeys: wallet.shieldedSecretKeys, dustSecretKey: wallet.dustSecretKey },
    { ttl: new Date(Date.now() + 30 * 60 * 1000) },
  );

  const finalizedTx = await wallet.wallet.finalizeRecipe(recipe);
  const submittedTxHash = await wallet.wallet.submitTransaction(finalizedTx);

  return submittedTxHash;
}

/**
 * Transfer arbitrary unshielded tokens to a specific address.
 */
export async function sendArbitraryUnshieldedToken(wallet: api.WalletContext, address: string, amount: bigint): Promise<string> {
  const addressBech32m = MidnightBech32m.parse(address);
  const addressHex = UnshieldedAddress.codec.decode("undeployed", addressBech32m);

  const outputs = [
    {
      type: unshieldedToken().raw,
      value: tokenValue(amount),
      owner: addressHex.hexString,
    },
  ];

  const intent = ledger.Intent.new(new Date(Date.now() + 30 * 60 * 1000));
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([], outputs, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arbitraryTx = ledger.Transaction.fromParts("undeployed" as any, undefined, undefined, intent);

  const recipe = await wallet.wallet.balanceUnboundTransaction(
    arbitraryTx as any,
    { shieldedSecretKeys: wallet.shieldedSecretKeys, dustSecretKey: wallet.dustSecretKey },
    { ttl: new Date(Date.now() + 30 * 60 * 1000) },
  );

  const finalizedTx = await wallet.wallet.finalizeRecipe(recipe);
  const submittedTxHash = await wallet.wallet.submitTransaction(finalizedTx);

  return submittedTxHash;
}
