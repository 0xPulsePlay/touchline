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

import { positionFor, lotValueAtSettlement, type HedgeLot } from "./hedge.js";

const mkLot = (kind: HedgeLot["kind"], payoutUsdc: number, barrierBps: number, venueP: number, barrier2Bps?: number): HedgeLot => {
  const { shares, cost } = positionFor(kind ?? "up", payoutUsdc, barrierBps, barrier2Bps, venueP);
  return { marketKey: "m", betSig: "s", side: "part1", barrierBps, kind, barrier2Bps,
    stakeUsdc: 0, payoutUsdc, venueP, venue: "test", shares, costUsdc: cost, ts: 0 };
};

describe("kind-aware replication (self-financing + settlement identities)", () => {
  it("heartbreak: cost = fair premium P(p/B)(1−B); touch-at-B-and-lose funds exactly P", () => {
    const P = 10, B = 0.6, p = 0.36;
    const lot = mkLot("heartbreak", P, 6000, p);
    expect(lot.costUsdc).toBeCloseTo(P * (p / B) * (1 - B), 9); // 2.4
    const v = lotValueAtSettlement(lot, "yes", B); // touch exactly at B, then lose
    expect(v).toBeCloseTo(P, 9);
  });

  it("heartbreak touched-but-won (NO): switch nets zero at exact-B touch", () => {
    const lot = mkLot("heartbreak", 10, 6000, 0.36);
    expect(lotValueAtSettlement(lot, "no", 0.6)).toBeCloseTo(0, 9);
    expect(lotValueAtSettlement(lot, "no", 0)).toBe(0); // never touched
  });

  it("comeback: cost = fair premium P·A(1−p)/(1−A); down-touch-at-A-and-win funds exactly P", () => {
    const P = 10, A = 0.15, p = 0.4;
    const lot = mkLot("comeback", P, 1500, p);
    expect(lot.costUsdc).toBeCloseTo(P * (A / (1 - A)) * (1 - p), 9);
    expect(lotValueAtSettlement(lot, "yes", A)).toBeCloseTo(P, 9);
  });

  it("band race: cost = P(p−L)/(U−L); up-exit at U pays exactly P; down-exit at L pays 0", () => {
    const P = 10, U = 7000, L = 3000, p = 0.5;
    const lot = mkLot("band", P, U, p, L);
    expect(lot.costUsdc).toBeCloseTo(P * (p - 0.3) / (0.7 - 0.3), 9); // $5
    expect(lotValueAtSettlement(lot, "yes", 0.7)).toBeCloseTo(P, 9);
    expect(lotValueAtSettlement(lot, "no", 0.3)).toBeCloseTo(0, 9);
  });

  it("band overshoot at the exit is house-favorable", () => {
    const lot = mkLot("band", 10, 7000, 0.5, 3000);
    expect(lotValueAtSettlement(lot, "yes", 0.78)).toBeGreaterThan(10); // jumped past U
  });

  it("down: NO-shares fund the payout at the down-touch", () => {
    const P = 10, L = 0.2, p = 0.6;
    const lot = mkLot("down", P, 2000, p);
    expect(lot.costUsdc).toBeCloseTo((P / (1 - L)) * (1 - p), 9);
    expect(lotValueAtSettlement(lot, "yes", L)).toBeCloseTo(P, 9);
    expect(lotValueAtSettlement(lot, "no", 0)).toBe(0);
  });
});
