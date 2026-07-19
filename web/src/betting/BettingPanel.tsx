import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ActivityBet, type BetKind, type ChainState, type DealerQuote, type Fixture, type PathPoint, type ResolveResult, type Side, type Treasury } from "../api.js";
import { flag } from "../flags.js";
import { sessionId } from "../session.js";
import { addLeg } from "./ticket.js";
import "./betting.css";

const usd = (n: number) => (n < 0 ? `−$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`);
const pctBps = (b: number) => `${(b / 100).toFixed(1)}%`;

const KIND_META: Record<BetKind, { icon: string; label: string; blurb: (name: string, U: number, L: number) => string }> = {
  up: { icon: "↗", label: "Touch up", blurb: (n, U) => `${n} touches ${U}%?` },
  down: { icon: "↘", label: "Touch down", blurb: (n, U) => `${n} drops to ${U}%?` },
  band: { icon: "⇅", label: "Race", blurb: (n, U, L) => `${n} hits ${U}% before ${L}%?` },
  heartbreak: { icon: "💔", label: "Heartbreak", blurb: (n, U) => `${n} touches ${U}%, and still loses?` },
  comeback: { icon: "🔄", label: "Comeback", blurb: (n, U) => `${n} drops to ${U}%, and still wins?` },
};

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const explorerAddr = (a: string, devnet = true) => `https://explorer.solana.com/address/${a}${devnet ? "?cluster=devnet" : ""}`;

export interface BettingPanelProps {
  fixture: Fixture;
  side: Side; setSide: (s: Side) => void;
  kind: BetKind; setKind: (k: BetKind) => void;
  barrier: number; setBarrier: (b: number) => void;
  barrier2: number; setBarrier2: (b: number) => void;
  names: { part1: string; draw: string; part2: string };
  /** revealed path + edge for the auto-settlement watcher (sim/live) */
  path?: PathPoint[];
  revealTs?: number | null;
  simActive?: boolean;
  /** the FULL match's last tick ts — the sim path is asOf-truncated, so heartbreak/comeback
   *  must compare the reveal edge against this, not the truncated path's end */
  fullEndTs?: number | null;
  /** notify the parlay ticket that a leg was added */
  onTicket?: () => void;
  /** probability line the market is built on (0 = 1X2) */
  line?: number;
}

export function BettingPanel({ fixture, side, setSide, kind, setKind, barrier, setBarrier, barrier2, setBarrier2, names, path, revealTs, simActive, fullEndTs, onTicket, line = 0 }: BettingPanelProps) {
  const sid = sessionId();
  const [chain, setChain] = useState<ChainState | null>(null);
  const [bal, setBal] = useState<number | null>(null);
  const [quote, setQuote] = useState<DealerQuote | null>(null);
  const [activity, setActivity] = useState<ActivityBet[]>([]);
  const [stake, setStake] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [settled, setSettled] = useState<(ResolveResult & { betSig?: string }) | null>(null);
  const lastBet = useRef<{ sig: string; marketKey: string; kind: BetKind; side: Side; barrier: number; barrier2: number } | null>(null);
  const settling = useRef(false);

  const cap = chain?.betCapUsdc ?? 10;

  useEffect(() => { api.chainState().then(setChain).catch(() => {}); }, []);
  const refreshBal = useCallback(() => api.balance(sid).then((b) => setBal(b.balanceUsdc)).catch(() => {}), [sid]);
  useEffect(() => { refreshBal(); const id = setInterval(refreshBal, 30_000); return () => clearInterval(id); }, [refreshBal]);

  // quote follows kind/side/barriers (gated on the server); re-polls so a transient API
  // hiccup can't leave the panel stuck quoteless with a dead button
  // during sim/live the quote re-prices off the CURRENT probability (the reveal edge), bucketed
  // to ~4s so the tween doesn't spam the API; browsing without a sim prices the pre-match book
  const asOfBucket = simActive && revealTs != null ? Math.floor(revealTs / 4000) * 4000 : undefined;
  useEffect(() => {
    let dead = false;
    const fetchQuote = () =>
      api.dealerQuote(fixture.fixtureId, side, barrier, kind, kind === "band" ? barrier2 : undefined, line, asOfBucket)
        .then((q) => !dead && setQuote(q)).catch(() => {});
    void fetchQuote();
    const id = setInterval(fetchQuote, 15_000);
    return () => { dead = true; clearInterval(id); };
  }, [fixture.fixtureId, side, barrier, barrier2, kind, line, asOfBucket]);

  // activity feed polls — scoped to the selected kind
  useEffect(() => {
    const tick = () => api.activity().then(setActivity).catch(() => {});
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, []);
  const scoped = useMemo(() => activity.filter((b) => (b.kind ?? "up") === kind), [activity, kind]);

  const refreshTreasury = useCallback(() => {
    const key = lastBet.current?.marketKey;
    if (!key) return;
    api.treasury(key).then(setTreasury).catch(() => {});
  }, []);
  useEffect(() => {
    if (!lastBet.current) return;
    const id = setInterval(refreshTreasury, 4000);
    return () => clearInterval(id);
  }, [refreshTreasury, treasury?.marketKey]);

  // slider ranges per kind
  const minBar = quote ? Math.ceil(quote.minBarrierBps / 100) : 5;
  const maxDown = quote?.maxDownBps !== undefined ? Math.floor(quote.maxDownBps / 100) : 95;
  const upKind = kind === "up" || kind === "heartbreak" || kind === "band";
  useEffect(() => {
    if (!quote) return;
    if (upKind && barrier < minBar) setBarrier(minBar);
    if ((kind === "down" || kind === "comeback") && barrier > maxDown) setBarrier(Math.max(1, maxDown));
    if (kind === "band" && barrier2 > maxDown) setBarrier2(Math.max(1, maxDown));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minBar, maxDown, kind]);

  const placeBet = async () => {
    if (!quote?.valid) { setMsg({ kind: "err", text: quote?.reason ?? "invalid barrier" }); return; }
    const usdcAmt = Math.max(1, Math.min(cap, stake));
    setBusy("bet"); setSettled(null);
    setMsg({ kind: "ok", text: "Confirming on devnet: co-signing + escrowing the payout…" });
    try {
      const r = await api.bet({ sessionId: sid, label: "you", fixtureId: fixture.fixtureId, side, barrier, barrier2: kind === "band" ? barrier2 : undefined, kind, usdc: usdcAmt, line, asOf: asOfBucket });
      lastBet.current = { sig: r.sig, marketKey: r.marketKey, kind, side, barrier, barrier2 };
      setMsg({ kind: "ok", text: `Position live on-chain: ${usd(r.amountUsdc)} → ${usd(r.payoutUsdc)} if it hits.` });
      refreshBal(); refreshTreasury(); api.activity().then(setActivity).catch(() => {});
    } catch (e) { setMsg({ kind: "err", text: String(e) }); } finally { setBusy(null); }
  };

  const settle = useCallback(async (auto = false) => {
    const lb = lastBet.current;
    if (!lb || settling.current) return;
    settling.current = true;
    setBusy("settle");
    if (auto) setMsg({ kind: "ok", text: "Trigger hit. Resolving on-chain with the Merkle proof…" });
    try {
      const res = await api.resolveOnchain(lb.marketKey);
      if (res.outcome === "yes") {
        await api.claim(lb.sig).catch(() => {});
      }
      setSettled({ ...res, betSig: lb.sig });
      setMsg(null);
      refreshBal(); refreshTreasury(); api.activity().then(setActivity).catch(() => {});
    } catch (e) {
      const s = String(e);
      // pending (409) is expected mid-match for heartbreak/comeback — retry later, not an error
      if (!s.includes("409")) setMsg({ kind: "err", text: s });
    } finally { settling.current = false; setBusy(null); }
  }, [refreshBal, refreshTreasury]);

  // ── auto-settlement watcher: the demo moment ─────────────────────────────────
  // during sim/live, when the revealed path trips the open bet's trigger, resolve on-chain
  // automatically. up/down/band fire at the trip; heartbreak/comeback wait for full time (the
  // result is part of the claim).
  useEffect(() => {
    const lb = lastBet.current;
    if (!lb || settled || settling.current || !path?.length || revealTs == null) return;
    const revealed = path.filter((t) => t.ts >= fixture.startTime && t.ts <= revealTs);
    if (!revealed.length) return;
    const B = lb.barrier, L = lb.barrier2;
    const tripped =
      lb.kind === "up" || lb.kind === "heartbreak" ? revealed.some((t) => t[lb.side] >= B)
      : lb.kind === "down" || lb.kind === "comeback" ? revealed.some((t) => t[lb.side] <= B)
      : revealed.some((t) => t[lb.side] >= B || t[lb.side] <= L);
    if (!tripped) return;
    const needsFinal = lb.kind === "heartbreak" || lb.kind === "comeback";
    const matchEnd = fullEndTs ?? path[path.length - 1]!.ts;
    if (needsFinal && revealTs < matchEnd) return; // let the story play out to the whistle
    void settle(true);
  }, [revealTs, path, fixture.startTime, settled, settle, fullEndTs]);

  // end-of-sim catch: the sim clears revealTs when it completes, so a bet whose story needed the
  // final whistle (heartbreak/comeback) settles here, off the full path.
  const wasSim = useRef(false);
  useEffect(() => {
    if (simActive) { wasSim.current = true; return; }
    if (!wasSim.current) return;
    wasSim.current = false;
    const lb = lastBet.current;
    if (!lb || settled || settling.current || !path?.length) return;
    const inPlay = path.filter((t) => t.ts >= fixture.startTime);
    const tripped =
      lb.kind === "up" || lb.kind === "heartbreak" ? inPlay.some((t) => t[lb.side] >= lb.barrier)
      : lb.kind === "down" || lb.kind === "comeback" ? inPlay.some((t) => t[lb.side] <= lb.barrier)
      : inPlay.some((t) => t[lb.side] >= lb.barrier || t[lb.side] <= lb.barrier2);
    if (tripped) void settle(true);
  }, [simActive, path, fixture.startTime, settled, settle]);

  const sideName = side === "draw" ? "Draw" : names[side];
  const meta = KIND_META[kind];

  const decomp = () => {
    if (!quote?.valid) return null;
    if (kind === "band") return `(p−L)/(U−L) = (${pctBps(quote.pBps)}−${barrier2})/(${barrier}−${barrier2}) · exact`;
    if (kind === "down" || kind === "comeback") return `(1−p)/(1−B) ${kind === "comeback" ? "× A " : ""}× ${quote.discount.toFixed(2)}`;
    if (kind === "heartbreak") return `p/B × (1−B) = ${pctBps(quote.boundBps)} × ${(1 - barrier / 100).toFixed(2)} × ${quote.discount.toFixed(2)}`;
    return `p/B ${pctBps(quote.pBps)}/${barrier} = ${pctBps(quote.boundBps)} × ${quote.discount.toFixed(2)}`;
  };

  return (
    <section className="panel bet trading-ticket">
      <div className="bet-head">
        <h2>Predict the path <span className="devnet">devnet</span></h2>
        {bal !== null && <span className="mono balmini" title="session balance">{bal.toFixed(2)} <span className="tick">USDC</span></span>}
      </div>

      <div className="market-question">
        <span className="ticket-label">Market question</span>
        <div className="q-line">
          <span className="q-label">{side === "draw" ? "🤝" : flag(sideName)} <b>{meta.blurb(sideName, barrier, barrier2)}</b></span>
          {quote && !quote.valid && <span className="gate">{quote.reason}</span>}
        </div>
      </div>

      {/* the five instruments */}
      <div className="instrument-picker">
        <span className="ticket-label">Contract type</span>
        <select className="kindsel mono" aria-label="market type" value={kind}
          onChange={(e) => { setKind(e.target.value as BetKind); setSettled(null); }}>
          {(Object.keys(KIND_META) as BetKind[]).map((k) => (
            <option key={k} value={k}>{KIND_META[k].icon}  {KIND_META[k].label}</option>
          ))}
        </select>
      </div>

      {/* side + barrier(s) */}
      <div className="picker">
        <span className="ticket-label">Outcome and barrier</span>
        <div className="seg" role="group" aria-label="side">
          {(["part1", "draw", "part2"] as Side[]).filter((k) => names[k] !== "").map((k) => (
            <button key={k} className={side === k ? "on" : ""} onClick={() => setSide(k)}>
              {k === "draw" ? "🤝 Draw" : line > 0 ? names[k] : `${flag(names[k])} ${names[k]}`}
            </button>
          ))}
        </div>
        <div className="barrierbox">
          <span className="mono blabel">{kind === "band" ? "upper" : kind === "down" || kind === "comeback" ? "drops to" : "touches"}</span>
          {upKind ? (
            <input type="range" min={minBar} max={95} step={1} value={Math.max(barrier, minBar)}
              onChange={(e) => setBarrier(Number(e.target.value))} aria-label="barrier" />
          ) : (
            <input type="range" min={1} max={Math.max(1, maxDown)} step={1} value={Math.min(barrier, Math.max(1, maxDown))}
              onChange={(e) => setBarrier(Number(e.target.value))} aria-label="barrier" />
          )}
          <span className="bval mono">{barrier}%</span>
        </div>
        {kind === "band" && (
          <div className="barrierbox">
            <span className="mono blabel">lower</span>
            <input type="range" min={1} max={Math.max(1, maxDown)} step={1} value={Math.min(barrier2, Math.max(1, maxDown))}
              onChange={(e) => setBarrier2(Number(e.target.value))} aria-label="lower barrier" />
            <span className="bval mono">{barrier2}%</span>
          </div>
        )}
      </div>

      <div className="quote-card">
        {quote?.valid && (
          <>
            <div className="q-row">
              <div className="q-price"><span className="big mono">{pctBps(quote.priceBps)}</span><span className="q-sub">house price</span></div>
              <div className="q-payout right"><span className="big mono">{quote.payoutMult.toFixed(2)}×</span><span className="q-sub">payout if it hits</span></div>
            </div>
            <div className="q-decomp mono">
              {decomp()}
              <a className="q-paper" href="#/paper"> · how?</a>
            </div>
          </>
        )}
        <div className="stake-row">
          <span className="ticket-label">Stake</span>
          <div className="stake-controls">
            <input className="stakein mono" type="number" min={1} max={cap} step={1} value={stake}
              onChange={(e) => setStake(Math.max(1, Math.min(cap, Number(e.target.value) || 1)))} aria-label="stake in USDC" />
            <div className="stake-seg" role="group" aria-label="quick stake">
              {[2, 5, 10].map((v) => (
                <button key={v} className={stake === v ? "on" : ""} onClick={() => setStake(v)}>{v}</button>
              ))}
              <button className={stake === cap ? "on" : ""} onClick={() => setStake(cap)}>Max</button>
            </div>
            {quote?.valid && <span className="towin mono">to win {usd(stake * quote.payoutMult)}</span>}
          </div>
        </div>
        <button className="stakebtn place cta" disabled={!quote?.valid || busy === "bet" || (bal ?? 0) < stake} onClick={placeBet}>
          {busy === "bet" ? "Confirming…" : `Place $${stake} prediction`}
        </button>
        <div className="secondary-actions">
          <button className="btn2 wide" disabled={!quote?.valid} title="add this selection to the parlay ticket"
            onClick={() => {
              addLeg({
                fixtureId: fixture.fixtureId, fixtureName: `${names.part1} v ${names.part2}`,
                side, sideName, kind, barrier, barrier2: kind === "band" ? barrier2 : undefined,
              });
              onTicket?.();
            }}>
            ＋ Add to parlay
          </button>
          {lastBet.current && !settled && !simActive && (
            <button className="btn2 settle wide" onClick={() => settle(false)} disabled={busy === "settle"}>{busy === "settle" ? "Settling…" : "Settle & claim →"}</button>
          )}
        </div>
        {quote?.valid && (bal ?? 0) < stake && busy !== "bet" && (
          <div className="bet-hint">Balance too low. Grab devnet funds from the <b>wallet</b> in the top bar.</div>
        )}
        {msg && <div className={`bet-msg ${msg.kind}`}>{msg.text}</div>}
      </div>

      {/* settlement card — the on-chain verification moment */}
      {settled && (
        <div className={`settlement ${settled.outcome}`}>
          <div className="s-head">
            <span className="s-outcome">{settled.outcome === "yes" ? "✓ Resolved YES · payout claimed" : "Resolved NO"}</span>
            {settled.verified && <span className="s-verified">Merkle-verified against mainnet ✓</span>}
          </div>
          <div className="s-rows mono">
            <div className="s-row"><span>settlement tx</span>
              <a href={explorerTx(settled.sig)} target="_blank" rel="noreferrer">{settled.sig.slice(0, 8)}…{settled.sig.slice(-6)} ↗</a></div>
            {settled.betSig && <div className="s-row"><span>bet tx</span>
              <a href={explorerTx(settled.betSig)} target="_blank" rel="noreferrer">{settled.betSig.slice(0, 8)}…{settled.betSig.slice(-6)} ↗</a></div>}
            {settled.receipt?.verification && (
              <div className="s-row"><span>mainnet anchor PDA</span>
                <a href={explorerAddr(settled.receipt.verification.pda, false)} target="_blank" rel="noreferrer">{settled.receipt.verification.pda.slice(0, 8)}… ↗</a></div>
            )}
            {settled.receipt && <div className="s-row"><span>deciding tick</span><span>{settled.receipt.messageId.slice(0, 24)}…</span></div>}
            {settled.hedge && (
              <div className="s-row"><span>house hedge net</span>
                <span>{settled.hedge.net >= 0 ? "+" : ""}{usd(settled.hedge.net)} (unhedged: {usd(settled.hedge.unhedgedNet)})</span></div>
            )}
          </div>
        </div>
      )}

      {treasury && treasury.bets > 0 && !settled && (
        <div className="hedgebook">
          <div className="hb-head">
            <span className="act-head" style={{ margin: 0 }}>House hedge book</span>
            <span className="devnet">net-zero replication</span>
          </div>
          <div className="hb-grid">
            <div className="hb-cell">
              <span className="hb-k">Premiums in</span>
              <span className="hb-v mono">{usd(treasury.premiumsUsdc)}</span>
              <span className="hb-sub">{treasury.bets} ticket{treasury.bets === 1 ? "" : "s"}</span>
            </div>
            <div className="hb-cell">
              <span className="hb-k">Payout if it hits</span>
              <span className="hb-v mono">{usd(treasury.liabilityUsdc)}</span>
              <span className="hb-sub">fully escrowed on-chain</span>
            </div>
            <div className="hb-cell">
              <span className="hb-k">Hedge position</span>
              <span className="hb-v mono">{usd(treasury.hedgeCostUsdc)}</span>
              <span className="hb-sub">{treasury.shares.toFixed(1)} shares @ {(treasury.venueP * 100).toFixed(0)}¢</span>
            </div>
          </div>
        </div>
      )}

      <div className="activity">
        <div className="act-head">{meta.icon} {meta.label} · live activity</div>
        {scoped.length === 0 && <div className="dim">No {meta.label.toLowerCase()} tickets yet. Yours can be the first.</div>}
        {scoped.length > 0 && (
          <div className="act-columns mono" aria-hidden="true">
            <span>Account</span><span>Contract</span><span>Price</span>
          </div>
        )}
        <div className="act-list">
          {scoped.slice(0, 8).map((b) => (
            <div className={`act-row${b.bot ? " bot" : " you"}`} key={b.sig}>
              <span className="act-who"><span className={`act-origin${b.bot ? " bot" : " you"}`}>{b.bot ? "BOT" : "YOU"}</span> {b.label}</span>
              <span className="act-what mono">${b.amountUsdc} · {KIND_META[b.kind ?? "up"].icon} {pctBps(b.barrierBps)}{b.barrier2Bps ? `↔${pctBps(b.barrier2Bps)}` : ""}</span>
              <span className="act-odds mono">@ {pctBps(b.priceBps)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
