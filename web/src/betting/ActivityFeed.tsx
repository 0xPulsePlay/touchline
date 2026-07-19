import { memo, useEffect, useState } from "react";
import { api, type ActivityBet, type BetKind } from "../api.js";

const KICON: Record<BetKind, string> = { up: "↗", down: "↘", band: "⇅", heartbreak: "💔", comeback: "🔄" };
const pctBps = (b: number) => `${(b / 100).toFixed(1)}%`;

/**
 * Standalone live-trades tape for the desktop left column (the graph side). Self-contained poll —
 * shows ALL kinds (the whole tape), unlike the ticket's kind-scoped feed. Desktop-only via CSS.
 */
export const ActivityFeed = memo(function ActivityFeed() {
  const [activity, setActivity] = useState<ActivityBet[]>([]);
  useEffect(() => {
    const tick = () => api.activity().then(setActivity).catch(() => {});
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="panel tape">
      <div className="act-head">Live trades</div>
      {activity.length === 0 && <div className="dim">No trades yet.</div>}
      <div className="act-list">
        {activity.slice(0, 12).map((b) => (
          <div className={`act-row${b.bot ? " bot" : " you"}`} key={b.sig}>
            <span className="act-who">{b.bot ? "🤖" : "🫵"} {b.label}</span>
            <span className="act-what mono">${b.amountUsdc} · {KICON[b.kind ?? "up"]} {pctBps(b.barrierBps)}{b.barrier2Bps ? `↔${pctBps(b.barrier2Bps)}` : ""}</span>
            <span className="act-odds mono">@ {pctBps(b.priceBps)}</span>
          </div>
        ))}
      </div>
    </section>
  );
});
