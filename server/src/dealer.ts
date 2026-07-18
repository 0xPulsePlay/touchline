import { quoteTouch, touchBound } from "./pricing.js";
import type { Side } from "./model.js";

/**
 * The dealer/house pricing model (the hedging-strategy decision, not LMSR): the house quotes a
 * fair one-touch price and takes the other side. Users may only bet on the barrier being reached
 * from BELOW the current probability — a "touch" market is meaningless at or under the current
 * level — so the barrier is GATED to ≥ current p + a minimum step.
 */

export const MIN_STEP_BPS = 100; // barrier must be ≥ current prob + 1.0 pt
export const MAX_BARRIER_BPS = 9500;

/** The lowest barrier (bps) a user may pick given the side's current probability (bps). */
export function minBarrierBps(currentProbBps: number): number {
  return Math.min(MAX_BARRIER_BPS, Math.max(currentProbBps + MIN_STEP_BPS, 500));
}

export interface DealerQuote {
  side: Side;
  /** current de-margined probability, bps */
  pBps: number;
  /** chosen barrier, bps */
  barrierBps: number;
  /** martingale bound p/B, bps */
  boundBps: number;
  /** empirical touch discount applied (e.g. 0.87) */
  discount: number;
  /** the price the house charges YES, bps (fair × house spread) */
  priceBps: number;
  /** decimal payout multiple = 1 / price */
  payoutMult: number;
  /** the minimum barrier the user may pick */
  minBarrierBps: number;
  valid: boolean;
  reason?: string;
}

/**
 * Quote a one-touch YES at `barrierBps` for a side currently at `pBps`.
 * `spread` is the house edge on top of the fair price (e.g. 0.03 → house charges fair×1.03,
 * i.e. pays slightly less than fair — the dealer's margin, symmetric to a book's vig but tiny).
 */
export function dealerQuote(
  side: Side,
  pBps: number,
  barrierBps: number,
  discount: number,
  spread = 0.03,
): DealerQuote {
  const minBar = minBarrierBps(pBps);
  const base: Omit<DealerQuote, "valid" | "reason"> = {
    side, pBps, barrierBps,
    boundBps: Math.round(touchBound(pBps / 10000, barrierBps / 10000) * 10000),
    discount,
    priceBps: 0, payoutMult: 0,
    minBarrierBps: minBar,
  };
  if (barrierBps < minBar) {
    return { ...base, valid: false, reason: `barrier must be ≥ ${(minBar / 100).toFixed(1)}% (current ${(pBps / 100).toFixed(1)}% + step)` };
  }
  if (barrierBps > MAX_BARRIER_BPS) {
    return { ...base, valid: false, reason: `barrier must be ≤ ${MAX_BARRIER_BPS / 100}%` };
  }
  const fair = quoteTouch(pBps / 10000, barrierBps / 10000, discount).fair; // [0,1]
  const priced = Math.max(0.01, Math.min(0.99, fair * (1 + spread))); // house charges a touch more
  const priceBps = Math.round(priced * 10000);
  return { ...base, priceBps, payoutMult: 10000 / priceBps, valid: true };
}
