import { describe, it, expect } from "vitest";
import { replicate, hedgeValueAt } from "./hedge.js";

/**
 * The net-zero replication identity. A YES ticket owes payout P if the barrier B is touched.
 * The house holds P/B win-shares bought at the current win price p. The claims:
 *   - self-financing at the fair price: premium P·(p/B) == hedge cost;
 *   - touch at exactly B: hedge is worth P → funds the payout → net 0;
 *   - touch above B (jump overshoot): hedge is worth > P → one-sided residual for the house;
 *   - no touch: shares worthless, house owes nothing → net 0.
 */
describe("hedge replication (net-zero)", () => {
  const P = 10; // $10 payout owed on YES
  const barrierBps = 6000; // B = 60%
  const p = 0.35; // current win price

  it("sizes the hedge at P/B win-shares", () => {
    const { shares } = replicate(P, barrierBps, p);
    expect(shares).toBeCloseTo(P / 0.6, 9); // 16.666… shares
  });

  it("is self-financing: fair premium P·(p/B) equals hedge cost", () => {
    const { cost } = replicate(P, barrierBps, p);
    const fairPremium = P * (p / 0.6); // what the user pays at the pure p/B price
    expect(cost).toBeCloseTo(fairPremium, 9);
  });

  it("a touch exactly at the barrier funds the payout with net 0", () => {
    const { shares } = replicate(P, barrierBps, p);
    const value = hedgeValueAt(shares, "yes", 0.60, barrierBps);
    expect(value - P).toBeCloseTo(0, 9);
  });

  it("a jump overshoot leaves a one-sided residual in the house's favour", () => {
    const { shares } = replicate(P, barrierBps, p);
    const value = hedgeValueAt(shares, "yes", 0.697, barrierBps); // overshot to 69.7%
    expect(value).toBeGreaterThan(P);
    expect(value - P).toBeCloseTo(shares * (0.697 - 0.60), 9);
  });

  it("no touch: shares expire worthless and the house owes nothing", () => {
    const { shares } = replicate(P, barrierBps, p);
    expect(hedgeValueAt(shares, "no", 0, barrierBps)).toBe(0);
  });

  it("never liquidates below the barrier even if the touch tick reads slightly low", () => {
    const { shares } = replicate(P, barrierBps, p);
    const value = hedgeValueAt(shares, "yes", 0.59, barrierBps); // clamps up to B
    expect(value).toBeCloseTo(P, 9);
  });
});
