import { beforeEach, describe, expect, it } from "vitest";
import { _resetForTests, createMarket, poolImpliedYes, poolTotals, resolveMarket, stake } from "./markets.js";

const base = {
  kind: "one_touch" as const,
  fixtureId: 18241006,
  side: "part1" as const,
  barrierPct: 60,
  quoteAtCreate: { p0: 36.1, bound: 0.6017, fair: 0.6 },
};

describe("market lifecycle", () => {
  beforeEach(() => _resetForTests());

  it("creates with a house seed at the fair quote (pool opens 'already correct')", () => {
    const m = createMarket(base);
    const pools = poolTotals(m);
    expect(pools.yes).toBe(60);
    expect(pools.no).toBe(40);
    expect(poolImpliedYes(m)).toBeCloseTo(0.6);
  });

  it("stakes shift the pool-implied probability", () => {
    const m = createMarket(base);
    stake(m.id, { bettor: "mikail", side: "yes", amount: 100 });
    expect(poolImpliedYes(m)).toBeCloseTo(160 / 200);
  });

  it("resolves YES with evidence and pays winners pro-rata from the whole pool", () => {
    const m = createMarket(base);
    stake(m.id, { bettor: "mikail", side: "yes", amount: 40 });
    const r = resolveMarket(m.id, "yes", { messageId: "c", ts: 300, pct: 69.7 });
    expect(r.status).toBe("resolved_yes");
    expect(r.resolution?.payoutPerUnit).toBeCloseTo(140 / 100);
    expect(r.resolution?.evidence?.messageId).toBe("c");
  });

  it("refuses double resolution and stakes on closed markets", () => {
    const m = createMarket(base);
    resolveMarket(m.id, "no");
    expect(() => resolveMarket(m.id, "yes")).toThrow(/already/);
    expect(() => stake(m.id, { bettor: "x", side: "yes", amount: 1 })).toThrow(/resolved/);
  });
});
