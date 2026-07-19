import { useState } from "react";
import { connectWallet, disconnectWallet, rememberedWallet, shortKey } from "./wallet.js";
import { WalletMenu } from "./WalletMenu.js";

/** Shared top bar for both pages: brand (→ home), an optional back link on the
 *  market page, the session-wallet balance pill (SOL/USDC + devnet funding), and the
 *  Phantom connect toggle. Wallet state persists via wallet.ts. */
export function AppBar({ back, tag }: { back?: boolean; tag?: string }) {
  const [wallet, setWallet] = useState<string | null>(rememberedWallet());

  const toggle = async () => {
    if (wallet) { await disconnectWallet(); setWallet(null); return; }
    try { setWallet(await connectWallet()); } catch { /* user dismissed */ }
  };

  return (
    <header className="appbar">
      {back && (
        <a className="backlink" href="#/" aria-label="Back to all matches">
          <span aria-hidden="true">←</span> Matches
        </a>
      )}
      <a className="brand" href="#/">TOUCH<span className="tick">LINE</span></a>
      {tag && <span className="appbar-tag">{tag}</span>}
      <div className="spacer" />
      <WalletMenu />
      <button
        className={`walletbtn${wallet ? " connected" : ""}`}
        onClick={toggle}
        title={wallet ? "Disconnect" : "Connect Phantom"}
      >
        {wallet ? <><span className="wdot" aria-hidden="true" /> {shortKey(wallet)}</> : "Connect wallet"}
      </button>
    </header>
  );
}
