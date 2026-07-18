import { useState } from "react";
import { connectWallet, disconnectWallet, rememberedWallet, shortKey } from "./wallet.js";

/** Shared top bar for both pages: brand (→ home), an optional back link on the
 *  market page, and the wallet connect toggle. Wallet state persists via wallet.ts,
 *  so the connected pill reads consistently across a home↔market navigation. */
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
