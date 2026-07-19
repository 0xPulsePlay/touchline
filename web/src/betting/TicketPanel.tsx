import { useCallback, useEffect, useState } from "react";
import { api, type ParlayQuote, type ParlayResult } from "../api.js";
import { flag } from "../flags.js";
import { sessionId } from "../session.js";
import { clearTicket, readTicket, removeLeg, type TicketLeg } from "./ticket.js";

const KICON: Record<string, string> = { up: "↗", down: "↘", band: "⇅", heartbreak: "💔", comeback: "🔄" };
const usd = (n: number) => `$${n.toFixed(2)}`;
const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

/**
 * The parlay ticket: legs collected from any match page ("＋ Parlay leg"), combined multiplier =
 * the product of leg prices, one stake, one on-chain escrow, pays only if EVERY leg hits.
 */
export function TicketPanel({ version, onChanged }: { version: number; onChanged: () => void }) {
  const sid = sessionId();
  const [legs, setLegs] = useState<TicketLeg[]>(readTicket());
  const [quote, setQuote] = useState<ParlayQuote | null>(null);
  const [stake, setStake] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [placed, setPlaced] = useState<ParlayResult | null>(null);
  const [settledMsg, setSettledMsg] = useState<{ outcome: string; sig: string; payout: number } | null>(null);

  useEffect(() => { setLegs(readTicket()); }, [version]);

  useEffect(() => {
    if (legs.length < 2) { setQuote(null); return; }
    let dead = false;
    api.parlayQuote(legs.map((l) => ({ fixtureId: l.fixtureId, side: l.side, kind: l.kind, barrier: l.barrier, barrier2: l.barrier2 })))
      .then((q) => !dead && setQuote(q))
      .catch((e) => !dead && setMsg(String(e).slice(0, 140)));
    return () => { dead = true; };
  }, [legs]);

  const drop = (i: number) => { setLegs(removeLeg(i)); onChanged(); };

  const place = async () => {
    if (!quote || legs.length < 2) return;
    setBusy("place"); setMsg("Escrowing the full payout on devnet…");
    try {
      const r = await api.placeParlay({ sessionId: sid, label: "you", usdc: stake, legs: legs.map((l) => ({ fixtureId: l.fixtureId, side: l.side, kind: l.kind, barrier: l.barrier, barrier2: l.barrier2 })) });
      setPlaced(r);
      setMsg(null);
      setLegs(clearTicket());
      onChanged();
    } catch (e) { setMsg(String(e).slice(0, 200)); } finally { setBusy(null); }
  };

  const settle = async () => {
    if (!placed) return;
    setBusy("settle"); setMsg("Resolving every leg with its Merkle proof…");
    try {
      for (const leg of placed.legs) {
        await api.resolveOnchain(leg.marketKey).catch(() => {}); // already-resolved legs are fine
      }
      const r = await api.claimParlay(placed.key);
      setSettledMsg({ outcome: r.outcome, sig: r.sig, payout: r.payoutUsdc });
      setMsg(null);
    } catch (e) { setMsg(String(e).slice(0, 200)); } finally { setBusy(null); }
  };

  if (!legs.length && !placed) return null;

  return (
    <section className="panel ticket">
      <div className="bet-head">
        <h2>Parlay ticket <span className="devnet">all legs must hit</span></h2>
        {legs.length > 0 && <button className="btn2" onClick={() => { setLegs(clearTicket()); onChanged(); }}>Clear</button>}
      </div>

      {legs.length > 0 && (
        <>
          <div className="tk-legs">
            {legs.map((l, i) => (
              <div className="tk-leg" key={`${l.fixtureId}-${l.side}-${l.kind}-${l.barrier}`}>
                <span className="tk-what">{KICON[l.kind]} {flag(l.sideName)} {l.sideName} · {l.kind === "band" ? `${l.barrier}% before ${l.barrier2}%` : `${l.barrier}%`}</span>
                <span className="tk-fix">{l.fixtureName}</span>
                <button className="tk-x" onClick={() => drop(i)} aria-label="remove leg">×</button>
              </div>
            ))}
          </div>
          {legs.length < 2 && <div className="dim">Add {2 - legs.length} more leg{legs.length === 1 ? "" : "s"} (any match, any market type).</div>}
          {quote && legs.length >= 2 && (
            <div className="q-body">
              <div className="q-price"><span className="big mono">{(quote.combinedPriceBps / 100).toFixed(1)}%</span><span className="q-sub">combined price</span></div>
              <div className="q-arrow">→</div>
              <div className="q-payout"><span className="big mono">{quote.payoutMult.toFixed(2)}×</span><span className="q-sub">if every leg hits</span></div>
              <div className="q-decomp mono">{quote.legs.map((l) => `${(l.priceBps / 100).toFixed(0)}%`).join(" × ")}</div>
            </div>
          )}
          {legs.length >= 2 && (
            <div className="bet-actions">
              <div className="stakebox">
                <span className="mono blabel">stake</span>
                <input className="stakein mono" type="number" min={1} max={10} step={1} value={stake}
                  onChange={(e) => setStake(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} aria-label="parlay stake" />
              </div>
              <button className="stakebtn place" disabled={busy === "place" || !quote} onClick={place}>
                {busy === "place" ? "Confirming…" : `Place ${legs.length}-leg parlay`}
              </button>
            </div>
          )}
        </>
      )}

      {placed && !settledMsg && (
        <div className="bet-msg ok">
          Parlay live on-chain — {usd(placed.amountUsdc)} → {usd(placed.payoutUsdc)} if all {placed.legs.length} legs hit.{" "}
          <a href={explorerTx(placed.sig)} target="_blank" rel="noreferrer">tx ↗</a>
          <button className="btn2 settle" style={{ marginLeft: 10 }} onClick={settle} disabled={busy === "settle"}>
            {busy === "settle" ? "Settling…" : "Settle all legs & claim →"}
          </button>
        </div>
      )}
      {settledMsg && (
        <div className={`settlement ${settledMsg.outcome}`}>
          <div className="s-head">
            <span className="s-outcome">{settledMsg.outcome === "yes" ? `✓ All legs hit — ${usd(settledMsg.payout)} claimed` : "A leg missed — house reclaims"}</span>
          </div>
          <div className="s-rows mono">
            <div className="s-row"><span>claim tx</span><a href={explorerTx(settledMsg.sig)} target="_blank" rel="noreferrer">{settledMsg.sig.slice(0, 8)}…{settledMsg.sig.slice(-6)} ↗</a></div>
          </div>
        </div>
      )}
      {msg && <div className="bet-msg ok">{msg}</div>}
    </section>
  );
}
