import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Calibration, type Fixture, type Market, type PathResponse, type Quote, type Side } from "./api.js";
import { flag } from "./flags.js";
import { PathChart } from "./PathChart.js";
import { buildScale } from "./timeline.js";

const fmtDay = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
  " · " + new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;

export function App() {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [filter, setFilter] = useState("");
  const [sel, setSel] = useState<Fixture | null>(null);
  const [pathRes, setPathRes] = useState<PathResponse | null>(null);
  const [side, setSide] = useState<Side>("part1");
  const [barrier, setBarrier] = useState(60);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [cursor, setCursor] = useState(1e9);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    api.fixtures().then((fx) => {
      const sorted = [...fx].sort((a, b) => b.startTime - a.startTime);
      setFixtures(sorted);
      const semi = sorted.find((f) => f.fixtureId === 18241006) ?? sorted.find((f) => f.isFinal) ?? sorted[0] ?? null;
      if (semi) select(semi);
    }).catch((e) => setErr(String(e)));
    api.calibration().then(setCal).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = useCallback((f: Fixture) => {
    setSel(f);
    setPathRes(null);
    setMarkets([]);
    setPlaying(false);
    setCursor(1e9);
    api.path(f.fixtureId).then(setPathRes).catch((e) => setErr(String(e)));
    api.markets(f.fixtureId).then(setMarkets).catch(() => {});
  }, []);

  // quote refresh
  useEffect(() => {
    if (!sel) return;
    let dead = false;
    api.quote(sel.fixtureId, side, barrier).then((q) => !dead && setQuote(q)).catch(() => setQuote(null));
    return () => { dead = true; };
  }, [sel, side, barrier]);

  // replay animation
  useEffect(() => {
    if (!playing || !pathRes) return;
    const total = pathRes.path.length;
    const startIdx = cursor >= total ? 0 : cursor;
    let i = startIdx;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      i += (dt / 1000) * (total / 25); // full match replays in ~25s
      if (i >= total) { setCursor(1e9); setPlaying(false); return; }
      setCursor(Math.floor(i));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, pathRes]);

  const names = useMemo(
    () => sel ? { part1: sel.participant1, draw: "Draw", part2: sel.participant2 } : { part1: "", draw: "Draw", part2: "" },
    [sel],
  );

  const clockLabel = useMemo(() => {
    if (!pathRes) return null;
    const lastTs = pathRes.path[pathRes.path.length - 1]?.ts ?? 0;
    const scale = buildScale(pathRes.timeline, 0, 1, lastTs);
    return scale ? scale.labelOf : null;
  }, [pathRes]);

  const openMarket = async () => {
    if (!sel) return;
    setBusy("create"); setErr(null);
    try {
      await api.createMarket(sel.fixtureId, side, barrier);
      setMarkets(await api.markets(sel.fixtureId));
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };

  const doStake = async (m: Market, s: "yes" | "no") => {
    setBusy(m.id); setErr(null);
    try {
      await api.stake(m.id, s, 25);
      setMarkets(await api.markets(m.fixtureId));
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };

  const doResolve = async (m: Market) => {
    setBusy(m.id); setErr(null);
    try {
      await api.resolve(m.id);
      setMarkets(await api.markets(m.fixtureId));
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };

  const shown = fixtures.filter((f) =>
    `${f.participant1} ${f.participant2}`.toLowerCase().includes(filter.toLowerCase()),
  );

  const visibleCursor = pathRes ? Math.min(cursor, pathRes.path.length) : 0;

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <h1>TOUCH<span className="tick">LINE</span></h1>
          <div className="tag">options on the probability path</div>
          <div className="stats mono">{fixtures.length} fixtures · 5.5M anchored ticks</div>
        </div>
        <div className="search">
          <input placeholder="Search teams…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="search fixtures" />
        </div>
        <div className="fixtures">
          {shown.map((f) => (
            <button key={f.fixtureId} className={`fx${sel?.fixtureId === f.fixtureId ? " sel" : ""}`} onClick={() => select(f)}>
              <span className="teams">{flag(f.participant1)} {f.participant1} — {f.participant2} {flag(f.participant2)}</span>
              <span className="score">{f.isFinal ? `${f.finalP1 ?? "–"}–${f.finalP2 ?? "–"}` : ""}</span>
              <span className="meta">{fmtDay(f.startTime)} · {f.oddsTickCount.toLocaleString()} ticks</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        {!sel ? (
          <div className="empty">Pick a match.</div>
        ) : (
          <>
            <div className="matchhead">
              <span className="vs display">
                {flag(sel.participant1)} {sel.participant1} {sel.isFinal ? `${sel.finalP1}–${sel.finalP2}` : "vs"} {sel.participant2} {flag(sel.participant2)}
              </span>
              <span className={`badge${sel.isFinal ? " ft" : ""}`}>{sel.isFinal ? "Full time" : "Scheduled"}</span>
              <span className="when">{fmtDay(sel.startTime)} · {sel.competition}</span>
            </div>

            <section className="panel">
              <h2>Probability path — 1X2, de-margined</h2>
              {pathRes ? (
                <div className="chartwrap">
                  <PathChart
                    path={pathRes.path}
                    startTime={sel.startTime}
                    timeline={pathRes.timeline}
                    names={names}
                    side={side}
                    barrier={barrier}
                    cursor={visibleCursor}
                  />
                  <div className="replaybar">
                    <button className="playbtn" aria-label={playing ? "pause replay" : "replay match"}
                      onClick={() => {
                        if (!playing && visibleCursor >= pathRes.path.length) setCursor(0);
                        setPlaying(!playing);
                      }}>
                      {playing ? "❚❚" : "▶"}
                    </button>
                    <input type="range" min={2} max={pathRes.path.length} value={visibleCursor}
                      onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
                      aria-label="scrub replay" />
                    <span className="clock mono">
                      {(() => {
                        const p = pathRes.path[Math.max(0, visibleCursor - 1)];
                        if (!p) return "";
                        return clockLabel
                          ? clockLabel(p.ts)
                          : `+${Math.max(0, Math.round((p.ts - sel.startTime) / 60000))}m wall`;
                      })()} · {pathRes.tickCount.toLocaleString()} ticks
                    </span>
                  </div>
                </div>
              ) : (
                <div className="empty">Loading path…</div>
              )}
            </section>

            <section className="panel">
              <h2>Open a one-touch market</h2>
              <div className="builder">
                <div className="seg" role="group" aria-label="side">
                  {(["part1", "draw", "part2"] as Side[]).map((k) => (
                    <button key={k} className={side === k ? "on" : ""} onClick={() => setSide(k)}>
                      {k === "draw" ? "🤝 Draw" : `${flag(names[k])} ${names[k]}`}
                    </button>
                  ))}
                </div>
                <div className="barrierbox">
                  <span className="mono" style={{ fontSize: ".75rem", color: "var(--ink-3)" }}>touches</span>
                  <input type="range" min={5} max={95} step={1} value={barrier}
                    onChange={(e) => setBarrier(Number(e.target.value))} aria-label="barrier" />
                  <span className="bval mono">{barrier}%</span>
                </div>
                <div className="quotecard">
                  {quote ? (
                    <>
                      <div className="fair">{pct(quote.fair)}</div>
                      <div className="decomp mono">
                        bound p/B = {quote.p0.toFixed(1)}/{quote.barrier} = {pct(quote.bound)} × {quote.discount.toFixed(2)} measured
                      </div>
                      <button className="cta" onClick={openMarket} disabled={busy === "create"}>
                        {busy === "create" ? "Opening…" : "Open market"}
                      </button>
                    </>
                  ) : (
                    <div className="decomp">no quote</div>
                  )}
                </div>
              </div>
              <div className="theorem">
                <b>Why p/B?</b> A de-margined probability is a martingale ending in {"{0,1}"}. Stopping at the
                first touch of <i>B</i>: <i>p = B·P(touch) + 0·P(never)</i>, and a path that never touches
                <i> B</i> cannot reach 1 — so <i>P(touch) = p/B</i>. Goals jump, so p/B is an upper bound;
                the ×{cal ? (quote?.discount ?? 0.87).toFixed(2) : "…"} is the discount measured across{" "}
                {cal?.fixtures ?? "…"} real matches.
              </div>
            </section>

            <section className="panel">
              <h2>Markets on this match</h2>
              {markets.length === 0 && <div className="empty">None yet — open one above.</div>}
              {markets.map((m) => {
                const total = m.pools.yes + m.pools.no;
                const rec = m.resolution?.receipt;
                const v = rec?.verification ?? null;
                return (
                  <div className="mkt" key={m.id}>
                    <div className="row1">
                      <span className="q">
                        {m.side === "draw" ? "Draw" : names[m.side]} touches {m.barrierPct}%?
                      </span>
                      <span className={`chip ${m.status === "open" ? "open" : m.status === "resolved_yes" ? "yes" : "no"}`}>
                        {m.status === "open" ? "Open" : m.status === "resolved_yes" ? "YES · touched" : "NO · never touched"}
                      </span>
                      <span className="mono" style={{ marginLeft: "auto", fontSize: ".78rem", color: "var(--ink-2)" }}>
                        opened at fair {pct(m.quoteAtCreate.fair)}
                      </span>
                    </div>
                    <div className="poolbar" aria-hidden="true">
                      <div className="y" style={{ width: `${(m.pools.yes / Math.max(1, total)) * 100}%` }} />
                      <div className="n" style={{ flex: 1 }} />
                    </div>
                    <div className="nums mono">
                      <span>YES pool {m.pools.yes}</span>
                      <span>NO pool {m.pools.no}</span>
                      <span>pool-implied {pct(m.poolImpliedYes)}</span>
                      {m.resolution && <span>payout ×{m.resolution.payoutPerUnit.toFixed(2)} per unit</span>}
                      {m.resolution?.evidence && (
                        <span>evidence: {m.resolution.evidence.pct.toFixed(2)}% @ tick {m.resolution.evidence.messageId.slice(0, 18)}…</span>
                      )}
                    </div>
                    {m.status === "open" && (
                      <div className="actions">
                        <button className="btn2" onClick={() => doStake(m, "yes")} disabled={busy === m.id}>+25 YES</button>
                        <button className="btn2" onClick={() => doStake(m, "no")} disabled={busy === m.id}>+25 NO</button>
                        <button className="btn2 primary" onClick={() => doResolve(m)} disabled={busy === m.id}>
                          {busy === m.id ? "Verifying proof…" : "Resolve from anchored path"}
                        </button>
                      </div>
                    )}
                    {rec && (
                      <div className={`receipt${rec.verified ? "" : " bad"}`}>
                        <div className="rhead">
                          {rec.verified ? "✓ PROOF VERIFIED AGAINST SOLANA" : "✗ PROOF NOT VERIFIED"}
                        </div>
                        <div className="rbody">
                          {v ? (
                            <>
                              <div className="rstep"><span className={v.subTreeVerified ? "ok" : "fail"}>{v.subTreeVerified ? "✓" : "✗"}</span><span>odds tick leaf → odds sub-tree root (Merkle walk)</span></div>
                              <div className="rstep"><span className={v.mainTreeVerified ? "ok" : "fail"}>{v.mainTreeVerified ? "✓" : "✗"}</span>
                                <span>summary leaf → 5-min slot root · computed <code>{v.computedRootHex.slice(0, 18)}…</code> = on-chain <code>{(v.onChainRootHex ?? "").slice(0, 18)}…</code></span></div>
                              <div className="rstep"><span className={v.pdaEpochDayMatches ? "ok" : "fail"}>{v.pdaEpochDayMatches ? "✓" : "✗"}</span>
                                <span>anchored in <code>daily_batch_roots</code> PDA <code>{v.pda}</code> (epochDay {v.epochDay}, slot {v.fiveMinSlot})</span></div>
                              <div className="rfoot">
                                program <code>{v.programId.slice(0, 10)}…</code> · fixture {v.namespacedFixtureId} ·{" "}
                                <a href={`https://solscan.io/account/${v.pda}`} target="_blank" rel="noreferrer">view the anchor account ↗</a>
                              </div>
                            </>
                          ) : (
                            <div>{rec.error ?? "no verification detail"}</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {err && <div className="err mono">{err}</div>}
            </section>

            <section className="panel">
              <h2>Calibration — the corpus vs the theorem</h2>
              {cal ? (
                <>
                  <div className="calhead">
                    Across <b>{cal.fixtures}</b> finished matches ({cal.samples.length} outcome paths), real touches run at{" "}
                    <b>~87%</b> of the martingale bound — the measured price of goal-jumps.
                  </div>
                  <div className="calgrid">
                    <div className="calrow" style={{ color: "var(--ink-3)", fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".1em" }}>
                      <span>Barrier</span><span>observed rate (solid) vs p/B bound (ghost)</span><span style={{ textAlign: "right" }}>obs / bound / n</span>
                    </div>
                    {cal.buckets.filter((b) => b.n >= 30).map((b) => (
                      <div className="calrow" key={b.barrier}>
                        <span className="mono">{b.barrier}%</span>
                        <div className="calbars">
                          <div className="bound" style={{ width: `${b.meanBound * 100}%` }} />
                          <div className="obs" style={{ width: `${b.observedRate * 100}%` }} />
                        </div>
                        <span className="mono" style={{ textAlign: "right" }}>
                          {pct(b.observedRate, 0)} / {pct(b.meanBound, 0)} / {b.n}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty">Loading calibration…</div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
