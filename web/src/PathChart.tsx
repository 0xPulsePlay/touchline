import { useMemo } from "react";
import type { PathPoint, PhaseTimeline, Side } from "./api.js";
import { buildScale, NOMINAL_END } from "./timeline.js";

const COLOR: Record<Side, string> = { part1: "var(--home)", draw: "var(--draw)", part2: "var(--away)" };

export interface PathChartProps {
  path: PathPoint[];
  startTime: number;
  timeline: PhaseTimeline;
  names: { part1: string; draw: string; part2: string };
  side: Side;
  barrier: number;
  cursor: number;
  /** live/sim: stable projected axis + draw only up to this wall-ts (smooth reveal) */
  live?: { revealTs: number };
}

const W = 860, H = 310, M = { t: 18, r: 96, b: 30, l: 40 };

export function PathChart({ path, startTime, timeline, names, side, barrier, cursor, live }: PathChartProps) {
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const lastTs = path[path.length - 1]?.ts ?? startTime;

  const scale = useMemo(
    () => buildScale(timeline, M.l, M.l + pw, lastTs, { project: !!live }),
    [timeline, lastTs, pw, live ? 1 : 0],
  );

  // wall-clock fallback when a fixture has no scores coverage
  const x0 = path.find((p) => p.ts >= startTime - 20 * 60000)?.ts ?? path[0]?.ts ?? 0;
  const X = scale
    ? scale.xOf
    : (ts: number) => M.l + ((ts - x0) / Math.max(1, lastTs - x0)) * pw;
  const Y = (v: number) => M.t + (1 - v / 100) * ph;

  const drawFrom = scale ? (scale.segments[0]?.startTs ?? x0) : x0;
  const visible = live
    ? path.filter((p) => p.ts >= drawFrom && p.ts <= live.revealTs)
    : path.filter((p) => p.ts >= drawFrom).slice(0, Math.max(2, cursor));
  const line = (key: Side) =>
    visible.map((p, i) => `${i ? "L" : "M"}${X(p.ts).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join(" ");

  const touchIdx = visible.findIndex((p) => p.ts >= startTime && p[side] >= barrier);
  const touch = touchIdx >= 0 ? visible[touchIdx] : undefined;
  const cur = visible[visible.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="probability path replay">
      {/* projected (not-yet-reached) territory: faint tint so the axis shape reads from kickoff */}
      {scale?.segments
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

      {/* compressed break bands, drawn first */}
      {scale?.segments
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
      {scale?.segments
        .filter((s) => s.playing && s.clockStartS != null && s.clockEndS != null)
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

      {/* match-clock minute ticks (15′ marks inside playing phases) */}
      {scale ? (
        scale.minuteTicks.map((t) => (
          <g key={t.x}>
            <line x1={t.x} x2={t.x} y1={M.t + ph - 4} y2={M.t + ph} stroke="var(--ink-3)" />
            <text x={t.x} y={H - 12} textAnchor="middle">{t.label}</text>
          </g>
        ))
      ) : (
        <text x={M.l} y={H - 12}>wall clock (no scores coverage for this fixture)</text>
      )}

      {/* kickoff */}
      {scale && scale.segments[1] && (
        <g>
          <line x1={scale.segments[1].x0} x2={scale.segments[1].x0} y1={M.t} y2={M.t + ph} stroke="var(--line)" strokeDasharray="3 4" />
          <text x={scale.segments[1].x0 + 3} y={H - 12}>KO</text>
        </g>
      )}

      {/* barrier */}
      <line x1={M.l} x2={M.l + pw} y1={Y(barrier)} y2={Y(barrier)} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="6 5" />
      <text x={M.l + pw + 6} y={Y(barrier) + 4} fill="var(--accent)" className="slabel">B={barrier}%</text>

      {(["part1", "draw", "part2"] as Side[]).map((k) => (
        <path key={k} d={line(k)} fill="none" stroke={COLOR[k]}
          strokeWidth={k === side ? 2.6 : 1.4} opacity={k === side ? 1 : 0.55}
          strokeLinejoin="round" strokeLinecap="round" />
      ))}

      {/* staggered end labels */}
      {cur &&
        (() => {
          const entries = (["part1", "draw", "part2"] as Side[])
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
            TOUCHED {scale ? scale.labelOf(touch.ts) : ""}
          </text>
        </g>
      )}
    </svg>
  );
}
