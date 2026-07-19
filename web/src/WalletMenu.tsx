import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { sessionId } from "./session.js";

/**
 * The session wallet, presented like a wallet: a compact balance pill in the AppBar that opens a
 * popover with SOL + USDC rows and the devnet funding action. The faucet lives HERE — never on the
 * prediction surface.
 */
export function WalletMenu() {
  const sid = sessionId();
  const [open, setOpen] = useState(false);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    api.balance(sid).then((b) => { setUsdc(b.balanceUsdc); setSol(b.balanceSol ?? 0); }).catch(() => {});
  }, [sid]);

  useEffect(() => { refresh(); const id = setInterval(refresh, 30_000); return () => clearInterval(id); }, [refresh]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [open]);

  const fund = async () => {
    setBusy(true); setNote("Requesting devnet funds…");
    try {
      const r = await api.faucet(sid, "you", 100);
      setUsdc(r.balanceUsdc); refresh();
      setNote("+100 USDC (devnet)");
    } catch (e) { setNote(`Funding failed — ${String(e).slice(0, 80)}`); }
    finally { setBusy(false); setTimeout(() => setNote(null), 4000); }
  };

  return (
    <div className="wmenu" ref={ref}>
      <button className="wpill mono" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="wallet balances">
        <span className="wsol">◎ {sol === null ? "—" : sol.toFixed(3)}</span>
        <span className="wsep" aria-hidden="true" />
        <span className="wusdc">{usdc === null ? "—" : usdc.toFixed(2)} <span className="wtick">USDC</span></span>
      </button>
      {open && (
        <div className="wpop" role="dialog" aria-label="wallet">
          <div className="wpop-head">Session wallet <span className="devnet">devnet</span></div>
          <div className="wrow"><span className="wicon sol" aria-hidden="true">◎</span><span>Solana</span><span className="mono wamt">{(sol ?? 0).toFixed(4)} SOL</span></div>
          <div className="wrow"><span className="wicon usdc" aria-hidden="true">$</span><span>USD Coin</span><span className="mono wamt">{(usdc ?? 0).toFixed(2)} USDC</span></div>
          <button className="wfund" onClick={fund} disabled={busy}>{busy ? "…" : "Get devnet funds"}</button>
          {note && <div className="wnote">{note}</div>}
          <div className="wfoot">Custodial demo wallet · devnet mock assets</div>
        </div>
      )}
    </div>
  );
}
