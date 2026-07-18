import type { PathPoint } from "./api.js";

const COLOR = { part1: "var(--home)", draw: "var(--draw)", part2: "var(--away)" } as const;

/** Real mini sparkline of the three 1X2 probability paths. Home (part1) is emphasized.
 *  preserveAspectRatio="none" + non-scaling strokes let it stretch to any tile width crisply. */
export function Spark({ path }: { path: PathPoint[] }) {
  const pts = path.length >= 2 ? path : path.length === 1 ? [path[0]!, path[0]!] : [];
  if (!pts.length) return <div className="spark-skel" />;
  const n = pts.length;
  const VW = 100, VH = 36, pad = 2.5;
  const x = (i: number) => (i / (n - 1)) * VW;
  const y = (v: number) => pad + (1 - Math.max(0, Math.min(100, v)) / 100) * (VH - pad * 2);
  const line = (k: keyof typeof COLOR) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(p[k]).toFixed(2)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden="true">
      <line className="spark-mid" x1={0} x2={VW} y1={y(50)} y2={y(50)} vectorEffect="non-scaling-stroke" />
      {/* draw part1 last so the emphasized home line sits on top */}
      {(["draw", "part2", "part1"] as const).map((k) => (
        <path key={k} d={line(k)} fill="none" stroke={COLOR[k]} vectorEffect="non-scaling-stroke"
          className={`spark-line${k === "part1" ? " emph" : ""}`}
          strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </svg>
  );
}

/** Upcoming fixtures have a sparse pre-match path — show the current implied 1X2 split as a
 *  3-segment bar with a "pre-match odds live" pulse instead of a near-flat sparkline. */
export function PrematchBar({ pt }: { pt: PathPoint }) {
  const total = Math.max(1e-6, pt.part1 + pt.draw + pt.part2);
  const w = (v: number) => `${(v / total) * 100}%`;
  return (
    <div className="prebar-wrap">
      <div className="prebar" role="img" aria-label="pre-match implied probabilities">
        <span className="pseg s1" style={{ width: w(pt.part1) }} />
        <span className="pseg sd" style={{ width: w(pt.draw) }} />
        <span className="pseg s2" style={{ width: w(pt.part2) }} />
      </div>
      <div className="prebar-live"><span className="livedot" aria-hidden="true" /> pre-match odds live</div>
    </div>
  );
}
