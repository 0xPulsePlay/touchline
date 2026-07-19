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

// ── bet kinds: UP / DOWN / BAND / HEARTBREAK / COMEBACK ─────────────────────────────────────────
//
// DOWN pricing is the mirror of UP: if X (the win prob) is a martingale then so is 1−X, and a
// down-touch of L from p is an up-touch of 1−L by 1−X from 1−p. Optional stopping gives
//   P(min X ≤ L) ≤ (1−p)/(1−L),
// with the same jump-overshoot argument, so the same empirical discount δ applies.
// BAND = the RACE: does the path hit the UPPER edge before the LOWER edge? ("touch either" is
// degenerate — a martingale ending in {0,1} always exits any interior band, so that product is
// probability ~1.) The race has the classic gambler's-ruin closed form
//   P(hit U before L) = (p − L)/(U − L)
// which is EXACT by optional stopping at the first exit (jump overshoot shifts both edge values,
// a small measurable bias — no δ needed; we charge only the spread). Its hedge is an exact
// replication: hold P/(U−L) win-shares plus a −P·L/(U−L) cash leg; worth P at an up-exit and ~0
// at a down-exit, self-financing at inception. Even the NO side settles cryptographically: the
// first tick at-or-below L is a Merkle-provable resolution, not a timeout.
// HEARTBREAK = touches B and STILL LOSES: optional stopping twice — stop at the touch τ
// (prob p/B), restart the martingale at M_τ ≈ B, lose from there with prob 1−B:
//   P(touch B, then lose) ≤ (p/B)·(1−B).
// Overshoot cuts BOTH factors (M_τ ≥ B), so the bound is one-sided/house-favorable like p/B.
// COMEBACK is the mirror: drops to A and STILL WINS — P ≤ A·(1−p)/(1−A).

export type BetKind = "up" | "down" | "band" | "heartbreak" | "comeback";
export const KIND_IDX: Record<BetKind, number> = { up: 0, down: 1, band: 2, heartbreak: 3, comeback: 4 };

/** Lowest DOWN barrier allowed (bps) — must sit below the current probability by the step. */
export const MIN_DOWN_BPS = 100;
/** Highest DOWN barrier the user may pick given the current probability (bps). */
export function maxDownBarrierBps(currentProbBps: number): number {
  return Math.max(MIN_DOWN_BPS, currentProbBps - MIN_STEP_BPS);
}

export interface KindQuote extends DealerQuote {
  kind: BetKind;
  /** BAND only: the lower edge (bps); `barrierBps` is the upper edge */
  barrier2Bps?: number;
  /** DOWN/BAND: the mirror bound (1−p)/(1−L), bps */
  boundDownBps?: number;
  /** slider range for the active kind */
  maxDownBps?: number;
}

/** Quote any bet kind. UP/HEARTBREAK: barrier above p. DOWN/COMEBACK: barrier below p. BAND: [barrier2 (low), barrier (high)]. */
export function dealerQuoteKind(
  kind: BetKind,
  side: Side,
  pBps: number,
  barrierBps: number,
  discount: number,
  opts: { barrier2Bps?: number; spread?: number } = {},
): KindQuote {
  const spread = opts.spread ?? 0.03;
  if (kind === "up") {
    return { ...dealerQuote(side, pBps, barrierBps, discount, spread), kind };
  }

  const downBound = (L: number) => touchBound((10000 - pBps) / 10000, (10000 - L) / 10000); // (1−p)/(1−L)
  const maxDown = maxDownBarrierBps(pBps);

  if (kind === "heartbreak") {
    // touches B and still loses: (p/B)·(1−B)·δ — the UP gate applies to B
    const up = dealerQuote(side, pBps, barrierBps, discount, spread);
    if (!up.valid) return { ...up, kind };
    const B = barrierBps / 10000;
    const fair = Math.min(1, touchBound(pBps / 10000, B) * (1 - B) * discount);
    const priced = Math.max(0.01, Math.min(0.99, fair * (1 + spread)));
    const priceBps = Math.round(priced * 10000);
    return { ...up, kind, priceBps, payoutMult: 10000 / priceBps };
  }

  if (kind === "comeback") {
    // drops to A and still wins: A·(1−p)/(1−A)·δ — the DOWN gate applies to A
    const down = dealerQuoteKind("down", side, pBps, barrierBps, discount, { spread });
    if (!down.valid) return { ...down, kind };
    const A = barrierBps / 10000;
    const fair = Math.min(1, A * downBound(barrierBps) * discount);
    const priced = Math.max(0.01, Math.min(0.99, fair * (1 + spread)));
    const priceBps = Math.round(priced * 10000);
    return { ...down, kind, priceBps, payoutMult: 10000 / priceBps };
  }

  if (kind === "down") {
    const L = barrierBps;
    const base: Omit<KindQuote, "valid" | "reason"> = {
      kind, side, pBps, barrierBps: L,
      boundBps: Math.round(downBound(L) * 10000), boundDownBps: Math.round(downBound(L) * 10000),
      discount, priceBps: 0, payoutMult: 0, minBarrierBps: MIN_DOWN_BPS, maxDownBps: maxDown,
    };
    if (L > maxDown) {
      return { ...base, valid: false, reason: `barrier must be ≤ ${(maxDown / 100).toFixed(1)}% (current ${(pBps / 100).toFixed(1)}% − step)` };
    }
    if (L < MIN_DOWN_BPS) {
      return { ...base, valid: false, reason: `barrier must be ≥ ${MIN_DOWN_BPS / 100}%` };
    }
    const fair = Math.min(1, downBound(L) * discount);
    const priced = Math.max(0.01, Math.min(0.99, fair * (1 + spread)));
    const priceBps = Math.round(priced * 10000);
    return { ...base, priceBps, payoutMult: 10000 / priceBps, valid: true };
  }

  // band — the race: upper = barrierBps, lower = barrier2Bps; YES = hits upper first
  const U = barrierBps;
  const L = opts.barrier2Bps ?? 0;
  const fairRace = (pBps - L) / Math.max(1, U - L); // gambler's ruin, exact
  const base: Omit<KindQuote, "valid" | "reason"> = {
    kind, side, pBps, barrierBps: U, barrier2Bps: L,
    boundBps: Math.round(Math.max(0, Math.min(1, fairRace)) * 10000), boundDownBps: Math.round(downBound(L) * 10000),
    discount: 1, // exact closed form — no empirical discount, spread only
    priceBps: 0, payoutMult: 0, minBarrierBps: minBarrierBps(pBps), maxDownBps: maxDown,
  };
  if (U < minBarrierBps(pBps)) return { ...base, valid: false, reason: `upper edge must be ≥ ${(minBarrierBps(pBps) / 100).toFixed(1)}%` };
  if (U > MAX_BARRIER_BPS) return { ...base, valid: false, reason: `upper edge must be ≤ ${MAX_BARRIER_BPS / 100}%` };
  if (L > maxDown) return { ...base, valid: false, reason: `lower edge must be ≤ ${(maxDown / 100).toFixed(1)}%` };
  if (L < MIN_DOWN_BPS) return { ...base, valid: false, reason: `lower edge must be ≥ ${MIN_DOWN_BPS / 100}%` };
  const priced = Math.max(0.01, Math.min(0.99, fairRace * (1 + spread)));
  const priceBps = Math.round(priced * 10000);
  return { ...base, priceBps, payoutMult: 10000 / priceBps, valid: true };
}
