import { describe, expect, it } from "vitest";
import { dealerQuote, dealerQuoteKind, minBarrierBps, MIN_STEP_BPS } from "./dealer.js";

describe("barrier gating", () => {
  it("min barrier is current prob + step", () => {
    expect(minBarrierBps(3541)).toBe(3541 + MIN_STEP_BPS);
  });
  it("rejects a barrier at or below current probability", () => {
    const q = dealerQuote("part1", 3541, 3500, 0.87);
    expect(q.valid).toBe(false);
    expect(q.reason).toMatch(/barrier must be/);
  });
  it("rejects a barrier just under the min step", () => {
    expect(dealerQuote("part1", 3541, 3600, 0.87).valid).toBe(false); // 3600 < 3641
    expect(dealerQuote("part1", 3541, 3650, 0.87).valid).toBe(true);
  });
});

describe("dealer pricing", () => {
  it("prices the England-touches-60% example near the fair 51% with a small house spread", () => {
    const q = dealerQuote("part1", 3541, 6000, 0.87, 0.03);
    expect(q.valid).toBe(true);
    // bound = 35.41/60 = 59.0%; ×0.87 = 51.3%; ×1.03 spread ≈ 52.9%
    expect(q.boundBps).toBeGreaterThan(5800);
    expect(q.priceBps).toBeGreaterThan(5100);
    expect(q.priceBps).toBeLessThan(5500);
    expect(q.payoutMult).toBeGreaterThan(1.8);
  });
  it("higher barrier → lower price → bigger payout multiple", () => {
    const near = dealerQuote("part1", 3541, 4000, 0.87);
    const far = dealerQuote("part1", 3541, 9000, 0.87);
    expect(far.priceBps).toBeLessThan(near.priceBps);
    expect(far.payoutMult).toBeGreaterThan(near.payoutMult);
  });
});

describe("dealerQuoteKind — DOWN and BAND", () => {
  const δ = 0.87;

  it("DOWN mirrors UP: bound is (1−p)/(1−L)", () => {
    const q = dealerQuoteKind("down", "part1", 6000, 2000, δ); // p=60%, L=20%
    // (1−0.6)/(1−0.2) = 0.5
    expect(q.valid).toBe(true);
    expect(q.boundBps).toBe(5000);
    expect(q.priceBps).toBe(Math.round(0.5 * δ * 1.03 * 10000));
  });

  it("DOWN gates the barrier BELOW current p − step", () => {
    const q = dealerQuoteKind("down", "part1", 3000, 2950, δ); // too close to p
    expect(q.valid).toBe(false);
    expect(q.maxDownBps).toBe(2900);
  });

  it("DOWN symmetric identity: down quote at (p,L) == up quote at (1−p, 1−L) bound", () => {
    const down = dealerQuoteKind("down", "part1", 7000, 4000, δ);
    const up = dealerQuoteKind("up", "part1", 3000, 6000, δ);
    expect(down.boundBps).toBe(up.boundBps); // both 0.3/0.6 = 50%
  });

  it("BAND is the gambler's-ruin race: (p−L)/(U−L), exact, spread only", () => {
    const q = dealerQuoteKind("band", "part1", 5000, 7000, δ, { barrier2Bps: 3000 });
    expect(q.valid).toBe(true);
    // (0.50−0.30)/(0.70−0.30) = 0.5 → ×1.03 spread
    expect(q.priceBps).toBe(Math.round(0.5 * 1.03 * 10000));
    expect(q.discount).toBe(1); // no empirical discount on an exact closed form
  });

  it("BAND race is symmetric: p halfway between edges prices at ~50%", () => {
    const q = dealerQuoteKind("band", "part1", 4000, 6000, δ, { barrier2Bps: 2000 });
    expect(q.priceBps).toBe(Math.round(0.5 * 1.03 * 10000));
  });

  it("BAND rejects a lower edge above p − step", () => {
    const q = dealerQuoteKind("band", "part1", 5000, 7000, δ, { barrier2Bps: 4990 });
    expect(q.valid).toBe(false);
  });

  it("UP kind delegates to the classic quote", () => {
    const a = dealerQuoteKind("up", "part1", 3540, 6000, δ);
    const b = dealerQuote("part1", 3540, 6000, δ);
    expect(a.priceBps).toBe(b.priceBps);
    expect(a.kind).toBe("up");
  });
});

describe("dealerQuoteKind — HEARTBREAK and COMEBACK", () => {
  const δ = 0.87;

  it("heartbreak = (p/B)(1−B)·δ — the launch example: p=36%, B=60%", () => {
    const q = dealerQuoteKind("heartbreak", "part1", 3600, 6000, δ);
    expect(q.valid).toBe(true);
    // (0.36/0.60)·(0.40) = 0.24 before discount
    const expected = Math.round(Math.max(0.01, Math.min(0.99, 0.24 * δ * 1.03)) * 10000);
    expect(q.priceBps).toBe(expected);
  });

  it("heartbreak inherits the UP gate (B above p + step)", () => {
    const q = dealerQuoteKind("heartbreak", "part1", 3600, 3650, δ);
    expect(q.valid).toBe(false);
  });

  it("comeback = A·(1−p)/(1−A)·δ — drops to 15% then wins from p=40%", () => {
    const q = dealerQuoteKind("comeback", "part1", 4000, 1500, δ);
    expect(q.valid).toBe(true);
    // 0.15·(0.60/0.85) ≈ 0.10588
    const fair = 0.15 * (0.6 / 0.85);
    const expected = Math.round(Math.max(0.01, Math.min(0.99, fair * δ * 1.03)) * 10000);
    expect(q.priceBps).toBe(expected);
  });

  it("comeback inherits the DOWN gate (A below p − step)", () => {
    const q = dealerQuoteKind("comeback", "part1", 4000, 3950, δ);
    expect(q.valid).toBe(false);
  });

  it("heartbreak is always cheaper than the plain up-touch (extra losing condition)", () => {
    const hb = dealerQuoteKind("heartbreak", "part1", 3600, 6000, δ);
    const up = dealerQuoteKind("up", "part1", 3600, 6000, δ);
    expect(hb.priceBps).toBeLessThan(up.priceBps);
  });
});
