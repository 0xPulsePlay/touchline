import Database from "better-sqlite3";
import { config } from "./config.js";

/**
 * Phase timeline for a fixture, derived from the scores feed: StatusId transitions give the
 * wall-clock windows (H1/HT/H2/ET/pens), Clock samples give the real match clock inside playing
 * windows. This is what lets the UI draw a match-time axis with compressed break bands instead of
 * smearing halftime across wall time — and it generalizes to extra time and shootouts for free.
 */

const db = new Database(config.corpusDb, { readonly: true, fileMustExist: true });

export type PhaseName =
  | "PRE" | "H1" | "HT" | "H2"
  | "ET_WAIT" | "ET1" | "ET_HT" | "ET2"
  | "PENS_WAIT" | "PENS" | "POST";

/** StatusId → the phase that STARTS at that transition. Terminal states start POST. */
const STATUS_TO_PHASE: Record<number, PhaseName> = {
  2: "H1", 3: "HT", 4: "H2", 5: "POST",
  6: "ET_WAIT", 7: "ET1", 8: "ET_HT", 9: "ET2", 10: "POST",
  11: "PENS_WAIT", 12: "PENS", 13: "POST", 100: "POST",
};

export const PLAYING: ReadonlySet<PhaseName> = new Set(["H1", "H2", "ET1", "ET2"]);

/** Nominal match-clock start (seconds) per playing phase — anchors when samples are sparse. */
const NOMINAL_CLOCK_START: Partial<Record<PhaseName, number>> = {
  H1: 0, H2: 45 * 60, ET1: 90 * 60, ET2: 105 * 60,
};

export interface PhaseWindow {
  phase: PhaseName;
  startTs: number;
  endTs: number;
  /** match-clock bounds in seconds for playing phases (start nominal, end = last observed) */
  clockStartS: number | null;
  clockEndS: number | null;
}

export interface ClockSample {
  ts: number;
  /** match clock in seconds */
  s: number;
}

export interface PhaseTimeline {
  phases: PhaseWindow[];
  /** thinned running-clock samples across all playing phases, ascending ts */
  clock: ClockSample[];
}

const statusStmt = db.prepare(`
  SELECT ts, status_id FROM score_updates
  WHERE fixture_id = ? AND action = 'status' AND status_id IS NOT NULL
  ORDER BY seq ASC
`);

const rawStmt = db.prepare(`
  SELECT ts, raw FROM score_updates
  WHERE fixture_id = ? AND ts >= ? AND ts <= ?
  ORDER BY ts ASC
`);

/** Extract thinned Clock samples (one per ≥`thinMs`) from raw score updates in a window. */
function clockSamples(fixtureId: number, fromTs: number, toTs: number, thinMs = 20_000): ClockSample[] {
  const rows = rawStmt.all(fixtureId, fromTs, toTs) as { ts: number; raw: string }[];
  const out: ClockSample[] = [];
  let lastKept = -Infinity;
  for (const r of rows) {
    if (r.ts - lastKept < thinMs) continue;
    try {
      const u = JSON.parse(r.raw) as { Clock?: { Running?: boolean; Seconds?: number } };
      const c = u.Clock;
      if (c && typeof c.Seconds === "number" && c.Running) {
        out.push({ ts: r.ts, s: c.Seconds });
        lastKept = r.ts;
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

export function phaseTimeline(fixtureId: number, pathEndTs: number): PhaseTimeline {
  const transitions = (statusStmt.all(fixtureId) as { ts: number; status_id: number }[])
    .map((t) => ({ ts: t.ts, phase: STATUS_TO_PHASE[t.status_id] }))
    .filter((t): t is { ts: number; phase: PhaseName } => t.phase !== undefined);

  if (!transitions.length) return { phases: [], clock: [] };

  // collapse consecutive duplicates (repeated status messages)
  const seq: { ts: number; phase: PhaseName }[] = [];
  for (const t of transitions) {
    if (!seq.length || seq[seq.length - 1]!.phase !== t.phase) seq.push(t);
  }

  const phases: PhaseWindow[] = [];
  const kickoff = seq[0]!.ts;
  phases.push({ phase: "PRE", startTs: 0, endTs: kickoff, clockStartS: null, clockEndS: null });
  for (let i = 0; i < seq.length; i++) {
    const cur = seq[i]!;
    const endTs = i + 1 < seq.length ? seq[i + 1]!.ts : Math.max(pathEndTs, cur.ts);
    if (cur.phase === "POST") {
      phases.push({ phase: "POST", startTs: cur.ts, endTs, clockStartS: null, clockEndS: null });
      break; // terminal — ignore any later status noise
    }
    phases.push({
      phase: cur.phase,
      startTs: cur.ts,
      endTs,
      clockStartS: PLAYING.has(cur.phase) ? (NOMINAL_CLOCK_START[cur.phase] ?? null) : null,
      clockEndS: null,
    });
  }
  // ensure a trailing POST band so late odds ticks always have a home
  if (phases[phases.length - 1]!.phase !== "POST") {
    const last = phases[phases.length - 1]!;
    phases.push({ phase: "POST", startTs: last.endTs, endTs: Math.max(pathEndTs, last.endTs), clockStartS: null, clockEndS: null });
  }

  // clock samples per playing window; set clockEndS from the last observed sample
  const clock: ClockSample[] = [];
  for (const w of phases) {
    if (!PLAYING.has(w.phase)) continue;
    const samples = clockSamples(fixtureId, w.startTs, w.endTs);
    if (samples.length) {
      w.clockEndS = samples[samples.length - 1]!.s;
      if (w.clockStartS == null) w.clockStartS = samples[0]!.s;
      clock.push(...samples);
    } else {
      // no clock coverage: fall back to nominal duration from wall time
      const nominal = NOMINAL_CLOCK_START[w.phase] ?? 0;
      w.clockStartS = nominal;
      w.clockEndS = nominal + Math.round((w.endTs - w.startTs) / 1000);
    }
  }

  return { phases, clock };
}
