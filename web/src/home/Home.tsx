import { useEffect, useMemo, useState } from "react";
import type { Fixture, Side } from "../api.js";
import { FixtureTile } from "./FixtureTile.js";
import { fetchFixtures, fmtTicks, GROUP_META, groupOf, type Group } from "./util.js";
import "./home.css";

const ORDER: Group[] = ["live", "upcoming", "finished"];

export function Home({ onOpen }: { onOpen: (fixtureId: number, side?: Side, barrier?: number) => void }) {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const now = Date.now();

  useEffect(() => {
    let dead = false;
    fetchFixtures()
      .then((fx) => { if (!dead) setFixtures(fx); })
      .catch((e) => { if (!dead) setErr(String(e)); });
    return () => { dead = true; };
  }, []);

  const stats = useMemo(() => {
    const fx = fixtures ?? [];
    const ticks = fx.reduce((a, f) => a + (f.oddsTickCount || 0), 0);
    const live = fx.filter((f) => groupOf(f, now) === "live").length;
    return { count: fx.length, ticks, live };
  }, [fixtures, now]);

  const filtered = useMemo(() => {
    const fx = fixtures ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return fx;
    return fx.filter((f) =>
      `${f.participant1} ${f.participant2} ${f.competition}`.toLowerCase().includes(term),
    );
  }, [fixtures, q]);

  const sections = useMemo(() => {
    return ORDER.map((g) => ({
      group: g,
      list: filtered
        .filter((f) => groupOf(f, now) === g)
        .sort((a, b) => (g === "finished" ? b.startTime - a.startTime : a.startTime - b.startTime)),
    })).filter((s) => s.list.length > 0);
  }, [filtered, now]);

  return (
    <div className="tl-home">
      <div className="tl-home-inner">
        <header className="tl-hero">
          <div className="tl-hero-glow" aria-hidden="true" />
          <p className="tl-hero-kicker">Touchline board · World Cup corpus</p>
          <h1 className="tl-hero-title">
            Every match is a moving <span className="tl-hero-em">line</span>.
          </h1>
          <p className="tl-hero-lede">
            Minute-by-minute win probabilities for every fixture, rebuilt from{" "}
            <b>{fmtTicks(stats.ticks)}</b> anchored odds ticks and verified on Solana.
            Pick a match to open its live path and one-touch markets.
          </p>
          <div className="tl-hero-stats mono">
            <span><b>{stats.count || "—"}</b> matches</span>
            <span className="tl-sep" aria-hidden="true" />
            <span className={stats.live ? "tl-hero-live" : ""}>
              {stats.live > 0 && <span className="tl-dot" aria-hidden="true" />}
              <b>{stats.live}</b> live now
            </span>
            <span className="tl-sep" aria-hidden="true" />
            <span><b>{fmtTicks(stats.ticks)}</b> anchored ticks</span>
          </div>
        </header>

        <div className="tl-controls">
          <div className="tl-search">
            <svg className="tl-search-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search teams or competition…"
              aria-label="search fixtures"
              spellCheck={false}
            />
            {q && (
              <button className="tl-search-clear" onClick={() => setQ("")} aria-label="clear search" type="button">×</button>
            )}
          </div>
          {fixtures && (
            <span className="tl-count mono">
              {filtered.length} {filtered.length === 1 ? "match" : "matches"}
            </span>
          )}
        </div>

        {err && <div className="tl-error mono">Couldn’t load fixtures — {err}</div>}

        {!fixtures && !err && (
          <div className="tl-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="tl-tile tl-tile-skel" style={{ ["--i" as string]: i }} aria-hidden="true">
                <div className="tl-skel tl-skel-line" style={{ width: "42%" }} />
                <div className="tl-skel tl-skel-line" style={{ width: "72%", height: 18, marginTop: 14 }} />
                <div className="tl-skel tl-skel-line" style={{ width: "60%", height: 18, marginTop: 8 }} />
                <div className="tl-skel" style={{ height: 44, marginTop: 16, borderRadius: 8 }} />
              </div>
            ))}
          </div>
        )}

        {fixtures && sections.length === 0 && (
          <div className="tl-empty">
            No matches for “{q}”. <button type="button" className="tl-linkbtn" onClick={() => setQ("")}>Clear search</button>
          </div>
        )}

        {sections.map(({ group, list }) => {
          const meta = GROUP_META[group];
          return (
            <section className="tl-section" key={group}>
              <div className={`tl-rubric${meta.live ? " live" : ""}`}>
                {meta.live && <span className="tl-dot" aria-hidden="true" />}
                <h2>{meta.label}</h2>
                <span className="tl-rubric-count">{list.length}</span>
                <span className="tl-rubric-kicker">{meta.kicker}</span>
                <span className="tl-rubric-rule" aria-hidden="true" />
              </div>
              <div className="tl-grid">
                {list.map((f, i) => (
                  <FixtureTile key={f.fixtureId} f={f} group={group} index={i} now={now} onOpen={onOpen} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
