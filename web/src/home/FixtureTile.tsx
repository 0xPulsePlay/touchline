import { useEffect, useRef, useState } from "react";
import type { Fixture, PathPoint } from "../api.js";
import type { Group } from "../groups.js";
import { flag } from "../flags.js";
import { Sparkline } from "./Sparkline.js";
import { code, countdown, favouriteOf, fmtKickoff, fmtTicks, loadPath, sideName, SIDE_COLOR } from "./util.js";

type LoadState = "idle" | "loading" | "ready" | "error";

export function FixtureTile({
  f, group, index, now,
}: {
  f: Fixture;
  group: Group;
  index: number;
  now: number;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [path, setPath] = useState<PathPoint[] | null>(null);
  const [state, setState] = useState<LoadState>("idle");

  // Lazy-fetch the path only once the tile is (nearly) on screen — never 100+ upfront.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let fetched = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (fetched || !entries.some((e) => e.isIntersecting)) return;
        fetched = true;
        io.disconnect();
        setState("loading");
        loadPath(f.fixtureId)
          .then((p) => { setPath(p); setState("ready"); })
          .catch(() => setState("error"));
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [f.fixtureId]);

  const fav = path ? favouriteOf(path) : null;
  const favName = fav ? sideName(f, fav.side) : "";
  const pct = fav ? Math.round(fav.value) : null;

  const winner: "part1" | "part2" | "draw" | null = f.isFinal && f.finalP1 != null && f.finalP2 != null
    ? f.finalP1 > f.finalP2 ? "part1" : f.finalP2 > f.finalP1 ? "part2" : "draw"
    : null;

  // The tile's emphasis (sparkline + badge): for a FINISHED match, the actual result (winner) —
  // never the 90-minute path's last point, which can read "Draw" for a match decided in extra time.
  // For live/upcoming, the current favourite from the probability path.
  const emphasis = f.isFinal ? winner : fav?.side ?? null;

  const badgeText = f.isFinal
    ? winner === "draw" ? "🤝 Draw"
      : winner ? `${flag(sideName(f, winner))} ${code(sideName(f, winner))} won` : null
    : fav
      ? fav.side === "draw" ? `🤝 Draw ${pct}%` : `${flag(favName)} ${code(favName)} ${pct}%`
      : null;

  const aria = `${f.participant1} versus ${f.participant2}, ${f.competition}. ${
    group === "live" ? "Live now." : group === "finished"
      ? `Full time ${f.finalP1 ?? "?"}–${f.finalP2 ?? "?"}.` : `Kickoff ${fmtKickoff(f.startTime)}.`
  }${fav ? ` ${favName} favoured ${pct} percent.` : ""} Open match.`;

  const team = (side: "part1" | "part2", name: string, goals: number | null) => (
    <div className={`tl-team${winner === side ? " won" : ""}`}>
      <span className="tl-flag" aria-hidden="true">{flag(name)}</span>
      <span className="tl-name">{name}</span>
      {f.isFinal && <span className="tl-goals mono">{goals ?? "–"}</span>}
    </div>
  );

  return (
    <a
      ref={ref}
      href={`#/m/${f.fixtureId}`}
      className="tl-tile"
      style={{ ["--i" as string]: Math.min(index, 14), ...(emphasis ? { ["--fav" as string]: SIDE_COLOR[emphasis] } : fav ? { ["--fav" as string]: fav.color } : {}) }}
      aria-label={aria}
    >
      <div className="tl-top">
        <span className="tl-comp">{f.competition}</span>
        {group === "live" ? (
          <span className="tl-status live"><span className="tl-dot" aria-hidden="true" /> Live</span>
        ) : group === "finished" ? (
          <span className="tl-status ft">Full time</span>
        ) : (
          <span className="tl-status up">{countdown(f.startTime, now) ?? "Scheduled"}</span>
        )}
      </div>

      <div className={`tl-teams${f.isFinal ? " final" : ""}`}>
        {team("part1", f.participant1, f.finalP1)}
        <span className="tl-vs" aria-hidden="true">vs</span>
        {team("part2", f.participant2, f.finalP2)}
      </div>

      {group === "upcoming" && <div className="tl-kick mono">{fmtKickoff(f.startTime)}</div>}

      <div className="tl-chart">
        {state === "ready" && path && path.length >= 2 && fav ? (
          <Sparkline path={path} side={emphasis ?? fav.side} />
        ) : state === "error" ? (
          <div className="tl-chart-empty mono">path unavailable</div>
        ) : state === "ready" ? (
          <div className="tl-chart-empty mono">awaiting first ticks</div>
        ) : (
          <div className="tl-skel" aria-hidden="true" />
        )}
        {badgeText ? (
          <span className="tl-badge">{badgeText}</span>
        ) : state !== "error" && state !== "ready" ? (
          <span className="tl-badge tl-badge-skel" aria-hidden="true" />
        ) : null}
      </div>

      <div className="tl-foot">
        <span className="tl-ticks mono">{fmtTicks(f.oddsTickCount)} anchored ticks</span>
        <span className="tl-open">Open<span className="tl-arrow" aria-hidden="true">→</span></span>
      </div>
    </a>
  );
}
