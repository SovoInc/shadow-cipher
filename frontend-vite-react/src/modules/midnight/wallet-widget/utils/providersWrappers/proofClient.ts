import type { ProofProvider, ZKConfigProvider } from "@midnight-ntwrk/midnight-js-types";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";

export const proofClient = <K extends string>(
  url: string,
  zkConfigProvider: ZKConfigProvider<K>,
  callback: (status: "proveTxStarted" | "proveTxDone") => void
): ProofProvider => {
  const httpClientProvider = httpClientProofProvider(url.trim(), zkConfigProvider);
  return {
    proveTx(tx, proveTxConfig?) {
      callback("proveTxStarted");
      return httpClientProvider.proveTx(tx, proveTxConfig).finally(() => {
        callback("proveTxDone");
      });
    },
  };
};

export const noopProofClient = (): ProofProvider => {
  return {
    proveTx() {
      return Promise.reject(new Error("Proof server not available"));
    },
  };
};
