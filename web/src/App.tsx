import { useEffect, useMemo, useRef, useState } from "react";
import { api, type BetKind, type Calibration, type Fixture, type PathResponse, type Side } from "./api.js";
import { BettingPanel } from "./betting/BettingPanel.js";
import { TicketPanel } from "./betting/TicketPanel.js";
import { ActivityFeed } from "./betting/ActivityFeed.js";
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
 *  passed in as `fixtureId`. It composes the probability-path chart + replay, the live/sim
 *  simulate-live driver, the one-click <BettingPanel> (which owns quoting, the on-chain bet,
 *  and the hedge book), and the calibration panel. */
export function App({ fixtureId }: { fixtureId: number }) {
  const [sel, setSel] = useState<Fixture | null>(null);
  const [pathRes, setPathRes] = useState<PathResponse | null>(null);
  const [side, setSide] = useState<Side>("part1");
  const [kind, setKind] = useState<BetKind>("up");
  const [barrier, setBarrier] = useState(60);
  const [barrier2, setBarrier2] = useState(20);
  const [ticketV, setTicketV] = useState(0);
  const [line, setLine] = useState(0);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [cursor, setCursor] = useState(1e9);
  const [playing, setPlaying] = useState(false);
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
    setPlaying(false);
    setCursor(1e9);
    simRef.current = null;
    setSimUi(null);
    setRevealTs(null);
    fullEndRef.current = null;
    setErr(null);
    api.path(fixtureId, { line }).then((r) => {
      if (dead) return;
      setSel(r.fixture);
      setPathRes(r);
      fullEndRef.current = r.path[r.path.length - 1]?.ts ?? r.fixture.startTime;
    }).catch((e) => { if (!dead) setErr(String(e)); });
    return () => { dead = true; };
  }, [fixtureId, line]);

  const isLive = sel ? groupOf(sel, Date.now()) === "live" : false;
  const simActive = !!simUi;

  /** live + simulated-live share one poll loop against the same asOf-truncating endpoint.
   *  Keyed on booleans (not the simUi object) so speed changes don't churn the interval. */
  useEffect(() => {
    if (!sel || (!isLive && !simActive)) return;
    const fid = sel.fixtureId;
    let dead = false;
    let latestSeq = 0; // drop out-of-order responses: a slow older poll must never rewind the reveal
    const tick = async () => {
      let asOf: number | undefined;
      const sim = simRef.current;
      if (sim) {
        sim.now = Math.min(sim.now + sim.speed * 2000, sim.endTs);
        asOf = sim.now;
      }
      const seq = ++latestSeq;
      try {
        const r = await api.path(fid, { asOf, line });
        if (dead || seq !== latestSeq) return;
        setPathRes(r);
        setCursor(1e9); // follow the leading edge
        // tween the reveal cursor to the new edge — continuous fast-forward, not a jump
        const target = r.path[r.path.length - 1]?.ts;
        if (target !== undefined) {
          cancelAnimationFrame(revealAnim.current);
          setRevealTs((prev) => {
            const from = prev ?? target;
            if (from >= target) return from; // never rewind the reveal edge
            const t0 = performance.now(), dur = 1850;
            let lastSet = 0;
            const stepR = (now: number) => {
              const f = Math.min(1, (now - t0) / dur);
              if (now - lastSet > 32 || f >= 1) { setRevealTs(from + f * (target - from)); lastSet = now; }
              if (f < 1 && !dead) revealAnim.current = requestAnimationFrame(stepR);
            };
            revealAnim.current = requestAnimationFrame(stepR);
            return from;
          });
        }
        if (sim && sim.now >= sim.endTs) {
          simRef.current = null;
          setSimUi(null);
          const full = await api.path(fid, { line });
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
  }, [sel, isLive, simActive, line]);

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
    if (sel) api.path(sel.fixtureId, { line }).then((r) => {
      setPathRes(r);
      fullEndRef.current = r.path[r.path.length - 1]?.ts ?? null;
    }).catch(() => {});
  };
  const setSimSpeed = (speed: number) => {
    if (simRef.current) simRef.current.speed = speed;
    setSimUi({ speed });
  };

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

  const onTicketChange = useMemo(() => () => setTicketV((v) => v + 1), []);
  const revealCoarse = useMemo(
    () => (revealTs != null ? Math.floor(revealTs / 1000) * 1000 : null),
    [revealTs != null ? Math.floor(revealTs / 1000) : null],
  );

  const names = useMemo(() => {
    if (!sel) return { part1: "", draw: "Draw", part2: "" };
    if (line > 0) {
      const ln = pathRes?.lines?.find((l) => l.id === line);
      if (ln) return ln.names;
    }
    return { part1: sel.participant1, draw: "Draw", part2: sel.participant2 };
  }, [sel, line, pathRes?.lines]);

  const clockLabel = useMemo(() => {
    if (!pathRes) return null;
    const lastTs = pathRes.path[pathRes.path.length - 1]?.ts ?? 0;
    const scale = buildScale(pathRes.timeline, 0, 1, lastTs);
    return scale ? scale.labelOf : null;
  }, [pathRes]);

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

  // the 1X2 odds never reach the in-play window for this fixture — either it hasn't kicked off, or
  // its metadata reports a result/phases but no in-play odds tick was recorded (a corpus data gap).
  const noInPlayData = !!sel && !!pathRes && !pathRes.path.some((p) => p.ts >= sel.startTime);
  // wall-clock says "live" but nothing has landed: show pre-match, not a stuck "KO −262′" countdown.
  const awaitingFeed = isLive && noInPlayData;
  // caption for the pre-match chart: a future match is waiting on its feed; a past one simply has none.
  const preNote = sel && sel.startTime > now ? "awaiting kickoff feed" : "no in-play odds for this fixture";

  const liveEdgeLabel = (() => {
    if (!sel) return "";
    const edge = revealTs ?? pathRes?.path[pathRes.path.length - 1]?.ts;
    if (edge === undefined || !clockLabel) return "";
    const l = clockLabel(edge);
    if (l === "pre-match" && edge < sel.startTime) {
      return awaitingFeed ? "awaiting kickoff feed" : `KO −${Math.max(0, Math.ceil((sel.startTime - edge) / 60000))}′`;
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
              Couldn’t load this match ({err}).{" "}
              <a href="#/" style={{ color: "var(--pitch)" }}>← Back to matches</a>
            </div>
          ) : (
            <div className="empty">Loading match…</div>
          )
        ) : (
          <div className="dcols">
            <div className="dleft">
            <div className="matchhead">
              <span className="vs display">
                {flag(sel.participant1)} {sel.participant1} {headScore} {sel.participant2} {flag(sel.participant2)}
              </span>
              <span className={`badge${sel.isFinal ? " ft" : selGroup === "live" && !awaitingFeed ? " live" : ""}`}>
                {sel.isFinal ? "Full time" : awaitingFeed ? "Pre-match" : selGroup === "live" ? "Live" : "Scheduled"}
              </span>
              <span className="when">{fmtDay(sel.startTime)} · {sel.competition}</span>
            </div>

            <section className="panel">
              <div className="panelhead">
                <h2>Probability path</h2>
                {(pathRes?.lines?.length ?? 0) > 1 && (
                  <select className="linepick" value={line} aria-label="probability line"
                    onChange={(e) => { setLine(Number(e.target.value)); setSide("part1"); }}>
                    {pathRes!.lines!.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                )}
                {sel.isFinal && !simUi && !noInPlayData && (
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
                    kind={kind}
                    barrier2={kind === "band" ? barrier2 : undefined}
                    cursor={simUi || isLive ? 1e9 : visibleCursor}
                    live={simUi || isLive ? { revealTs: revealTs ?? (pathRes.path[pathRes.path.length - 1]?.ts ?? sel.startTime) } : undefined}
                    preNote={preNote}
                  />
                  {simUi || isLive ? (
                    <div className="livebar">
                      <span className={`livedot${awaitingFeed && !simUi ? " waiting" : ""}`} aria-hidden="true" />
                      <span className="mono livelabel">{simUi ? "SIM · " : awaitingFeed ? "" : "LIVE · "}{liveEdgeLabel}{headScore !== "vs" ? ` · ${headScore}` : ""}</span>
                      {simUi && (
                        <>
                          <span className="speeds">
                            {[10, 15, 30, 60, 180, 600].map((s) => (
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

            <ActivityFeed />
            </div>

            <div className="dright">
            <BettingPanel
              fixture={sel}
              side={side}
              setSide={setSide}
              kind={kind}
              setKind={setKind}
              barrier={barrier}
              setBarrier={setBarrier}
              barrier2={barrier2}
              setBarrier2={setBarrier2}
              names={names}
              path={pathRes?.path}
              revealTs={simUi || isLive ? (revealCoarse ?? pathRes?.path[pathRes.path.length - 1]?.ts ?? null) : null}
              simActive={!!simUi || isLive}
              fullEndTs={fullEndRef.current}
              onTicket={onTicketChange}
              line={line}
            />

            <TicketPanel version={ticketV} onChanged={onTicketChange} />

            <details className="panel cal-acc">
              <summary><h2>Calibration</h2><span className="cal-chev" aria-hidden="true">▾</span></summary>
              {cal ? (
                <>
                  <div className="calhead">
                    <b>~87%</b>: how often real paths touch, as a share of the p/B bound
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
            </details>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
