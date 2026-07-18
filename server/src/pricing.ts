/**
 * Touch pricing on a probability path.
 *
 * Model: the de-margined outcome probability M_t is a martingale that terminates in {0, 1}.
 * For a barrier B > p (current probability), stop at τ = first touch of B. Optional stopping:
 * E[M_τ] = p. A path that never touches B cannot reach 1 (you cannot end at 1 without crossing
 * any B < 1), so it terminates at 0. Hence  p = B·P(touch) + 0  ⟹  P(touch B) = p/B.
 *
 * With jumps (goals reprice in a step), M_τ ≥ B, so p/B becomes an UPPER bound; the empirical
 * discount is measured by the calibration study and applied as a multiplier.
 */

/** Martingale bound for a one-touch above the current level. Inputs/outputs in [0,1]. */
export function touchBound(p: number, B: number): number {
  if (!(p >= 0 && p <= 1) || !(B > 0 && B <= 1)) throw new RangeError("p in [0,1], B in (0,1]");
  if (p >= B) return 1; // already at/above the barrier
  return p / B;
}

/** No-touch is the complement. */
export function noTouchBound(p: number, B: number): number {
  return 1 - touchBound(p, B);
}

/**
 * By symmetry (1 − M_t is also a martingale terminating in {0,1}), a touch DOWN through barrier
 * b < p prices at (1−p)/(1−b).
 */
export function touchDownBound(p: number, b: number): number {
  if (!(p >= 0 && p <= 1) || !(b >= 0 && b < 1)) throw new RangeError("p in [0,1], b in [0,1)");
  if (p <= b) return 1;
  return (1 - p) / (1 - b);
}

export interface Quote {
  /** martingale bound, [0,1] */
  bound: number;
  /** empirical multiplier from calibration (1 = no discount measured), applied to the bound */
  discount: number;
  /** bound × discount, clamped — the displayed fair price */
  fair: number;
}

export function quoteTouch(p: number, B: number, discount = 1): Quote {
  const bound = touchBound(p, B);
  const fair = Math.max(0, Math.min(1, bound * discount));
  return { bound, discount, fair };
}

/**
 * Parimutuel settlement: winners split the whole pool pro-rata (no rake in the prototype).
 * Returns payout per 1 unit staked on the winning side.
 */
export function parimutuelPayoutPerUnit(winPool: number, losePool: number): number {
  if (winPool <= 0) return 0;
  return (winPool + losePool) / winPool;
}
