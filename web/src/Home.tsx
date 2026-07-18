import { useEffect, useRef, useState } from "react";
import { api, type Fixture, type PathPoint, type Side } from "./api.js";
import { flag } from "./flags.js";
import { groupOf, GROUP_META, type Group } from "./groups.js";
import { PrematchBar, Spark } from "./Spark.js";

/* ── formatting ─────────────────────────────────────── */
const fmtKO = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { weekday: "short" }) + " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtTicks = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n);

/* ── lazy path cache: fetch once per fixture, share across tiles ─ */
const pathCache = new Map<number, PathPoint[]>();
const inflight = new Map<number, Promise<PathPoint[]>>();
function loadPath(id: number): Promise<PathPoint[]> {
  const cached = pathCache.get(id);
  if (cached) return Promise.resolve(cached);
  let p = inflight.get(id);
  if (!p) {
    p = api.path(id, { every: 60 }).then((r) => {
      pathCache.set(id, r.path);
      inflight.delete(id);
      return r.path;
    });
    inflight.set(id, p);
  }
  return p;
}

/** Reveal-on-scroll: keeps the grid fast by deferring sparkline fetches until near the viewport. */
function useInView<T extends Element>(rootMargin = "250px"): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setInView(true);
        io.disconnect();
      }
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView];
}

type Fav = { side: Side; label: string; flag: string; pct: number };
function favOf(pt: PathPoint, f: Fixture): Fav {
  const opts: Array<[Side, number, string]> = [
    ["part1", pt.part1, f.participant1],
    ["draw", pt.draw, "Draw"],
    ["part2", pt.part2, f.participant2],
  ];
  const [side, pct, name] = opts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { side, pct, label: name, flag: side === "draw" ? "🤝" : flag(name) };
}

/* ── tile ───────────────────────────────────────────── */
function Tile({ f, group }: { f: Fixture; group: Group }) {
  const [ref, inView] = useInView<HTMLAnchorElement>();
  const [path, setPath] = useState<PathPoint[] | null>(() => pathCache.get(f.fixtureId) ?? null);

  useEffect(() => {
    if (!inView || path) return;
    let dead = false;
    loadPath(f.fixtureId).then((p) => { if (!dead) setPath(p); }).catch(() => {});
    return () => { dead = true; };
  }, [inView, path, f.fixtureId]);

  const last = path && path.length ? path[path.length - 1]! : null;
  const fav = last ? favOf(last, f) : null;
  const score = f.isFinal ? `${f.finalP1 ?? "–"}–${f.finalP2 ?? "–"}` : null;

  return (
    <a ref={ref} className={`tile g-${group}`} href={`#/m/${f.fixtureId}`}>
      <div className="tile-head">
        <span className="tile-comp">{f.competition}</span>
        <span className={`tile-status ${group}`}>
          {group === "live"
            ? <><span className="livedot" aria-hidden="true" /> LIVE</>
            : group === "upcoming" ? fmtKO(f.startTime) : fmtDate(f.startTime)}
        </span>
      </div>

      <div className="tile-teams">
        <span className="tt"><span className="fl">{flag(f.participant1)}</span> {f.participant1}</span>
        <span className="tile-mid mono">{score ?? "v"}</span>
        <span className="tt r">{f.participant2} <span className="fl">{flag(f.participant2)}</span></span>
      </div>

      <div className="tile-viz">
        {path
          ? (group === "upcoming"
              ? (last ? <PrematchBar pt={last} /> : <div className="spark-skel" />)
              : <Spark path={path} />)
          : <div className="spark-skel" />}
      </div>

      <div className="tile-foot">
        {fav
          ? <span className={`tile-fav side-${fav.side}`}>{fav.flag} {fav.pct.toFixed(1)}%</span>
          : <span className="tile-fav muted">—</span>}
        <span className="tile-go">Pick a path <span aria-hidden="true">→</span></span>
      </div>
    </a>
  );
}

function Section({ g, list, more }: {
  g: Group; list: Fixture[]; more?: { count: number; onClick: () => void };
}) {
  const meta = GROUP_META[g];
  return (
    <section className="hsection">
      <div className={`hsec-head${meta.live ? " live" : ""}`}>
        {meta.live && <span className="livedot" aria-hidden="true" />}
        <h2>{meta.label}</h2>
        <span className="hsec-count">{more ? more.count : list.length}</span>
      </div>
      <div className="tilegrid">
        {list.map((f) => <Tile key={f.fixtureId} f={f} group={g} />)}
      </div>
      {more && (
        <button className="showall" onClick={more.onClick}>
          Show all {more.count} finished matches
        </button>
      )}
    </section>
  );
}

/* ── page ───────────────────────────────────────────── */
export function Home() {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showAllFinished, setShowAllFinished] = useState(false);

  useEffect(() => {
    let dead = false;
    const load = () =>
      api.fixtures().then((fx) => { if (!dead) setFixtures(fx); }).catch((e) => { if (!dead) setErr(String(e)); });
    load();
    const id = setInterval(load, 30000); // pick up newly-live fixtures without a reload
    return () => { dead = true; clearInterval(id); };
  }, []);

  const now = Date.now();
  const bucket = (g: Group) =>
    fixtures
      .filter((f) => groupOf(f, now) === g)
      .sort((a, b) => (g === "finished" ? b.startTime - a.startTime : a.startTime - b.startTime));
  const live = bucket("live"), upcoming = bucket("upcoming"), finished = bucket("finished");

  const FIN_CAP = 24;
  const finShown = showAllFinished ? finished : finished.slice(0, FIN_CAP);
  const totalTicks = fixtures.reduce((s, f) => s + f.oddsTickCount, 0);

  return (
    <>
      <header className="appbar">
        <a className="brand" href="#/">TOUCH<span className="tick">LINE</span></a>
        <div className="spacer" />
        <span className="appbar-tag">Options on the probability path</span>
      </header>

      <div className="home">
        <section className="hero">
          <h1 className="hero-title display">Pick a path. <span className="hl">Name your barrier.</span></h1>
          <p className="hero-sub">
            One-touch markets on de-margined win-probability paths — priced by the p/B martingale bound,
            resolved by a Merkle proof of a single odds tick anchored on Solana.
          </p>
          <div className="hero-stat mono">
            {fixtures.length ? (
              <>
                {live.length > 0 && (
                  <span className="hs live"><span className="livedot" aria-hidden="true" /> {live.length} live</span>
                )}
                <span>{fixtures.length} matches</span>
                <span>{fmtTicks(totalTicks)} odds ticks</span>
              </>
            ) : "loading corpus…"}
          </div>
        </section>

        {err && <div className="err mono">{err}</div>}

        {live.length > 0 && <Section g="live" list={live} />}
        {upcoming.length > 0 && <Section g="upcoming" list={upcoming} />}
        {finished.length > 0 && (
          <Section
            g="finished"
            list={finShown}
            more={!showAllFinished && finished.length > FIN_CAP
              ? { count: finished.length, onClick: () => setShowAllFinished(true) }
              : undefined}
          />
        )}
      </div>
    </>
  );
}
