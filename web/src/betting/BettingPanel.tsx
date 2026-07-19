import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ActivityBet, type ChainState, type DealerQuote, type Fixture, type Side, type Treasury } from "../api.js";
import { flag } from "../flags.js";
import "./betting.css";

const usd = (n: number) => (n < 0 ? `−$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`);

/** A stable per-browser session id (the custodial demo wallet key on the server). */
function sessionId(): string {
  let s = localStorage.getItem("touchline.session");
  if (!s) { s = "web-" + Math.random().toString(36).slice(2, 10); localStorage.setItem("touchline.session", s); }
  return s;
}

const pctBps = (b: number) => `${(b / 100).toFixed(1)}%`;

export function BettingPanel({ fixture, side, setSide, barrier, setBarrier, names }: {
  fixture: Fixture; side: Side; setSide: (s: Side) => void;
  barrier: number; setBarrier: (b: number) => void;
  names: { part1: string; draw: string; part2: string };
}) {
  const sid = sessionId();
  const [chain, setChain] = useState<ChainState | null>(null);
  const [bal, setBal] = useState<number | null>(null);
  const [quote, setQuote] = useState<DealerQuote | null>(null);
  const [activity, setActivity] = useState<ActivityBet[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const lastBet = useRef<{ sig: string; marketKey: string } | null>(null);

  useEffect(() => { api.chainState().then(setChain).catch(() => {}); }, []);
  const refreshBal = useCallback(() => api.balance(sid).then((b) => setBal(b.balanceUsdc)).catch(() => {}), [sid]);
  useEffect(() => { refreshBal(); }, [refreshBal]);

  const refreshTreasury = useCallback(() => {
    const key = lastBet.current?.marketKey;
    if (!key) return;
    api.treasury(key).then(setTreasury).catch(() => {});
  }, []);
  // keep the hedge book live while a market is in play (bots trade into the same book)
  useEffect(() => {
    if (!lastBet.current) return;
    const id = setInterval(refreshTreasury, 4000);
    return () => clearInterval(id);
  }, [refreshTreasury, treasury?.marketKey]);

  // quote follows the barrier/side (gated on the server)
  useEffect(() => {
    let dead = false;
    api.dealerQuote(fixture.fixtureId, side, barrier).then((q) => !dead && setQuote(q)).catch(() => setQuote(null));
    return () => { dead = true; };
  }, [fixture.fixtureId, side, barrier]);

  // activity feed polls
  useEffect(() => {
    const tick = () => api.activity().then(setActivity).catch(() => {});
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, []);

  const faucet = async () => {
    setBusy("faucet"); setMsg({ kind: "ok", text: "Minting 100 tUSDC on devnet…" });
    try { const r = await api.faucet(sid, "you", 100); setBal(r.balanceUsdc); setMsg({ kind: "ok", text: `+100 tUSDC — balance ${r.balanceUsdc.toFixed(2)}` }); }
    catch (e) { setMsg({ kind: "err", text: `Faucet failed — ${String(e)}` }); } finally { setBusy(null); }
  };

  const placeBet = async (usdc: number) => {
    if (!quote?.valid) { setMsg({ kind: "err", text: quote?.reason ?? "invalid barrier" }); return; }
    setBusy("bet"); setMsg({ kind: "ok", text: "Confirming on devnet — co-signing + escrowing the payout…" });
    try {
      const r = await api.bet({ sessionId: sid, label: "you", fixtureId: fixture.fixtureId, side, barrier, usdc });
      lastBet.current = { sig: r.sig, marketKey: r.marketKey };
      setMsg({ kind: "ok", text: `Bet placed on-chain — $${r.amountUsdc} → $${r.payoutUsdc.toFixed(2)} if it touches. tx ${r.sig.slice(0, 8)}…` });
      refreshBal(); refreshTreasury(); api.activity().then(setActivity).catch(() => {});
    } catch (e) { setMsg({ kind: "err", text: String(e) }); } finally { setBusy(null); }
  };

  const settle = async () => {
    if (!lastBet.current) return;
    setBusy("settle"); setMsg(null);
    try {
      const res = await api.resolveOnchain(lastBet.current.marketKey);
      if (res.outcome === "yes") {
        await api.claim(lastBet.current.sig);
        const v = res.receipt?.verification;
        setMsg({ kind: "ok", text: `Resolved YES — settled from a ${res.verified ? "mainnet-verified" : ""} Merkle proof${v ? ` (PDA ${v.pda.slice(0, 8)}…)` : ""}. Payout claimed.` });
      } else {
        setMsg({ kind: "ok", text: "Resolved NO — barrier never touched; house keeps the stake." });
      }
      refreshBal(); refreshTreasury(); api.activity().then(setActivity).catch(() => {});
    } catch (e) { setMsg({ kind: "err", text: String(e) }); } finally { setBusy(null); }
  };

  const sideName = side === "draw" ? "Draw" : names[side];
  const minBar = quote ? Math.ceil(quote.minBarrierBps / 100) : 5;
  // keep the slider from ever sitting below the gated minimum once we know the current probability
  useEffect(() => {
    if (quote && barrier < minBar) setBarrier(minBar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minBar]);

  return (
    <section className="panel bet">
      <div className="bet-head">
        <h2>Predict a touch <span className="devnet">devnet · mock USDC</span></h2>
        <div className="wallet-line">
          {bal === null ? <span className="mono dim">—</span> : <span className="mono bal">{bal.toFixed(2)} <span className="tick">tUSDC</span></span>}
          <button className="btn2" onClick={faucet} disabled={busy === "faucet"}>{busy === "faucet" ? "…" : "＋ Faucet 100"}</button>
        </div>
      </div>

      {/* one surface: pick a side, drag the barrier, place the prediction — no market to open */}
      <div className="picker">
        <div className="seg" role="group" aria-label="team">
          {(["part1", "draw", "part2"] as Side[]).map((k) => (
            <button key={k} className={side === k ? "on" : ""} onClick={() => setSide(k)}>
              {k === "draw" ? "🤝 Draw" : `${flag(names[k])} ${names[k]}`}
            </button>
          ))}
        </div>
        <div className="barrierbox">
          <span className="mono blabel">touches</span>
          <input type="range" min={minBar} max={95} step={1} value={Math.max(barrier, minBar)}
            onChange={(e) => setBarrier(Number(e.target.value))} aria-label="barrier" />
          <span className="bval mono">{barrier}%</span>
        </div>
      </div>

      <div className="quote-card">
        <div className="q-line">
          <span className="q-label">{side === "draw" ? "🤝" : flag(sideName)} <b>{sideName}</b> touches <b>{barrier}%</b>?</span>
          {quote && !quote.valid && <span className="gate">pick ≥ {minBar}% (now {(quote.pBps / 100).toFixed(0)}%)</span>}
        </div>
        {quote?.valid && (
          <div className="q-body">
            <div className="q-price"><span className="big mono">{pctBps(quote.priceBps)}</span><span className="q-sub">house price</span></div>
            <div className="q-arrow">→</div>
            <div className="q-payout"><span className="big mono">{quote.payoutMult.toFixed(2)}×</span><span className="q-sub">payout if it touches</span></div>
            <div className="q-decomp mono">
              p/B {pctBps(quote.pBps)}/{barrier} = {pctBps(quote.boundBps)} × {quote.discount.toFixed(2)}
              <a className="q-paper" href="#/paper"> · how?</a>
            </div>
          </div>
        )}
        <div className="bet-actions">
          {[2, 5, 10].map((v) => (
            <button key={v} className="stakebtn" disabled={!quote?.valid || busy === "bet" || (bal ?? 0) < v} onClick={() => placeBet(v)}>
              {busy === "bet" ? "…" : `Bet $${v}`}
            </button>
          ))}
          {lastBet.current && <button className="btn2 settle" onClick={settle} disabled={busy === "settle"}>{busy === "settle" ? "Settling…" : "Settle & claim →"}</button>}
        </div>
        {quote?.valid && (bal ?? 0) < 2 && busy !== "faucet" && (
          <div className="bet-hint">Balance too low to bet — hit <b>＋ Faucet 100</b> above to grab devnet tUSDC.</div>
        )}
        {msg && <div className={`bet-msg ${msg.kind}`}>{msg.text}</div>}
      </div>

      {treasury && treasury.bets > 0 && (
        <div className="hedgebook">
          <div className="hb-head">
            <span className="act-head" style={{ margin: 0 }}>House hedge book</span>
            <span className="devnet">net-zero replication</span>
          </div>
          <p className="hb-note">
            Every ticket the house writes is offset live: it buys <b>{treasury.shares.toFixed(1)} win-shares</b> at{" "}
            {(treasury.venueP * 100).toFixed(0)}¢ on {treasury.venue.replace("txline-winprob", "the TxLINE win price")}{" "}
            (cost {usd(treasury.hedgeCostUsdc)}), collapsing the payout risk into a small residual either way.
          </p>
          <div className="hb-grid">
            <div className="hb-cell">
              <span className="hb-k">Premiums in</span>
              <span className="hb-v mono">{usd(treasury.premiumsUsdc)}</span>
              <span className="hb-sub">{treasury.bets} ticket{treasury.bets === 1 ? "" : "s"}</span>
            </div>
            <div className="hb-cell">
              <span className="hb-k">Payout if it touches</span>
              <span className="hb-v mono">{usd(treasury.liabilityUsdc)}</span>
              <span className="hb-sub">hedge returns ≈ {usd(treasury.hedgeValueIfTouched)}</span>
            </div>
            <div className="hb-cell">
              <span className="hb-k">Hedge cost</span>
              <span className="hb-v mono">{usd(treasury.hedgeCostUsdc)}</span>
              <span className="hb-sub">{treasury.shares.toFixed(1)} shares @ {(treasury.venueP * 100).toFixed(0)}¢</span>
            </div>
          </div>
          {!treasury.realized ? (
            <div className="hb-scenarios">
              <div className="hb-row"><span className="hb-tag risk">unhedged, a touch</span>
                <span className="mono">would cost the house <b>{usd(treasury.unhedgedNetIfYes)}</b></span></div>
              <div className="hb-row"><span className="hb-tag yes">touches {pctBps(treasury.barrierBps)}</span>
                <span className="mono">hedged net <b>{treasury.hedgedNetIfYes >= 0 ? "+" : ""}{usd(treasury.hedgedNetIfYes)}</b> <span className="hb-sub">+ any jump overshoot</span></span></div>
              <div className="hb-row"><span className="hb-tag no">never touches</span>
                <span className="mono">hedged net <b>{treasury.hedgedNetIfNo >= 0 ? "+" : ""}{usd(treasury.hedgedNetIfNo)}</b></span></div>
            </div>
          ) : (
            <div className={`hb-settled ${treasury.realized.net >= -0.01 ? "flat" : ""}`}>
              Settled {treasury.realized.outcome.toUpperCase()} — unhedged this would have been{" "}
              <b>{usd(treasury.realized.unhedgedNet)}</b>; hedged, the book landed at{" "}
              <b>{treasury.realized.net >= 0 ? "+" : ""}{usd(treasury.realized.net)}</b>{" "}
              <span className="hb-sub">(premiums {usd(treasury.realized.premiums)} − hedge {usd(treasury.realized.hedgeCost)} + liquidation {usd(treasury.realized.hedgeValue)} − payout {usd(treasury.realized.paid)})</span>
            </div>
          )}
        </div>
      )}

      <div className="activity">
        <div className="act-head">Live market activity</div>
        {activity.length === 0 && <div className="dim">No bets yet — place one, or wait for the bots.</div>}
        <div className="act-list">
          {activity.slice(0, 8).map((b) => (
            <div className={`act-row${b.bot ? " bot" : " you"}`} key={b.sig}>
              <span className="act-who">{b.bot ? "🤖" : "🫵"} {b.label}</span>
              <span className="act-what mono">${b.amountUsdc} · touches {pctBps(b.barrierBps)}</span>
              <span className="act-odds mono">@ {pctBps(b.priceBps)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
