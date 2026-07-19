export interface StatStripProps {
  focusLabel: string;  // match clock, e.g. "53'"
  focusSub: string;    // wall-clock or phase caption
  name1: string;
  name2: string;
  v1: number | null;   // 0–100
  v2: number | null;
  vDraw: number | null;
  d1: number | null;   // live move, percentage points
  d2: number | null;
  showDraw: boolean;
}

const val = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const move = (d: number | null) => {
  if (d == null || Math.abs(d) < 0.05) return "FLAT";
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%`;
};

/** The stat strip above the chart: FOCUS clock, each side's live equity with its
 *  "live move" delta, and the draw/parity reserve. Mono, colour-coded, scroll-safe. */
export function StatStrip({ focusLabel, focusSub, name1, name2, v1, v2, vDraw, d1, d2, showDraw }: StatStripProps) {
  return (
    <div className="tl-strip mono">
      <div className="tl-strip-scroll">
        <div className="tl-cell">
          <span className="tl-cell-k">Focus</span>
          <span className="tl-cell-v">{focusLabel || "—"}</span>
          <span className="tl-cell-sub">{focusSub}</span>
        </div>
        <div className="tl-cell s1">
          <span className="tl-cell-k">{name1} equity</span>
          <span className="tl-cell-v">{val(v1)}</span>
          <span className="tl-cell-sub">live move {move(d1)}</span>
        </div>
        <div className="tl-cell s2">
          <span className="tl-cell-k">{name2} equity</span>
          <span className="tl-cell-v">{val(v2)}</span>
          <span className="tl-cell-sub">live move {move(d2)}</span>
        </div>
        {showDraw && (
          <div className="tl-cell sd">
            <span className="tl-cell-k">Draw / parity</span>
            <span className="tl-cell-v">{val(vDraw)}</span>
            <span className="tl-cell-sub">market reserve</span>
          </div>
        )}
      </div>
      <div className="tl-strip-legend">
        <span className="lg s1"><i aria-hidden="true" />{name1}</span>
        <span className="lg s2"><i aria-hidden="true" />{name2}</span>
        {showDraw && <span className="lg sd"><i aria-hidden="true" />Draw</span>}
      </div>
    </div>
  );
}
