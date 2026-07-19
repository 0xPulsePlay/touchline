import type { BetKind, DealerQuote, PathPoint, Side } from "./api.js";

/**
 * Client-side mirror of the server dealer math (server/src/dealer.ts) — DISPLAY pricing only.
 * The bet slip re-prices in lockstep with the chart from the same revealed path, with zero
 * network. The SERVER remains authoritative wherever money moves: placement re-prices the
 * co-signed bet server-side at the same observation instant, so any display drift is bounded
 * and always settled in the house's favour of correctness.
 */

const MIN_STEP = 1;     // barrier must clear current p by 1 pt (mirrors MIN_STEP_BPS)
const MAX_BARRIER = 95; // pct (mirrors MAX_BARRIER_BPS)
const MIN_DOWN = 1;     // pct (mirrors MIN_DOWN_BPS)
const SPREAD = 0.03;

const bound = (p: number, B: number) => Math.min(1, p / Math.max(1e-9, B));

/** last revealed tick's probability (pct 0..100) for a side at the observation instant */
export function liveP(path: PathPoint[] | undefined, side: Side, revealTs: number | null | undefined): number | null {
  if (!path?.length) return null;
  if (revealTs == null) return null;
  let last: PathPoint | undefined;
  for (const t of path) { if (t.ts <= revealTs) last = t; else break; }
  return last ? last[side] : null;
}

/** mirror of dealerQuoteKind — pPct/barriers in percent, same gating + rounding as the server */
export function quoteLocal(
  kind: BetKind, side: Side, pPct: number, barrierPct: number, barrier2Pct: number, discount: number,
): DealerQuote {
  const p = pPct / 100, B = barrierPct / 100, L = barrier2Pct / 100;
  const pBps = Math.round(pPct * 100);
  const minBar = Math.min(MAX_BARRIER, Math.max(pPct + MIN_STEP, 5));
  const maxDown = Math.max(MIN_DOWN, pPct - MIN_STEP);
  const base: DealerQuote = {
    side, pBps, barrierBps: Math.round(barrierPct * 100), boundBps: Math.round(bound(p, B) * 10000),
    discount, priceBps: 0, payoutMult: 0, minBarrierBps: Math.round(minBar * 100),
    maxDownBps: Math.round(maxDown * 100), valid: false, kind,
    barrier2Bps: kind === "band" ? Math.round(barrier2Pct * 100) : undefined,
  };
  const price = (fair: number): DealerQuote => {
    const priced = Math.max(0.01, Math.min(0.99, fair * (1 + SPREAD)));
    const priceBps = Math.round(priced * 10000);
    return { ...base, priceBps, payoutMult: 10000 / priceBps, valid: true };
  };

  if (kind === "up" || kind === "heartbreak") {
    if (barrierPct < minBar) return { ...base, valid: false, reason: `barrier must be at least ${minBar.toFixed(1)}% (current ${pPct.toFixed(1)}% + step)` };
    if (barrierPct > MAX_BARRIER) return { ...base, valid: false, reason: `barrier must be at most ${MAX_BARRIER}%` };
    const fair = kind === "up" ? Math.min(1, bound(p, B) * discount) : Math.min(1, bound(p, B) * (1 - B) * discount);
    return price(fair);
  }
  if (kind === "down" || kind === "comeback") {
    if (barrierPct > maxDown) return { ...base, valid: false, reason: `barrier must be at most ${maxDown.toFixed(1)}% (current ${pPct.toFixed(1)}% − step)` };
    if (barrierPct < MIN_DOWN) return { ...base, valid: false, reason: `barrier must be at least ${MIN_DOWN}%` };
    const dn = bound(1 - p, 1 - B);
    const fair = kind === "down" ? Math.min(1, dn * discount) : Math.min(1, B * dn * discount);
    return price(fair);
  }
  // band — the race, exact closed form, spread only
  if (barrierPct < minBar) return { ...base, valid: false, reason: `upper edge must be at least ${minBar.toFixed(1)}%` };
  if (barrier2Pct > maxDown) return { ...base, valid: false, reason: `lower edge must be at most ${maxDown.toFixed(1)}%` };
  if (barrier2Pct < MIN_DOWN) return { ...base, valid: false, reason: `lower edge must be at least ${MIN_DOWN}%` };
  const fairRace = Math.max(0, Math.min(1, (p - L) / Math.max(1e-9, B - L)));
  return { ...price(fairRace), discount: 1, boundBps: Math.round(fairRace * 10000) };
}
