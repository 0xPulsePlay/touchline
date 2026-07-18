import { useMemo } from "react";
import type { PathPoint, Side } from "./api.js";

const COLOR: Record<Side, string> = { part1: "var(--home)", draw: "var(--draw)", part2: "var(--away)" };

export interface PathChartProps {
  path: PathPoint[];
  startTime: number;
  names: { part1: string; draw: string; part2: string };
  side: Side;
  barrier: number;
  /** replay cursor: index into path (draw up to here); path.length = fully drawn */
  cursor: number;
}

const W = 860, H = 300, M = { t: 18, r: 92, b: 26, l: 40 };

export function PathChart({ path, startTime, names, side, barrier, cursor }: PathChartProps) {
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const { x0, x1 } = useMemo(() => {
    const first = path.find((p) => p.ts >= startTime - 20 * 60000)?.ts ?? path[0]?.ts ?? 0;
    const last = path[path.length - 1]?.ts ?? 1;
    return { x0: first, x1: last };
  }, [path, startTime]);

  const X = (ts: number) => M.l + ((ts - x0) / Math.max(1, x1 - x0)) * pw;
  const Y = (v: number) => M.t + (1 - v / 100) * ph;

  const visible = path.filter((p) => p.ts >= x0).slice(0, Math.max(2, cursor));
  const line = (key: Side) =>
    visible.map((p, i) => `${i ? "L" : "M"}${X(p.ts).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join(" ");

  // first visible crossing for the selected side (display-level; server resolves at full precision)
  const touchIdx = visible.findIndex((p) => p.ts >= startTime && p[side] >= barrier);
  const touch = touchIdx >= 0 ? visible[touchIdx] : undefined;
  const cur = visible[visible.length - 1];
  const minuteOf = (ts: number) => Math.max(0, Math.round((ts - startTime) / 60000));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="probability path replay">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={M.l} x2={M.l + pw} y1={Y(v)} y2={Y(v)} stroke="var(--line-soft)" />
          <text x={M.l - 6} y={Y(v) + 3.5} textAnchor="end">{v}%</text>
        </g>
      ))}
      {/* kickoff marker */}
      <line x1={X(startTime)} x2={X(startTime)} y1={M.t} y2={M.t + ph} stroke="var(--line)" strokeDasharray="3 4" />
      <text x={X(startTime) + 4} y={H - 8}>KO</text>

      {/* barrier */}
      <line x1={M.l} x2={M.l + pw} y1={Y(barrier)} y2={Y(barrier)} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="6 5" />
      <text x={M.l + pw + 6} y={Y(barrier) + 4} fill="var(--accent)" className="slabel">B={barrier}%</text>

      {(["part1", "draw", "part2"] as Side[]).map((k) => (
        <path key={k} d={line(k)} fill="none" stroke={COLOR[k]}
          strokeWidth={k === side ? 2.6 : 1.4} opacity={k === side ? 1 : 0.55}
          strokeLinejoin="round" strokeLinecap="round" />
      ))}

      {/* series end labels — staggered to avoid collisions */}
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

      {/* touch marker */}
      {touch && (
        <g>
          <circle cx={X(touch.ts)} cy={Y(touch[side])} r={7} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
          <circle cx={X(touch.ts)} cy={Y(touch[side])} r={2.8} fill="var(--accent)" />
          <text x={X(touch.ts)} y={Y(touch[side]) - 14} textAnchor="middle" fill="var(--accent)" className="slabel">
            TOUCHED +{minuteOf(touch.ts)}m
          </text>
        </g>
      )}
    </svg>
  );
}
