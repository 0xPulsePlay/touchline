import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allSeries, listFixtures, SIDES, type Side } from "./corpus.js";
import { config } from "./config.js";
import { touchBound } from "./pricing.js";

/**
 * Empirical touch calibration — the study only this corpus can produce.
 *
 * For every finished fixture × outcome side: p0 = the side's probability at kickoff (last
 * minute-bucket close before StartTime), then whether the path's later maximum reached each
 * barrier B on a grid. Aggregated per barrier: observed touch rate vs the mean martingale bound
 * p0/B. The ratio observed/bound is the measured "jump discount" — the number the theorem section
 * of the README promises.
 *
 * Data source: odds_series (per-minute OHLC of Pct) — pct_high per minute makes max-detection
 * exact at minute resolution without touching 5.5M raw ticks.
 */

export const BARRIERS = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90] as const;

export interface PathSample {
  fixtureId: number;
  side: Side;
  label: string;
  p0: number;
  maxAfter: number;
  won: boolean;
}

export interface BarrierBucket {
  barrier: number;
  n: number;
  touched: number;
  observedRate: number;
  meanBound: number;
  /** observed / bound — < 1 means jumps make touches rarer than the continuous-martingale price */
  discount: number | null;
}

export interface Calibration {
  generatedAt: number;
  fixtures: number;
  samples: PathSample[];
  buckets: BarrierBucket[];
}

export function computeCalibration(): Calibration {
  const fixtures = listFixtures().filter((f) => f.isFinal);
  const byFixture = new Map<number, ReturnType<typeof allSeries>>();
  for (const row of allSeries()) {
    let arr = byFixture.get(row.fixtureId);
    if (!arr) byFixture.set(row.fixtureId, (arr = []));
    arr.push(row);
  }

  const samples: PathSample[] = [];
  for (const f of fixtures) {
    const rows = byFixture.get(f.fixtureId);
    if (!rows) continue;
    const koMinute = Math.floor(f.startTime / 60000);
    for (const side of SIDES) {
      const mine = rows.filter((r) => r.priceName === side);
      if (mine.length < 10) continue;
      // p0: last close at/before kickoff, else earliest close
      let p0: number | null = null;
      for (const r of mine) {
        if (r.minuteBucket <= koMinute && r.pctClose != null) p0 = r.pctClose;
        if (r.minuteBucket > koMinute) break;
      }
      if (p0 == null) p0 = mine.find((r) => r.pctClose != null)?.pctClose ?? null;
      if (p0 == null) continue;
      let maxAfter = 0;
      for (const r of mine) {
        if (r.minuteBucket >= koMinute && r.pctHigh != null && r.pctHigh > maxAfter) maxAfter = r.pctHigh;
      }
      if (maxAfter === 0) continue;
      const won =
        side === "part1" ? (f.finalP1 ?? 0) > (f.finalP2 ?? 0)
        : side === "part2" ? (f.finalP2 ?? 0) > (f.finalP1 ?? 0)
        : (f.finalP1 ?? 0) === (f.finalP2 ?? 0);
      const label =
        side === "part1" ? f.participant1 : side === "part2" ? f.participant2 : "Draw";
      samples.push({ fixtureId: f.fixtureId, side, label, p0, maxAfter, won });
    }
  }

  const buckets: BarrierBucket[] = BARRIERS.map((barrier) => {
    // condition on p0 strictly below the barrier — touching from above is trivial
    const eligible = samples.filter((s) => s.p0 < barrier);
    const touched = eligible.filter((s) => s.maxAfter >= barrier).length;
    const meanBound =
      eligible.length > 0
        ? eligible.reduce((a, s) => a + touchBound(s.p0 / 100, barrier / 100), 0) / eligible.length
        : 0;
    const observedRate = eligible.length > 0 ? touched / eligible.length : 0;
    return {
      barrier,
      n: eligible.length,
      touched,
      observedRate,
      meanBound,
      discount: meanBound > 0 ? observedRate / meanBound : null,
    };
  });

  return { generatedAt: Date.now(), fixtures: fixtures.length, samples, buckets };
}

const FILE = "calibration.json";

export function loadOrComputeCalibration(maxAgeMs = 6 * 3600_000): Calibration {
  try {
    const cached = JSON.parse(readFileSync(join(config.dataDir, FILE), "utf8")) as Calibration;
    if (Date.now() - cached.generatedAt < maxAgeMs) return cached;
  } catch {
    /* compute below */
  }
  const fresh = computeCalibration();
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(join(config.dataDir, FILE), JSON.stringify(fresh), "utf8");
  return fresh;
}

/** Corpus-wide discount for pricing: the touch-rate/bound ratio pooled across mid barriers. */
export function pricingDiscount(cal: Calibration): number {
  const mid = cal.buckets.filter((b) => b.barrier >= 50 && b.barrier <= 80 && b.n >= 20 && b.discount != null);
  if (!mid.length) return 1;
  const d = mid.reduce((a, b) => a + (b.discount as number), 0) / mid.length;
  return Math.max(0.5, Math.min(1.1, d));
}
