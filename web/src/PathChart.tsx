import { useMemo } from "react";
import type { BetKind, PathPoint, PhaseTimeline, Side } from "./api.js";
import { buildScale, NOMINAL_END } from "./timeline.js";

const COLOR: Record<Side, string> = { part1: "var(--home)", draw: "var(--draw)", part2: "var(--away)" };

/** short date/time label for the pre-match axis (no match clock to anchor to) */
function fmtPreTick(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "numeric" })}`;
}

export interface PathChartProps {
  path: PathPoint[];
  startTime: number;
  timeline: PhaseTimeline;
  names: { part1: string; draw: string; part2: string };
  side: Side;
  barrier: number;
  /** bet kind — draws the barrier(s) + trigger marker to match (default "up") */
  kind?: BetKind;
  /** band: the lower edge */
  barrier2?: number;
  cursor: number;
  /** live/sim: stable projected axis + draw only up to this wall-ts (smooth reveal) */
  live?: { revealTs: number };
  /** caption shown under "PRE-MATCH ODDS" when the odds don't reach the in-play window */
  preNote?: string;
}

const W = 860, H = 310, M = { t: 18, r: 96, b: 30, l: 40 };

export function PathChart({ path, startTime, timeline, names, side, barrier, kind = "up", barrier2, cursor, live, preNote }: PathChartProps) {
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const lastTs = path[path.length - 1]?.ts ?? startTime;

  const scale = useMemo(
    () => buildScale(timeline, M.l, M.l + pw, lastTs, { project: !!live }),
    [timeline, lastTs, pw, live ? 1 : 0],
  );

  // "pre-match mode": the ODDS don't reach the in-play window. Either there are no in-play phases
  // (upcoming), or the fixture reports phases/score from metadata but no in-play odds tick was ever
  // recorded (a data gap — the 1X2 feed stops before kickoff). Projected phases never count. Render
  // the FULL pre-match odds series over a plain time axis instead of the match-clock axis, which
  // would filter every (pre-kickoff) tick out of view and leave the graph blank.
  const firstPlay = scale?.segments.find((s) => s.playing && !s.projected);
  const hasInPlayData = !!firstPlay && path.some((p) => p.ts >= firstPlay.startTs);
  const preMatch = !hasInPlayData;

  const firstTs = path[0]?.ts ?? startTime;
  const X = preMatch
    ? (ts: number) => M.l + ((ts - firstTs) / Math.max(1, lastTs - firstTs)) * pw
    : scale!.xOf;
  const Y = (v: number) => M.t + (1 - v / 100) * ph;

  const drawFrom = preMatch ? firstTs : (scale!.segments[0]?.startTs ?? firstTs);
  const visible = live
    ? path.filter((p) => p.ts >= drawFrom && p.ts <= live.revealTs)
    : path.filter((p) => p.ts >= drawFrom).slice(0, Math.max(2, cursor));

  // sparse date/time gridlines when there's no match clock to anchor the axis
  const preTicks = preMatch
    ? Array.from({ length: 5 }, (_, i) => {
        const ts = firstTs + (i / 4) * Math.max(1, lastTs - firstTs);
        return { x: M.l + (i / 4) * pw, label: fmtPreTick(ts) };
      })
    : [];
  const line = (key: Side) =>
    visible.map((p, i) => `${i ? "L" : "M"}${X(p.ts).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join(" ");
  // soft area under a series (restyle only — same points as line(), closed to the baseline)
  const area = (key: Side) => {
    if (visible.length < 2) return "";
    const base = Y(0).toFixed(1);
    const x0 = X(visible[0]!.ts).toFixed(1);
    const x1 = X(visible[visible.length - 1]!.ts).toFixed(1);
    return `${line(key)} L${x1} ${base} L${x0} ${base} Z`;
  };

  // kind-aware trigger marker: up/heartbreak look above, down/comeback below, band = either edge
  const downTrigger = kind === "down" || kind === "comeback";
  const touchIdx = visible.findIndex((p) => {
    if (p.ts < startTime) return false;
    if (downTrigger) return p[side] <= barrier;
    if (kind === "band") return p[side] >= barrier || p[side] <= (barrier2 ?? 0);
    return p[side] >= barrier;
  });
  const touch = touchIdx >= 0 ? visible[touchIdx] : undefined;
  const cur = visible[visible.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="probability path replay">
      {/* projected (not-yet-reached) territory: faint tint so the axis shape reads from kickoff */}
      {!preMatch && scale?.segments
        .filter((s) => s.projected)
        .map((s) => (
          <rect key={`proj-${s.phase}-${s.startTs}`} x={s.x0} y={M.t} width={s.x1 - s.x0} height={ph}
            fill="var(--fog)" opacity={0.35} />
        ))}
      {/* the reveal edge ("now" line) in live/sim */}
      {live && visible.length > 1 && (
        <line x1={X(visible[visible.length - 1]!.ts)} x2={X(visible[visible.length - 1]!.ts)}
          y1={M.t} y2={M.t + ph} stroke="var(--live)" strokeWidth={1.5} opacity={0.8} />
      )}
      {/* remaining-drama gauge: E[remaining Σ(ΔM)²] = M_t(1−M_t) for the selected line (see the paper) */}
      {live && cur && names[side] !== "" && (
        <text x={M.l + 4} y={M.t + 12} fill="var(--ink-3)" style={{ fontSize: 9, letterSpacing: "0.06em" }}>
          ⚡ remaining drama {((cur[side] / 100) * (1 - cur[side] / 100)).toFixed(3)}
        </text>
      )}

      {/* compressed break bands, drawn first */}
      {!preMatch && scale?.segments
        .filter((s) => !s.playing)
        .map((s) => (
          <g key={`${s.phase}-${s.startTs}`}>
            <rect x={s.x0} y={M.t} width={s.x1 - s.x0} height={ph} fill="var(--fog)" />
            {(() => {
              // short display names; waits/mini-breaks stay unlabeled unless genuinely wide
              const label = ({ HT: "HT", ET_WAIT: "ET", ET_HT: "", PENS_WAIT: "", PENS: "PENS", SUSP: "SUSP" } as
                Record<string, string>)[s.phase] ?? "";
              return label && s.x1 - s.x0 > 24 ? (
                <text x={(s.x0 + s.x1) / 2} y={M.t + 12} textAnchor="middle"
                  style={{ fontSize: 9, letterSpacing: "0.08em" }}>
                  {label}
                </text>
              ) : null;
            })()}
          </g>
        ))}

      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={M.l} x2={M.l + pw} y1={Y(v)} y2={Y(v)} stroke="var(--line-soft)" />
          <text x={M.l - 6} y={Y(v) + 3.5} textAnchor="end">{v}%</text>
        </g>
      ))}

      {/* stoppage-time tint: from the nominal 45′/90′/105′/120′ mark to the phase's real end */}
      {!preMatch && scale?.segments
        .filter((s) => s.playing && !s.projected && s.clockStartS != null && s.clockEndS != null)
        .map((s) => {
          const nominal = NOMINAL_END[s.phase];
          if (nominal === undefined || (s.clockEndS as number) <= nominal) return null;
          const f = (nominal - (s.clockStartS as number)) / ((s.clockEndS as number) - (s.clockStartS as number));
          const xN = s.x0 + Math.max(0, Math.min(1, f)) * (s.x1 - s.x0);
          const plus = Math.ceil(((s.clockEndS as number) - nominal) / 60);
          return (
            <g key={`stop-${s.phase}`}>
              <rect x={xN} y={M.t} width={s.x1 - xN} height={ph} fill="var(--accent)" opacity={0.06} />
              <line x1={xN} x2={xN} y1={M.t} y2={M.t + ph} stroke="var(--line)" strokeDasharray="2 4" />
              <text x={(xN + s.x1) / 2} y={M.t + 12} textAnchor="middle" style={{ fontSize: 9 }}>
                +{plus}′
              </text>
            </g>
          );
        })}

      {/* axis labels: match-clock minute ticks in-play, else pre-match date/time gridlines */}
      {preMatch ? (
        <>
          {preTicks.map((t, i) => (
            <g key={t.x}>
              <line x1={t.x} x2={t.x} y1={M.t} y2={M.t + ph} stroke="var(--line-soft)" opacity={i === 0 ? 0 : 0.6} />
              <text x={t.x} y={H - 12} textAnchor={i === 0 ? "start" : i === preTicks.length - 1 ? "end" : "middle"}>{t.label}</text>
            </g>
          ))}
          <text x={M.l} y={M.t - 4} fill="var(--ink-3)" style={{ fontSize: 9, letterSpacing: "0.08em" }}>
            PRE-MATCH ODDS · {preNote ?? "in-play odds unavailable"}
          </text>
        </>
      ) : (
        scale!.minuteTicks.map((t) => (
          <g key={t.x}>
            <line x1={t.x} x2={t.x} y1={M.t + ph - 4} y2={M.t + ph} stroke="var(--ink-3)" />
            <text x={t.x} y={H - 12} textAnchor="middle">{t.label}</text>
          </g>
        ))
      )}

      {/* kickoff */}
      {!preMatch && scale && scale.segments[1] && (
        <g>
          <line x1={scale.segments[1].x0} x2={scale.segments[1].x0} y1={M.t} y2={M.t + ph} stroke="var(--line)" strokeDasharray="3 4" />
          <text x={scale.segments[1].x0 + 3} y={H - 12}>KO</text>
        </g>
      )}

      {/* barrier(s) */}
      <line x1={M.l} x2={M.l + pw} y1={Y(barrier)} y2={Y(barrier)} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="6 5" />
      <text x={M.l + pw + 6} y={Y(barrier) + 4} fill="var(--accent)" className="slabel">
        {kind === "band" ? `U=${barrier}%` : `B=${barrier}%`}
      </text>
      {kind === "band" && barrier2 !== undefined && (
        <g>
          <line x1={M.l} x2={M.l + pw} y1={Y(barrier2)} y2={Y(barrier2)} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="6 5" opacity={0.7} />
          <text x={M.l + pw + 6} y={Y(barrier2) + 4} fill="var(--accent)" className="slabel">L={barrier2}%</text>
        </g>
      )}

      {/* soft neon area fills under the two team series — vertical fade to the baseline */}
      <defs>
        {(["part1", "part2"] as Side[]).map((k) => (
          <linearGradient key={`g-${k}`} id={`pcfade-${k}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLOR[k] === "var(--home)" ? "#1fb96b" : "#ff4d5e"} stopOpacity={0.28} />
            <stop offset="70%" stopColor={COLOR[k] === "var(--home)" ? "#1fb96b" : "#ff4d5e"} stopOpacity={0.04} />
            <stop offset="100%" stopColor={COLOR[k] === "var(--home)" ? "#1fb96b" : "#ff4d5e"} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      {(["part1", "part2"] as Side[]).filter((k) => names[k] !== "").map((k) => (
        <path key={`a-${k}`} className="pc-area" d={area(k)} fill={`url(#pcfade-${k})`} stroke="none"
          opacity={k === side ? 1 : 0.3} />
      ))}

      {(["part1", "draw", "part2"] as Side[]).filter((k) => names[k] !== "").map((k) => (
        <path key={k} className={`pc-line${k === side ? " sel" : ""}`} d={line(k)} fill="none" stroke={COLOR[k]}
          style={{ color: COLOR[k] }}
          strokeWidth={k === side ? 2.6 : 1.4} opacity={k === side ? 1 : 0.55}
          strokeLinejoin="round" strokeLinecap="round" />
      ))}

      {/* staggered end labels */}
      {cur &&
        (() => {
          const entries = (["part1", "draw", "part2"] as Side[])
            .filter((k) => names[k] !== "")
            .map((k) => ({ k, y: Y(cur[k]) }))
            .sort((a, b) => a.y - b.y);
          for (let i = 1; i < entries.length; i++) {
            const prev = entries[i - 1]!, e = entries[i]!;
            if (e.y - prev.y < 15) e.y = prev.y + 15;
          }
          return entries.map(({ k, y }) => (
            <text key={k} x={X(cur.ts) + 8} y={y + 4} fill={COLOR[k]} className="slabel">
              {names[k]} {cur[k].toFixed(1)}
            </text>
          ));
        })()}

      {/* touch marker with true match-clock label */}
      {touch && (
        <g>
          <circle cx={X(touch.ts)} cy={Y(touch[side])} r={7} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
          <circle cx={X(touch.ts)} cy={Y(touch[side])} r={2.8} fill="var(--accent)" />
          <text x={X(touch.ts)} y={Y(touch[side]) - 14} textAnchor="middle" fill="var(--accent)" className="slabel">
            {downTrigger ? "DROPPED" : kind === "band" ? "EXIT" : "TOUCHED"} {scale ? scale.labelOf(touch.ts) : ""}
          </text>
        </g>
      )}
    </svg>
  );
}
