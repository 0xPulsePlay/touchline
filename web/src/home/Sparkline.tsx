import { useId } from "react";
import type { PathPoint, Side } from "../api.js";
import { SIDE_COLOR } from "./util.js";

/**
 * Tiny 1X2 probability chart for a tile. The favourite side is drawn as a bold
 * line over a soft area fill (its colour = home/draw/away); the other two sides
 * ghost behind it for context. Path values are on the 0–100 scale.
 *
 * preserveAspectRatio="none" lets it stretch to the full tile width; strokes use
 * vectorEffect="non-scaling-stroke" so they stay crisp under that stretch.
 */
export function Sparkline({ path, side }: { path: PathPoint[]; side: Side }) {
  const gradId = useId();
  const pts = path.length >= 2 ? path : path.length === 1 ? [path[0]!, path[0]!] : [];
  if (!pts.length) return null;

  const VW = 120, VH = 40, pad = 3.5, n = pts.length;
  const x = (i: number) => (i / (n - 1)) * VW;
  const y = (v: number) => pad + (1 - Math.max(0, Math.min(100, v)) / 100) * (VH - pad * 2);
  const d = (k: Side) => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(p[k]).toFixed(2)}`).join(" ");

  const area = `M${x(0).toFixed(2)} ${VH} ${pts
    .map((p, i) => `L${x(i).toFixed(2)} ${y(p[side]).toFixed(2)}`)
    .join(" ")} L${x(n - 1).toFixed(2)} ${VH} Z`;

  const ghosts = (["part1", "draw", "part2"] as Side[]).filter((k) => k !== side);

  return (
    <svg
      className="tl-spark"
      viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ color: SIDE_COLOR[side] }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* 50% reference line — the coin-flip baseline */}
      <line className="tl-spark-mid" x1={0} x2={VW} y1={y(50)} y2={y(50)} vectorEffect="non-scaling-stroke" />

      {ghosts.map((k) => (
        <path
          key={k}
          className="tl-spark-ghost"
          d={d(k)}
          fill="none"
          stroke={SIDE_COLOR[k]}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}

      <path d={area} fill={`url(#${gradId})`} stroke="none" />
      <path
        className="tl-spark-fav"
        d={d(side)}
        fill="none"
        stroke="currentColor"
        pathLength={1}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
