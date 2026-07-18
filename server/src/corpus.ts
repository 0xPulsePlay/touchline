import Database from "better-sqlite3";
import { config } from "./config.js";

/**
 * Read-only access to the txline-explorer engine corpus. The DB is in WAL mode with a standing
 * ingestion worker writing to it — readonly connections are safe alongside it.
 */
const db = new Database(config.corpusDb, { readonly: true, fileMustExist: true });

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

const fixturesStmt = db.prepare(`
  SELECT fixture_id, start_time, competition, participant1, participant2,
         participant1_is_home, status_id, is_final, final_p1, final_p2, odds_tick_count
  FROM fixtures
  WHERE odds_tick_count > 0
  ORDER BY start_time ASC
`);

export function listFixtures(): FixtureRow[] {
  return (fixturesStmt.all() as Record<string, unknown>[]).map((r) => ({
    fixtureId: r.fixture_id as number,
    startTime: r.start_time as number,
    competition: r.competition as string,
    participant1: r.participant1 as string,
    participant2: r.participant2 as string,
    participant1IsHome: !!r.participant1_is_home,
    statusId: r.status_id as number | null,
    isFinal: !!r.is_final,
    finalP1: r.final_p1 as number | null,
    finalP2: r.final_p2 as number | null,
    oddsTickCount: r.odds_tick_count as number,
  }));
}

export function getFixture(fixtureId: number): FixtureRow | undefined {
  return listFixtures().find((f) => f.fixtureId === fixtureId);
}

/** One point of the 1X2 probability path. Pct values are percentages (e.g. 27.594). */
export interface PathTick {
  ts: number;
  messageId: string;
  part1: number;
  draw: number;
  part2: number;
}

const ticksStmt = db.prepare(`
  SELECT message_id, ts, price_names, pct
  FROM odds_ticks
  WHERE fixture_id = ? AND super_odds_type = '1X2_PARTICIPANT_RESULT'
    AND (market_period IS NULL OR market_period = '')
  ORDER BY ts ASC
`);

/**
 * Full-precision 1X2 path for a fixture, decoded from raw ticks. `PriceNames` is authoritative for
 * column order; ticks with "NA"/missing Pct are skipped.
 */
export function fullPath(fixtureId: number): PathTick[] {
  const rows = ticksStmt.all(fixtureId) as { message_id: string; ts: number; price_names: string; pct: string }[];
  const out: PathTick[] = [];
  for (const r of rows) {
    try {
      const names = JSON.parse(r.price_names) as string[];
      const pct = (JSON.parse(r.pct) as (string | number)[]).map(Number);
      const i1 = names.indexOf("part1"), ix = names.indexOf("draw"), i2 = names.indexOf("part2");
      if (i1 < 0 || ix < 0 || i2 < 0) continue;
      const p1 = pct[i1], dr = pct[ix], p2 = pct[i2];
      if (![p1, dr, p2].every((v) => Number.isFinite(v))) continue;
      out.push({ ts: r.ts, messageId: r.message_id, part1: p1!, draw: dr!, part2: p2! });
    } catch {
      /* skip undecodable tick */
    }
  }
  return out;
}

/** The raw tick record needed to request an odds proof (full PascalCase payload). */
const rawTickStmt = db.prepare(`SELECT raw FROM odds_ticks WHERE message_id = ?`);
export function rawTick(messageId: string): Record<string, unknown> | undefined {
  const row = rawTickStmt.get(messageId) as { raw: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
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

/** Minute-bucket rows for the calibration study — cheap SQL over the pre-downsampled series. */
export interface SeriesRow {
  fixtureId: number;
  priceName: Side;
  minuteBucket: number;
  pctHigh: number | null;
  pctClose: number | null;
}

const seriesStmt = db.prepare(`
  SELECT fixture_id, price_name, minute_bucket, pct_high, pct_close
  FROM odds_series
  WHERE super_odds_type = '1X2_PARTICIPANT_RESULT'
    AND (market_period IS NULL OR market_period = '')
    AND price_name IN ('part1','draw','part2')
  ORDER BY fixture_id, price_name, minute_bucket
`);

export function allSeries(): SeriesRow[] {
  return (seriesStmt.all() as Record<string, unknown>[]).map((r) => ({
    fixtureId: r.fixture_id as number,
    priceName: r.price_name as Side,
    minuteBucket: r.minute_bucket as number,
    pctHigh: r.pct_high as number | null,
    pctClose: r.pct_close as number | null,
  }));
}
