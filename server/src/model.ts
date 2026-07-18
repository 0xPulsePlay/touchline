/** Pure domain types shared by the SDK-backed runtime and the SQL-backed research scripts. */

export type Side = "part1" | "draw" | "part2";
export const SIDES: Side[] = ["part1", "draw", "part2"];

export interface FixtureRow {
  fixtureId: number;
  startTime: number;
  competition: string;
  participant1: string;
  participant2: string;
  participant1IsHome: boolean;
  statusId: number | null;
  isFinal: boolean;
  finalP1: number | null;
  finalP2: number | null;
  oddsTickCount: number;
}

/** One point of the 1X2 probability path. Pct values are percentages (e.g. 27.594). */
export interface PathTick {
  ts: number;
  messageId: string;
  part1: number;
  draw: number;
  part2: number;
}

/**
 * Kickoff-anchored opening probability: the last pre-kickoff tick if one exists, else the first
 * tick. (Sequences carry multi-day pre-match tails; StartTime is the anchor, not first-tick ts.)
 */
export function openingProbe(path: PathTick[], startTime: number): PathTick | undefined {
  if (!path.length) return undefined;
  let last: PathTick | undefined;
  for (const t of path) {
    if (t.ts <= startTime) last = t;
    else break;
  }
  return last ?? path[0];
}
