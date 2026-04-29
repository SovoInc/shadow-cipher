import {
  ConnectedAPI,
  InitialAPI,
  Configuration,
  ConnectionStatus,
} from "@midnight-ntwrk/dapp-connector-api";
import { type Logger } from "pino";

import {
  DustAddress,
  DustBalance,
  ShieldedAddress,
  ShieldedBalance,
  UnshieldedAddress,
  UnshieldedBalanceDappConnector,
} from "./common-types";
import { checkProofServerStatus } from "../utils/proofServer/utils";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

declare global {
  interface Window {
    midnight?: { [key: string]: InitialAPI };
  }
}

export class MidnightBrowserWallet {
  private constructor(
    public initialAPI: InitialAPI | undefined,
    public connectedAPI: ConnectedAPI | undefined,
    public serviceUriConfig: Configuration | undefined,
    public status: ConnectionStatus | undefined,
    public dustAddress: DustAddress | undefined,
    public dustBalance: DustBalance | undefined,
    public shieldedAddresses: ShieldedAddress | undefined,
    public shieldedBalances: ShieldedBalance | undefined,
    public unshieldedAddress: UnshieldedAddress | undefined,
    public unshieldedBalances: UnshieldedBalanceDappConnector | undefined,
    public proofServerOnline: boolean = false,
    public logger?: Logger
  ) {}

  static getAvailableWallets(): InitialAPI[] {
    if (window === undefined) return [];
    if (window.midnight === undefined) return [];

    const wallets: InitialAPI[] = [];
    for (const key in window.midnight) {
      try {
        const _wallet = window.midnight[key];
        if (_wallet === undefined) continue;
        if (typeof _wallet.connect !== "function") continue;
        const name = _wallet.name ?? key;
        wallets.push({
          name,
          apiVersion: _wallet.apiVersion ?? "0.0.0",
          connect: _wallet.connect,
          icon: _wallet.icon,
          rdns: _wallet.rdns ?? key,
        });
      } catch (e) {
        console.log(e);
      }
    }
    return wallets;
  }

  static getMidnightWalletConnected(): { rdns: string | null; networkID: string | null } {
    const rdns = window.localStorage.getItem("rdns-connected");
    const networkID = window.localStorage.getItem("network-id");
    return { rdns, networkID };
  }

  static setMidnightWalletConnected(rdns: string, networkID: string, logger?: Logger): void {
    if (logger) {
      logger.trace(`Setting wallet auto connect to ${rdns}`);
    }
    window.localStorage.setItem("rdns-connected", rdns);
    window.localStorage.setItem("network-id", networkID);
  }

  static deleteMidnightWalletConnected(logger?: Logger): void {
    if (logger) {
      logger.trace("Deleting wallet auto connect ");
    }
    window.localStorage.removeItem("rdns-connected");
    window.localStorage.removeItem("network-id");
  }

  static findWalletAPI(rdns: string): InitialAPI | undefined {
    if (!window.midnight) return undefined;
    // First try direct key lookup (legacy behavior)
    if (window.midnight[rdns]) return window.midnight[rdns];
    // Search by name or rdns property (Lace registers under a UUID key)
    for (const key of Object.keys(window.midnight)) {
      const api = window.midnight[key];
      if (api && (api.name === rdns || api.rdns === rdns)) return api;
    }
    return undefined;
  }

  static async connectToWallet(
    rdns: string,
    networkID: string,
    logger?: Logger
  ): Promise<MidnightBrowserWallet> {
    const initialAPI = MidnightBrowserWallet.findWalletAPI(rdns);
    if (!initialAPI) {
      logger?.error("Could not find wallet initial API");
      throw new Error("Could not find wallet initial API");
    }

    logger?.info(initialAPI, "Compatible wallet initial API found. Connecting.");

    let connectedAPI: ConnectedAPI;
    try {
      connectedAPI = await initialAPI.connect(networkID);
    } catch (err) {
      logger?.error(err, "Unable to enable connector API");
      throw new Error("Application is not authorized");
    }
    if (!connectedAPI) throw new Error("Connected API is undefined");

    const serviceUriConfig = await connectedAPI.getConfiguration();
    const status = await connectedAPI.getConnectionStatus();
    const dustAddress = await connectedAPI.getDustAddress();
    const dustBalance = await connectedAPI.getDustBalance();
    const shieldedAddresses = await connectedAPI.getShieldedAddresses();
    const shieldedBalances = await connectedAPI.getShieldedBalances();
    const unshieldedAddress = await connectedAPI.getUnshieldedAddress();
    const unshieldedBalances = await connectedAPI.getUnshieldedBalances();
    const proofServerOnline = await checkProofServerStatus(
      serviceUriConfig.proverServerUri
    );

    logger?.info("Connected to wallet");

    const wallet = new MidnightBrowserWallet(
      initialAPI,
      connectedAPI,
      serviceUriConfig,
      status,
      dustAddress,
      dustBalance,
      shieldedAddresses,
      shieldedBalances,
      unshieldedAddress,
      unshieldedBalances,
      proofServerOnline,
      logger
    );

    const connectedNetworkID =
      status.status === "connected" ? status.networkId : null;
    if (connectedNetworkID === null) throw new Error("Network ID is null");
    MidnightBrowserWallet.setMidnightWalletConnected(rdns, connectedNetworkID, logger);
    setNetworkId(connectedNetworkID);

    return wallet;
  }

  disconnect(logger?: Logger): void {
    MidnightBrowserWallet.deleteMidnightWalletConnected(logger);
    this.initialAPI = undefined;
    this.connectedAPI = undefined;
    this.serviceUriConfig = undefined;
    this.status = undefined;
    this.dustAddress = undefined;
    this.dustBalance = undefined;
    this.shieldedAddresses = undefined;
    this.shieldedBalances = undefined;
    this.unshieldedAddress = undefined;
    this.unshieldedBalances = undefined;
  }

  async refresh(): Promise<void> {
    if (this.connectedAPI === undefined) return;
    this.serviceUriConfig = await this.connectedAPI.getConfiguration();
    this.status = await this.connectedAPI.getConnectionStatus();
    this.dustAddress = await this.connectedAPI.getDustAddress();
    this.dustBalance = await this.connectedAPI.getDustBalance();
    this.shieldedAddresses = await this.connectedAPI.getShieldedAddresses();
    this.shieldedBalances = await this.connectedAPI.getShieldedBalances();
    this.unshieldedAddress = await this.connectedAPI.getUnshieldedAddress();
    this.unshieldedBalances = await this.connectedAPI.getUnshieldedBalances();
    this.proofServerOnline = await checkProofServerStatus(
      this.serviceUriConfig.proverServerUri
    );
  }
}
