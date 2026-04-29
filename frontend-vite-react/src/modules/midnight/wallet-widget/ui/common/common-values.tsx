import { JSX } from "react";
import IconLace from "./icons/icon-lace";

const Icon1AM = (): JSX.Element => (
  <div
    style={{
      width: 40,
      height: 40,
      borderRadius: 8,
      background: "#0a0a0a",
      color: "#00ff41",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Courier New', monospace",
      fontWeight: 700,
      fontSize: 13,
      letterSpacing: "0.05em",
    }}
  >
    1AM
  </div>
);

export const walletsListFormat: {
    [key: string]: { key: string; displayName: string; icon: JSX.Element };
  } = {
    lace: { key: "lace", displayName: "LACE", icon: <IconLace /> },
    "1am": { key: "1am", displayName: "1AM", icon: <Icon1AM /> },
    "midnight-1am-wallet": { key: "1am", displayName: "1AM", icon: <Icon1AM /> },
  };

export enum networkID {
  MAINNET = "mainnet"
}
