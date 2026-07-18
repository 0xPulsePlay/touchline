import { describe, expect, it } from "vitest";
import { dealerQuote, minBarrierBps, MIN_STEP_BPS } from "./dealer.js";

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
