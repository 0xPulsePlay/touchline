import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Calibration, type Fixture, type Market, type PathResponse, type Quote, type Side } from "./api.js";
import { flag } from "./flags.js";
import { PathChart } from "./PathChart.js";
import { buildScale } from "./timeline.js";
import { connectWallet, disconnectWallet, rememberedWallet, shortKey } from "./wallet.js";

const fmtDay = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
  " · " + new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;

type Group = "live" | "upcoming" | "finished";
function groupOf(f: Fixture, now: number): Group {
  if (f.startTime > now) return "upcoming";
  if (!f.isFinal && now - f.startTime < 5 * 3600_000) return "live";
  return "finished";
}

const GROUP_META: Record<Group, { label: string; live?: boolean }> = {
  live: { label: "Live now", live: true },
  upcoming: { label: "Upcoming" },
  finished: { label: "Finished" },
};

function FixtureRow({ f, sel, onPick, group }: { f: Fixture; sel: boolean; onPick: (f: Fixture) => void; group: Group }) {
  return (
    <button className={`fx${sel ? " sel" : ""}`} onClick={() => onPick(f)}>
      <span className="teams">{flag(f.participant1)} {f.participant1} — {f.participant2} {flag(f.participant2)}</span>
      <span className="score">{f.isFinal ? `${f.finalP1 ?? "–"}–${f.finalP2 ?? "–"}` : group === "live" ? "LIVE" : ""}</span>
      <span className="meta">{fmtDay(f.startTime)} · {f.oddsTickCount.toLocaleString()} ticks</span>
    </button>
  );
}

function GroupedList({ fixtures, sel, onPick, filter }: {
  fixtures: Fixture[]; sel: Fixture | null; onPick: (f: Fixture) => void; filter: string;
}) {
  const now = Date.now();
  const shown = fixtures.filter((f) =>
    `${f.participant1} ${f.participant2}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const groups: Group[] = ["live", "upcoming", "finished"];
  return (
    <>
      {groups.map((g) => {
        const list = shown
          .filter((f) => groupOf(f, now) === g)
          .sort((a, b) => (g === "finished" ? b.startTime - a.startTime : a.startTime - b.startTime));
        if (!list.length) return null;
        const meta = GROUP_META[g];
        return (
          <div key={g}>
            <div className={`grouphead${meta.live ? " live" : ""}`}>
              {meta.live && <span className="livedot" aria-hidden="true" />} {meta.label}
              <span style={{ fontWeight: 400 }}>· {list.length}</span>
            </div>
            {list.map((f) => (
              <FixtureRow key={f.fixtureId} f={f} sel={sel?.fixtureId === f.fixtureId} onPick={onPick} group={g} />
            ))}
          </div>
        );
      })}
    </>
  );
}

export function App() {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [filter, setFilter] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
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
  const [wallet, setWallet] = useState<string | null>(rememberedWallet());
  /** simulated-live driver: virtual clock advanced by the poll loop; null = not simulating */
  const simRef = useRef<{ now: number; speed: number; endTs: number } | null>(null);
  const [simUi, setSimUi] = useState<{ speed: number } | null>(null);
  /** last tick of the FULL (untruncated) path — sims always span the real match, never a truncated view */
  const fullEndRef = useRef<number | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    api.fixtures().then((fx) => {
      setFixtures(fx);
      const now = Date.now();
      const live = fx.filter((f) => groupOf(f, now) === "live").sort((a, b) => a.startTime - b.startTime)[0];
      const pick = live ?? fx.find((f) => f.fixtureId === 18241006) ?? fx.find((f) => f.isFinal) ?? fx[0] ?? null;
      if (pick) select(pick);
    }).catch((e) => setErr(String(e)));
    api.calibration().then(setCal).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = useCallback((f: Fixture) => {
    setSel(f);
    setSheetOpen(false);
    setPathRes(null);
    setMarkets([]);
    setPlaying(false);
    setCursor(1e9);
    simRef.current = null;
    setSimUi(null);
    fullEndRef.current = null;
    api.path(f.fixtureId).then((r) => {
      setPathRes(r);
      fullEndRef.current = r.path[r.path.length - 1]?.ts ?? f.startTime;
    }).catch((e) => setErr(String(e)));
    api.markets(f.fixtureId).then(setMarkets).catch(() => {});
  }, []);

  const isLive = sel ? groupOf(sel, Date.now()) === "live" : false;
  const simActive = !!simUi;

  /** live + simulated-live share one poll loop against the same asOf-truncating endpoint.
   *  Keyed on booleans (not the simUi object) so speed changes don't churn the interval. */
  useEffect(() => {
    if (!sel || (!isLive && !simActive)) return;
    const fid = sel.fixtureId;
    let dead = false;
    const tick = async () => {
      let asOf: number | undefined;
      const sim = simRef.current;
      if (sim) {
        sim.now = Math.min(sim.now + sim.speed * 2000, sim.endTs);
        asOf = sim.now;
      }
      try {
        const r = await api.path(fid, { asOf });
        if (dead) return;
        setPathRes(r);
        setCursor(1e9); // follow the leading edge
        if (sim && sim.now >= sim.endTs) {
          simRef.current = null;
          setSimUi(null);
          const full = await api.path(fid);
          if (!dead) {
            setPathRes(full);
            fullEndRef.current = full.path[full.path.length - 1]?.ts ?? null;
          }
        }
      } catch { /* transient poll failure — next tick retries */ }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => { dead = true; clearInterval(id); };
  }, [sel, isLive, simActive]);

  const startSim = () => {
    if (!sel || fullEndRef.current == null) return;
    simRef.current = { now: sel.startTime - 10 * 60_000, speed: 180, endTs: fullEndRef.current + 2 * 60_000 };
    setSimUi({ speed: 180 });
    setPlaying(false);
  };
  const exitSim = () => {
    simRef.current = null;
    setSimUi(null);
    if (sel) api.path(sel.fixtureId).then((r) => {
      setPathRes(r);
      fullEndRef.current = r.path[r.path.length - 1]?.ts ?? null;
    }).catch(() => {});
  };
  const setSimSpeed = (speed: number) => {
    if (simRef.current) simRef.current.speed = speed;
    setSimUi({ speed });
  };

  useEffect(() => {
    if (!sel) return;
    let dead = false;
    api.quote(sel.fixtureId, side, barrier).then((q) => !dead && setQuote(q)).catch(() => setQuote(null));
    return () => { dead = true; };
  }, [sel, side, barrier]);

  useEffect(() => {
    if (!playing || !pathRes) return;
    const total = pathRes.path.length;
    let i = cursor >= total ? 0 : cursor;
    let last = performance.now();
    const step = (now: number) => {
      i += ((now - last) / 1000) * (total / 25);
      last = now;
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

  const toggleWallet = async () => {
    if (wallet) { await disconnectWallet(); setWallet(null); return; }
    try { setWallet(await connectWallet()); } catch { /* user dismissed */ }
  };

  const visibleCursor = pathRes ? Math.min(cursor, pathRes.path.length) : 0;
  const now = Date.now();
  const selGroup = simUi ? "live" : sel ? groupOf(sel, now) : "finished";
  const liveEdgeLabel = (() => {
    const p = pathRes?.path[pathRes.path.length - 1];
    return p && clockLabel ? clockLabel(p.ts) : "";
  })();

  return (
    <>
      <header className="appbar">
        <h1 className="brand">TOUCH<span className="tick">LINE</span></h1>
        <div className="spacer" />
        <button className={`walletbtn${wallet ? " connected" : ""}`} onClick={toggleWallet}
          title={wallet ? "Disconnect" : "Connect Phantom"}>
          {wallet ? <><span className="wdot" aria-hidden="true" /> {shortKey(wallet)}</> : "Connect wallet"}
        </button>
      </header>

      <div className="shell">
        <aside className="rail">
          <div className="search">
            <input placeholder="Search teams…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="search fixtures" />
          </div>
          <div className="lists">
            <GroupedList fixtures={fixtures} sel={sel} onPick={select} filter={filter} />
          </div>
        </aside>

        <main className="main">
          <button className="switcher" onClick={() => setSheetOpen(true)} aria-label="change match">
            {sel ? (
              <>
                <span className="swteams">{flag(sel.participant1)} {sel.participant1} {sel.isFinal ? `${sel.finalP1}–${sel.finalP2}` : "vs"} {sel.participant2} {flag(sel.participant2)}</span>
                <span className="swmeta">{selGroup === "live" ? "LIVE" : fmtDay(sel.startTime)}</span>
              </>
            ) : (
              <span className="swteams">Pick a match…</span>
            )}
            <span className="caret" aria-hidden="true">▾</span>
          </button>

          {sel && (
            <>
              <div className="matchhead">
                <span className="vs display">
                  {flag(sel.participant1)} {sel.participant1} {sel.isFinal ? `${sel.finalP1}–${sel.finalP2}` : "vs"} {sel.participant2} {flag(sel.participant2)}
                </span>
                <span className={`badge${sel.isFinal ? " ft" : selGroup === "live" ? " live" : ""}`}>
                  {sel.isFinal ? "Full time" : selGroup === "live" ? "Live" : "Scheduled"}
                </span>
                <span className="when">{fmtDay(sel.startTime)} · {sel.competition}</span>
              </div>

              <section className="panel">
                <div className="panelhead">
                  <h2>Probability path</h2>
                  {sel.isFinal && !simUi && (
                    <button className="simbtn" onClick={startSim} title="replay this match through the live pipeline">
                      ⚡ Simulate live
                    </button>
                  )}
                </div>
                {pathRes ? (
                  <>
                    <PathChart
                      path={pathRes.path}
                      startTime={sel.startTime}
                      timeline={pathRes.timeline}
                      names={names}
                      side={side}
                      barrier={barrier}
                      cursor={simUi || isLive ? 1e9 : visibleCursor}
                    />
                    {simUi || isLive ? (
                      <div className="livebar">
                        <span className="livedot" aria-hidden="true" />
                        <span className="mono livelabel">{simUi ? "SIM · " : "LIVE · "}{liveEdgeLabel}</span>
                        {simUi && (
                          <>
                            <span className="speeds">
                              {[60, 180, 600].map((s) => (
                                <button key={s} className={`btn2${simUi.speed === s ? " on" : ""}`}
                                  onClick={() => setSimSpeed(s)}>{s}×</button>
                              ))}
                            </span>
                            <button className="btn2" onClick={exitSim}>Exit sim</button>
                          </>
                        )}
                      </div>
                    ) : (
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
                            return p && clockLabel ? clockLabel(p.ts) : "";
                          })()}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty">Loading path…</div>
                )}
              </section>

              <section className="panel">
                <h2>One-touch market</h2>
                <div className="builder">
                  <div className="seg" role="group" aria-label="side">
                    {(["part1", "draw", "part2"] as Side[]).map((k) => (
                      <button key={k} className={side === k ? "on" : ""} onClick={() => setSide(k)}>
                        {k === "draw" ? "🤝 Draw" : `${flag(names[k])} ${names[k]}`}
                      </button>
                    ))}
                  </div>
                  <div className="barrierbox">
                    <span className="mono" style={{ fontSize: ".72rem", color: "var(--ink-3)" }}>touches</span>
                    <input type="range" min={5} max={95} step={1} value={barrier}
                      onChange={(e) => setBarrier(Number(e.target.value))} aria-label="barrier" />
                    <span className="bval mono">{barrier}%</span>
                  </div>
                  {quote && (
                    <div className="quoteline">
                      <span className="fair">{pct(quote.fair)}</span>
                      <span className="decomp mono">
                        p/B = {quote.p0.toFixed(1)}/{quote.barrier} = {pct(quote.bound)} × {quote.discount.toFixed(2)}
                      </span>
                      <button className="cta" onClick={openMarket} disabled={busy === "create"}>
                        {busy === "create" ? "Opening…" : "Open market"}
                      </button>
                    </div>
                  )}
                  <details className="why">
                    <summary>Why p/B?</summary>
                    <div className="whybody">
                      A de-margined probability is a martingale ending in {"{0,1}"}. Stopping at the first
                      touch of <i>B</i>: <i>p = B·P(touch)</i>, and a path that never touches <i>B</i> can't
                      reach 1 — so <i>P(touch) = p/B</i>. Goals jump, so p/B is an upper bound; the
                      ×{(quote?.discount ?? 0.87).toFixed(2)} is measured across {cal?.fixtures ?? "—"} real matches.
                    </div>
                  </details>
                </div>
              </section>

              <section className="panel">
                <h2>Markets</h2>
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
                          {m.status === "open" ? "Open" : m.status === "resolved_yes" ? "YES · touched" : "NO"}
                        </span>
                      </div>
                      <div className="poolbar" aria-hidden="true">
                        <div className="y" style={{ width: `${(m.pools.yes / Math.max(1, total)) * 100}%` }} />
                        <div className="n" />
                      </div>
                      <div className="nums mono">
                        <span>YES {m.pools.yes}</span>
                        <span>NO {m.pools.no}</span>
                        <span>implied {pct(m.poolImpliedYes)}</span>
                        <span>opened {pct(m.quoteAtCreate.fair)}</span>
                        {m.resolution && <span>pays ×{m.resolution.payoutPerUnit.toFixed(2)}</span>}
                      </div>
                      {m.status === "open" && (
                        <div className="actions">
                          <button className="btn2" onClick={() => doStake(m, "yes")} disabled={busy === m.id}>+25 YES</button>
                          <button className="btn2" onClick={() => doStake(m, "no")} disabled={busy === m.id}>+25 NO</button>
                          <button className="btn2 primary" onClick={() => doResolve(m)} disabled={busy === m.id}>
                            {busy === m.id ? "Verifying proof…" : "Resolve"}
                          </button>
                        </div>
                      )}
                      {rec && (
                        <details className={`receipt${rec.verified ? "" : " bad"}`}>
                          <summary>{rec.verified ? "✓ Proof verified against Solana" : "✗ Proof not verified"}</summary>
                          <div className="rbody">
                            {v ? (
                              <>
                                {m.resolution?.evidence && (
                                  <div className="rstep"><span className="ok">⚡</span>
                                    <span>evidence tick: {m.resolution.evidence.pct.toFixed(2)}% · <code>{m.resolution.evidence.messageId}</code></span></div>
                                )}
                                <div className="rstep"><span className={v.subTreeVerified ? "ok" : "fail"}>{v.subTreeVerified ? "✓" : "✗"}</span><span>odds tick leaf → odds sub-tree root</span></div>
                                <div className="rstep"><span className={v.mainTreeVerified ? "ok" : "fail"}>{v.mainTreeVerified ? "✓" : "✗"}</span>
                                  <span>summary leaf → slot root · <code>{v.computedRootHex.slice(0, 16)}…</code> = on-chain <code>{(v.onChainRootHex ?? "").slice(0, 16)}…</code></span></div>
                                <div className="rstep"><span className={v.pdaEpochDayMatches ? "ok" : "fail"}>{v.pdaEpochDayMatches ? "✓" : "✗"}</span>
                                  <span>anchored in <code>daily_batch_roots</code> · epochDay {v.epochDay}, slot {v.fiveMinSlot}</span></div>
                                <div className="rfoot">
                                  PDA <code>{v.pda.slice(0, 14)}…</code> ·{" "}
                                  <a href={`https://solscan.io/account/${v.pda}`} target="_blank" rel="noreferrer">view anchor account ↗</a>
                                </div>
                              </>
                            ) : (
                              <div>{rec.error ?? "no verification detail"}</div>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
                {err && <div className="err mono">{err}</div>}
              </section>

              <section className="panel">
                <h2>Calibration</h2>
                {cal ? (
                  <>
                    <div className="calhead">
                      <b>~87%</b> — how often real paths touch, as a share of the p/B bound
                      ({cal.fixtures} matches, {cal.samples.length} paths).
                    </div>
                    {cal.buckets.filter((b) => b.n >= 30).map((b) => (
                      <div className="calrow" key={b.barrier}>
                        <span className="mono">{b.barrier}%</span>
                        <div className="calbars">
                          <div className="bound" style={{ width: `${b.meanBound * 100}%` }} />
                          <div className="obs" style={{ width: `${b.observedRate * 100}%` }} />
                        </div>
                        <span className="mono" style={{ textAlign: "right" }}>
                          {pct(b.observedRate, 0)} vs {pct(b.meanBound, 0)}
                        </span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="empty">Loading calibration…</div>
                )}
              </section>
            </>
          )}
        </main>
      </div>

      {sheetOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setSheetOpen(false)} />
          <div className="sheet" role="dialog" aria-label="pick a match">
            <div className="grab" aria-hidden="true" />
            <div className="search">
              <input placeholder="Search teams…" value={filter} onChange={(e) => setFilter(e.target.value)}
                aria-label="search fixtures" autoFocus />
            </div>
            <div className="lists">
              <GroupedList fixtures={fixtures} sel={sel} onPick={select} filter={filter} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
