import type { LineInfo, Side } from "../api.js";
import { flag } from "../flags.js";
import { MarketCard } from "./MarketCard.js";
import { presetsFor, type MarketPreset } from "./marketRoute.js";

export interface MarketListProps {
  fixtureId: number;
  names: { part1: string; draw: string; part2: string };
  lines?: LineInfo[];
  legCount: number;
  onPick: (p: MarketPreset) => void;
  onParlay: () => void;
}

/** The default view under the pinned chart: a dense board of joinable markets built
 *  from the five instruments across both sides, plus a parlay builder. */
export function MarketList({ fixtureId, names, lines, legCount, onPick, onParlay }: MarketListProps) {
  const hasLine1 = !!lines?.some((l) => l.id === 1);
  const presets = presetsFor(hasLine1);

  const nameFor = (p: MarketPreset): string => {
    if (p.line) {
      const ln = lines?.find((l) => l.id === p.line);
      if (ln) return ln.names[p.side];
    }
    return p.side === "draw" ? "Draw" : names[p.side as Exclude<Side, "draw">];
  };
  const leadFor = (p: MarketPreset, sideName: string): string =>
    p.line ? "📈" : p.side === "draw" ? "🤝" : flag(sideName);

  return (
    <section className="tl-mktlist">
      <div className="tl-mktlist-head">
        <h2>Markets</h2>
        <span className="tl-mktlist-sub mono">{presets.length} contracts · one tap to join</span>
      </div>
      <div className="tl-mkt-rows">
        {presets.map((p) => {
          const sideName = nameFor(p);
          return (
            <MarketCard
              key={p.key}
              preset={p}
              fixtureId={fixtureId}
              sideName={sideName}
              lead={leadFor(p, sideName)}
              onPick={onPick}
            />
          );
        })}
        <button className="tl-mkt tl-mkt-parlay" onClick={onParlay} aria-label="build a parlay">
          <span className="tl-mkt-icon k-parlay" aria-hidden="true">＋</span>
          <span className="tl-mkt-body">
            <span className="tl-mkt-q">Build a parlay</span>
            <span className="tl-mkt-meta mono">
              <span className="tl-mkt-kind">{legCount > 0 ? `${legCount} leg${legCount === 1 ? "" : "s"} on ticket` : "combine legs across markets"}</span>
            </span>
          </span>
          <span className="tl-mkt-go" aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
