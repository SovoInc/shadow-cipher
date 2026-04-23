import { Button } from "./common/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./common/dialog";
import { Network } from "lucide-react";
import { networkID } from "./common/common-values";
import ConnectedButton from "./connected-button";
import ScreenMain from "./screen-main";
import { useWallet } from "../hooks/useWallet";

export const MidnightWallet = () => {
  const { open, setOpen, status } = useWallet();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div>
        {status?.status === undefined ? (
          <DialogTrigger asChild>
            <Button variant="outline" className="">
              Connect Wallet
            </Button>
          </DialogTrigger>
        ) : (
          <ConnectedButton />
        )}
      </div>

      <DialogContent
        className="sm:max-w-[425px] justify-center items-center border-2 border-white dark:border-gray-800"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Header />
        <ScreenMain setOpen={setOpen} selectedNetwork={networkID.MAINNET} />
        <Footer />
      </DialogContent>
    </Dialog>
  );
};

function Header() {
  return (
    <DialogHeader className="pb-4 space-y-3">
      <DialogTitle className="text-lg font-semibold text-center">
        Connect Wallet
      </DialogTitle>

      <div className="flex justify-center">
        <div className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border border-input bg-background">
          <Network className="h-3 w-3 mr-1" />
          MAINNET
        </div>
      </div>
    </DialogHeader>
  );
}

function Footer() {
  return (
    <DialogFooter className="justify-center text-sm">
      <div className="flex gap-1 items-center justify-center">
        <span className="text-accent-foreground">Powered by</span>
        <a
          href="https://meshjs.dev/"
          target="_blank"
          className="flex items-center gap-1 text-accent-foreground hover:text-zinc-500 fill-foreground hover:fill-zinc-500 dark:hover:text-orange-200 dark:hover:fill-zinc-200"
        >
          <img
            src="/meshlogo-with-title-white.svg"
            alt="Mesh"
            className="h-4 dark:block hidden object-contain"
            style={{ width: "auto" }}
          />
          <img
            src="/meshlogo-with-title-black.svg"
            alt="Mesh"
            className="h-4 dark:hidden block object-contain"
            style={{ width: "auto" }}
          />
        </a>
        <span className="mx-1 text-accent-foreground">&</span>
        <a
          href="https://eddalabs.io/"
          target="_blank"
          className="flex items-center gap-1 text-accent-foreground hover:text-zinc-500 fill-foreground hover:fill-zinc-500 dark:hover:text-orange-200 dark:hover:fill-zinc-200"
        >
          <img
            src="/transparent-logo-white.svg"
            alt="Edda Labs"
            className="h-3 dark:block hidden object-contain"
            style={{ width: "auto" }}
          />
          <img
            src="/transparent-logo-black.svg"
            alt="Edda Labs"
            className="h-3 dark:hidden block object-contain"
            style={{ width: "auto" }}
          />
        </a>
      </div>
    </DialogFooter>
  );
}
