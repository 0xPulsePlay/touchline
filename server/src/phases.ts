import Database from "better-sqlite3";
import { config } from "./config.js";

/**
 * Phase timeline for a fixture, derived from the scores feed: StatusId transitions give the
 * wall-clock windows (H1/HT/H2/ET/pens/suspensions), Clock samples give the real match clock
 * inside playing windows.
 *
 * LIVE SEMANTICS: `asOf` truncates every INPUT (transitions, clock samples, end anchor) before
 * derivation — the result is exactly what a live consumer would have known at that instant. The
 * derivation itself is pure (`windowsFromTransitions`), so when the client SDK's timeline
 * function lands, it swaps into the same seam: truncate inputs → derive.
 */

const db = new Database(config.corpusDb, { readonly: true, fileMustExist: true });

export type PhaseName =
  | "PRE" | "H1" | "HT" | "H2"
  | "ET_WAIT" | "ET1" | "ET_HT" | "ET2"
  | "PENS_WAIT" | "PENS" | "SUSP" | "POST";

/**
 * StatusId → the phase that STARTS at that transition. Terminal states start POST.
 * 14 Interrupted / 18 CoverageSuspended → a SUSP band that ends when play resumes.
 * 15 Abandoned / 16 Cancelled / 17 TxCancelled / 19 Postponed → terminal for our axis.
 */
const STATUS_TO_PHASE: Record<number, PhaseName> = {
  2: "H1", 3: "HT", 4: "H2", 5: "POST",
  6: "ET_WAIT", 7: "ET1", 8: "ET_HT", 9: "ET2", 10: "POST",
  11: "PENS_WAIT", 12: "PENS", 13: "POST", 100: "POST",
  14: "SUSP", 18: "SUSP", 15: "POST", 16: "POST", 17: "POST", 19: "POST",
};

export const PLAYING: ReadonlySet<PhaseName> = new Set(["H1", "H2", "ET1", "ET2"]);

/** Nominal match-clock start (seconds) per playing phase — anchors when samples are sparse.
 *  (A phase resumed after a SUSP band reuses its nominal start; widths skew slightly in that
 *  rare case, which is acceptable — the clock samples still place ticks correctly.) */
const NOMINAL_CLOCK_START: Partial<Record<PhaseName, number>> = {
  H1: 0, H2: 45 * 60, ET1: 90 * 60, ET2: 105 * 60,
};

export interface PhaseWindow {
  phase: PhaseName;
  startTs: number;
  endTs: number;
  clockStartS: number | null;
  clockEndS: number | null;
}

export interface ClockSample {
  ts: number;
  s: number;
}

export interface PhaseTimeline {
  phases: PhaseWindow[];
  clock: ClockSample[];
}

export interface StatusTransition {
  ts: number;
  statusId: number;
}

/** Pure derivation: transitions (already truncated to the observation instant) → windows. */
export function windowsFromTransitions(
  transitions: StatusTransition[],
  pathEndTs: number,
  startTimeHint?: number,
): PhaseWindow[] {
  const mapped = transitions
    .map((t) => ({ ts: t.ts, phase: STATUS_TO_PHASE[t.statusId] }))
    .filter((t): t is { ts: number; phase: PhaseName } => t.phase !== undefined);

  if (!mapped.length) {
    // pre-kickoff: a single PRE window so live consumers get a real (if quiet) axis
    if (startTimeHint === undefined) return [];
    return [{ phase: "PRE", startTs: 0, endTs: Math.max(startTimeHint, pathEndTs), clockStartS: null, clockEndS: null }];
  }

  const seq: { ts: number; phase: PhaseName }[] = [];
  for (const t of mapped) {
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
      break;
    }
    phases.push({
      phase: cur.phase,
      startTs: cur.ts,
      endTs,
      clockStartS: PLAYING.has(cur.phase) ? (NOMINAL_CLOCK_START[cur.phase] ?? null) : null,
      clockEndS: null,
    });
  }
  if (phases[phases.length - 1]!.phase !== "POST") {
    const last = phases[phases.length - 1]!;
    phases.push({ phase: "POST", startTs: last.endTs, endTs: Math.max(pathEndTs, last.endTs), clockStartS: null, clockEndS: null });
  }
  return phases;
}

const statusStmt = db.prepare(`
  SELECT ts, status_id AS statusId FROM score_updates
  WHERE fixture_id = ? AND action = 'status' AND status_id IS NOT NULL AND ts <= ?
  ORDER BY seq ASC
`);

const rawStmt = db.prepare(`
  SELECT ts, raw FROM score_updates
  WHERE fixture_id = ? AND ts >= ? AND ts <= ?
  ORDER BY ts ASC
`);

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

/**
 * Timeline as known at `asOf` (default: now/complete). All inputs are truncated to asOf before
 * the pure derivation — a live consumer at that instant could not know more.
 */
export function phaseTimeline(
  fixtureId: number,
  pathEndTs: number,
  opts: { asOf?: number; startTimeHint?: number } = {},
): PhaseTimeline {
  const asOf = opts.asOf ?? Number.MAX_SAFE_INTEGER;
  const endAnchor = Math.min(pathEndTs, asOf);
  const transitions = statusStmt.all(fixtureId, asOf) as StatusTransition[];
  const phases = windowsFromTransitions(transitions, endAnchor, opts.startTimeHint);

  const clock: ClockSample[] = [];
  for (const w of phases) {
    if (!PLAYING.has(w.phase)) continue;
    const samples = clockSamples(fixtureId, w.startTs, Math.min(w.endTs, asOf));
    if (samples.length) {
      w.clockEndS = samples[samples.length - 1]!.s;
      if (w.clockStartS == null) w.clockStartS = samples[0]!.s;
      clock.push(...samples);
    } else {
      const nominal = NOMINAL_CLOCK_START[w.phase] ?? 0;
      w.clockStartS = nominal;
      w.clockEndS = nominal + Math.round((Math.min(w.endTs, asOf) - w.startTs) / 1000);
    }
  }
  return { phases, clock };
}
