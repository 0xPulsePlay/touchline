import { describe, expect, it } from "vitest";
import { noTouchBound, parimutuelPayoutPerUnit, quoteTouch, touchBound, touchDownBound } from "./pricing.js";

describe("touchBound — the p/B martingale bound", () => {
  it("prices the England semifinal example: p=36.1%, B=60% → 60.17%", () => {
    expect(touchBound(0.361, 0.6)).toBeCloseTo(0.6017, 4);
  });
  it("is 1 when already at/above the barrier", () => {
    expect(touchBound(0.6, 0.6)).toBe(1);
    expect(touchBound(0.7, 0.6)).toBe(1);
  });
  it("touching 100% is exactly the win probability (B=1 ⟹ p/B = p)", () => {
    expect(touchBound(0.28, 1)).toBeCloseTo(0.28, 10);
  });
  it("rejects out-of-range inputs", () => {
    expect(() => touchBound(-0.1, 0.5)).toThrow(RangeError);
    expect(() => touchBound(0.5, 0)).toThrow(RangeError);
    expect(() => touchBound(0.5, 1.2)).toThrow(RangeError);
  });
});

describe("complements and symmetry", () => {
  it("no-touch is the complement", () => {
    expect(noTouchBound(0.361, 0.6)).toBeCloseTo(1 - 0.361 / 0.6, 10);
  });
  it("touch-down mirrors via 1−p over 1−b", () => {
    expect(touchDownBound(0.7, 0.4)).toBeCloseTo(0.3 / 0.6, 10);
    expect(touchDownBound(0.3, 0.4)).toBe(1);
  });
});

describe("quoteTouch with empirical discount", () => {
  it("applies the calibration discount to the bound", () => {
    const q = quoteTouch(0.361, 0.6, 0.9);
    expect(q.bound).toBeCloseTo(0.6017, 4);
    expect(q.fair).toBeCloseTo(0.5415, 4);
  });
  it("clamps to [0,1]", () => {
    expect(quoteTouch(0.9, 0.91, 1.5).fair).toBeLessThanOrEqual(1);
  });
});

describe("parimutuel payout", () => {
  it("winners split the whole pool pro-rata", () => {
    expect(parimutuelPayoutPerUnit(50, 100)).toBeCloseTo(3);
    expect(parimutuelPayoutPerUnit(100, 50)).toBeCloseTo(1.5);
  });
  it("zero winning pool pays zero", () => {
    expect(parimutuelPayoutPerUnit(0, 100)).toBe(0);
  });
});
