import type { PathTick, Side } from "./model.js";

export interface TouchHit {
  ts: number;
  messageId: string;
  /** the side's Pct at the touching tick (percent, e.g. 69.686) */
  pct: number;
}

/**
 * First tick at/after `fromTs` where the side's probability reaches the barrier (percent).
 * This tick is the market's resolution evidence — its Merkle proof settles YES.
 */
export function firstTouch(path: PathTick[], side: Side, barrierPct: number, fromTs = 0): TouchHit | undefined {
  for (const t of path) {
    if (t.ts < fromTs) continue;
    const v = t[side];
    if (v >= barrierPct) return { ts: t.ts, messageId: t.messageId, pct: v };
  }
  return undefined;
}

/** Running maximum of a side over the path (for drawdown/e.g. calibration displays). */
export function maxPct(path: PathTick[], side: Side, fromTs = 0): number {
  let m = 0;
  for (const t of path) if (t.ts >= fromTs && t[side] > m) m = t[side];
  return m;
}
