import path from 'node:path';

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

export const contractConfig = {
  zkConfigPath: path.resolve(currentDir, '..', '..', 'shadowcipher-contract', 'src', 'managed', 'shadowcipher'),
};

export interface Config {
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
  readonly networkId: string;
}

export class PreviewConfig implements Config {
  indexer = 'https://indexer.preview.midnight.network/api/v3/graphql';
  indexerWS = 'wss://indexer.preview.midnight.network/api/v3/graphql/ws';
  node = 'https://rpc.preview.midnight.network';
  proofServer = process.env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300';
  networkId = 'preview';
}

export class PreprodConfig implements Config {
  indexer = 'https://indexer.preprod.midnight.network/api/v3/graphql';
  indexerWS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
  node = 'https://rpc.preprod.midnight.network';
  proofServer = process.env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300';
  networkId = 'preprod';
}

export class MainnetConfig implements Config {
  indexer = 'https://indexer.midnight.network/api/v3/graphql';
  indexerWS = 'wss://indexer.midnight.network/api/v3/graphql/ws';
  node = 'https://rpc.midnight.network';
  proofServer = process.env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300';
  networkId = 'mainnet';
}

export function getConfig(): Config {
  const network = process.env.MIDNIGHT_NETWORK ?? 'preprod';
  switch (network) {
    case 'preview': return new PreviewConfig();
    case 'preprod': return new PreprodConfig();
    case 'mainnet': return new MainnetConfig();
    default: return new PreprodConfig();
  }
}
