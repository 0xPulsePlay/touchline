import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Calibration, type Fixture, type Market, type PathResponse, type Quote, type Side } from "./api.js";
import { BettingPanel } from "./betting/BettingPanel.js";
import { flag } from "./flags.js";
import { groupOf } from "./groups.js";
import { AppBar } from "./AppBar.js";
import { PathChart } from "./PathChart.js";
import { buildScale } from "./timeline.js";

const fmtDay = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
  " · " + new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;

/** Single-fixture market/detail view. The fixture is chosen by the route (#/m/<id>) and
 *  passed in as `fixtureId`; everything else — probability path + replay, the live/sim
 *  simulate-live driver, the one-touch market builder, parimutuel cards + proof receipts,
 *  and the calibration panel — is unchanged from the standalone app. */
export function App({ fixtureId }: { fixtureId: number }) {
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
  /** simulated-live driver: virtual clock advanced by the poll loop; null = not simulating */
  const simRef = useRef<{ now: number; speed: number; endTs: number } | null>(null);
  const [simUi, setSimUi] = useState<{ speed: number } | null>(null);
  /** last tick of the FULL (untruncated) path — sims always span the real match, never a truncated view */
  const fullEndRef = useRef<number | null>(null);
  /** smooth-reveal cursor for live/sim: tweens toward each poll's leading edge */
  const [revealTs, setRevealTs] = useState<number | null>(null);
  const revealAnim = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    api.calibration().then(setCal).catch(() => {});
  }, []);

  /** Route-driven selection: load the fixture's full path (which carries the fixture
   *  metadata) + markets, and reset every transient view/sim bit for the new match. */
  useEffect(() => {
    let dead = false;
    setSel(null);
    setPathRes(null);
    setMarkets([]);
    setQuote(null);
    setPlaying(false);
    setCursor(1e9);
    simRef.current = null;
    setSimUi(null);
    setRevealTs(null);
    fullEndRef.current = null;
    setErr(null);
    api.path(fixtureId).then((r) => {
      if (dead) return;
      setSel(r.fixture);
      setPathRes(r);
      fullEndRef.current = r.path[r.path.length - 1]?.ts ?? r.fixture.startTime;
    }).catch((e) => { if (!dead) setErr(String(e)); });
    api.markets(fixtureId).then((m) => { if (!dead) setMarkets(m); }).catch(() => {});
    return () => { dead = true; };
  }, [fixtureId]);

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
        // tween the reveal cursor to the new edge — continuous fast-forward, not a jump
        const target = r.path[r.path.length - 1]?.ts;
        if (target !== undefined) {
          cancelAnimationFrame(revealAnim.current);
          setRevealTs((prev) => {
            const from = prev ?? target;
            if (from >= target) return target;
            const t0 = performance.now(), dur = 1850;
            const stepR = (now: number) => {
              const f = Math.min(1, (now - t0) / dur);
              setRevealTs(from + f * (target - from));
              if (f < 1 && !dead) revealAnim.current = requestAnimationFrame(stepR);
            };
            revealAnim.current = requestAnimationFrame(stepR);
            return from;
          });
        }
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
    return () => { dead = true; clearInterval(id); cancelAnimationFrame(revealAnim.current); };
  }, [sel, isLive, simActive]);

  const startSim = () => {
    if (!sel || fullEndRef.current == null) return;
    simRef.current = { now: sel.startTime - 10 * 60_000, speed: 180, endTs: fullEndRef.current + 2 * 60_000 };
    setSimUi({ speed: 180 });
    setRevealTs(sel.startTime - 10 * 60_000);
    setPlaying(false);
  };
  const exitSim = () => {
    simRef.current = null;
    setSimUi(null);
    setRevealTs(null);
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

  const visibleCursor = pathRes ? Math.min(cursor, pathRes.path.length) : 0;
  const now = Date.now();
  const selGroup = simUi ? "live" : sel ? groupOf(sel, now) : "finished";
  /** running score at a wall-ts, from the asOf-truncated scoreline (null before kickoff data) */
  const scoreAt = (ts: number): { p1: number; p2: number } | null => {
    const sl = pathRes?.timeline.scoreline;
    if (!sl?.length) return null;
    let cur: { p1: number; p2: number } | null = null;
    for (const s of sl) {
      if (s.ts <= ts) cur = { p1: s.p1, p2: s.p2 };
      else break;
    }
    return cur;
  };

  const liveEdgeLabel = (() => {
    if (!sel) return "";
    const edge = revealTs ?? pathRes?.path[pathRes.path.length - 1]?.ts;
    if (edge === undefined || !clockLabel) return "";
    const l = clockLabel(edge);
    if (l === "pre-match" && edge < sel.startTime) {
      return `KO −${Math.max(0, Math.ceil((sel.startTime - edge) / 60000))}′`;
    }
    return l;
  })();

  /** score string for the header: live/sim = running score at the reveal edge */
  const headScore = (() => {
    if (!sel) return "vs";
    if (simUi || isLive) {
      const edge = revealTs ?? pathRes?.path[pathRes.path.length - 1]?.ts ?? 0;
      const s = scoreAt(edge);
      return s ? `${s.p1}–${s.p2}` : "vs";
    }
    return sel.isFinal ? `${sel.finalP1}–${sel.finalP2}` : "vs";
  })();

  return (
    <>
      <AppBar back />

      <main className="main detail">
        {!sel ? (
          err ? (
            <div className="empty">
              Couldn’t load this match — {err}.{" "}
              <a href="#/" style={{ color: "var(--pitch)" }}>← Back to matches</a>
            </div>
          ) : (
            <div className="empty">Loading match…</div>
          )
        ) : (
          <>
            <div className="matchhead">
              <span className="vs display">
                {flag(sel.participant1)} {sel.participant1} {headScore} {sel.participant2} {flag(sel.participant2)}
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
                    live={simUi || isLive ? { revealTs: revealTs ?? (pathRes.path[pathRes.path.length - 1]?.ts ?? sel.startTime) } : undefined}
                  />
                  {simUi || isLive ? (
                    <div className="livebar">
                      <span className="livedot" aria-hidden="true" />
                      <span className="mono livelabel">{simUi ? "SIM · " : "LIVE · "}{liveEdgeLabel}{headScore !== "vs" ? ` · ${headScore}` : ""}</span>
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
                          if (!p || !clockLabel) return "";
                          const s = scoreAt(p.ts);
                          return `${clockLabel(p.ts)}${s ? ` · ${s.p1}–${s.p2}` : ""}`;
                        })()}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty">Loading path…</div>
              )}
            </section>

            <BettingPanel
              fixture={sel}
              side={side}
              setSide={setSide}
              barrier={barrier}
              setBarrier={setBarrier}
              names={names}
            />

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
    </>
  );
}
