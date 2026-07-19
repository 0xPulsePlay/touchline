import { useEffect, useState } from "react";
import { api, type DealerQuote } from "../api.js";
import { KIND_META } from "../betting/kinds.js";
import type { MarketPreset } from "./marketRoute.js";

const pctBps = (b: number) => `${(b / 100).toFixed(1)}%`;

export interface MarketCardProps {
  preset: MarketPreset;
  fixtureId: number;
  /** resolved display name for this preset's side (team name, "Draw", or a line label) */
  sideName: string;
  /** leading glyph — country flag for 1X2 sides, a marker for line markets */
  lead: string;
  onPick: (p: MarketPreset) => void;
}

/** One joinable market in the list. Fetches its own quote (one cheap platform call,
 *  re-polled slowly), shows the live price → payout, and opens the ticket on click. */
export function MarketCard({ preset, fixtureId, sideName, lead, onPick }: MarketCardProps) {
  const [quote, setQuote] = useState<DealerQuote | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let dead = false;
    const fetchQuote = () =>
      api.dealerQuote(fixtureId, preset.side, preset.barrier, preset.kind, preset.barrier2, preset.line ?? 0)
        .then((q) => { if (!dead) { setQuote(q); setLoaded(true); } })
        .catch(() => { if (!dead) setLoaded(true); });
    void fetchQuote();
    const id = setInterval(fetchQuote, 20_000);
    return () => { dead = true; clearInterval(id); };
  }, [fixtureId, preset.side, preset.barrier, preset.barrier2, preset.kind, preset.line]);

  const meta = KIND_META[preset.kind];
  const question = meta.blurb(sideName, preset.barrier, preset.barrier2 ?? 0);
  const valid = quote?.valid ?? false;

  return (
    <button
      className={`tl-mkt${valid ? " live" : ""}${loaded && !valid ? " off" : ""}`}
      onClick={() => onPick(preset)}
      aria-label={`${question} — open ticket`}
    >
      <span className={`tl-mkt-icon k-${preset.kind}`} aria-hidden="true">{meta.icon}</span>
      <span className="tl-mkt-body">
        <span className="tl-mkt-q">
          <span className="tl-mkt-flag" aria-hidden="true">{lead}</span>
          {question}
        </span>
        <span className="tl-mkt-meta mono">
          <span className="tl-mkt-kind">{meta.label}</span>
          {preset.line ? <span className="tl-mkt-tag">LINE</span> : null}
          {valid ? (
            <span className="tl-mkt-tick"><i aria-hidden="true" />LIVE</span>
          ) : loaded ? (
            <span className="tl-mkt-tag off">{quote?.reason ? "OFF BOARD" : "—"}</span>
          ) : (
            <span className="tl-mkt-tag load">QUOTING…</span>
          )}
        </span>
      </span>
      <span className="tl-mkt-nums mono">
        <span className="tl-mkt-price">{quote ? pctBps(quote.priceBps) : "—"}</span>
        <span className="tl-mkt-payout">{valid ? `${quote!.payoutMult.toFixed(2)}×` : "—"}</span>
      </span>
      <span className="tl-mkt-go" aria-hidden="true">→</span>
    </button>
  );
}
