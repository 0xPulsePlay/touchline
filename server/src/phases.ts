/**
 * Pure phase-timeline derivation: StatusId transitions (already truncated to the observation
 * instant by the caller) → phase windows. No I/O in this module — the SDK-backed adapter
 * (`platform.ts`) supplies inputs at runtime, and this logic is slated to move into
 * `@txline/client-sdk` itself once the SDK session lands it.
 */

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
 *  rare case, which is acceptable — the clock anchors still place ticks correctly.) */
export const NOMINAL_CLOCK_START: Partial<Record<PhaseName, number>> = {
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

/** A score-change moment (participant1, participant2 goals). */
export interface ScorePoint {
  ts: number;
  p1: number;
  p2: number;
}

export interface PhaseTimeline {
  phases: PhaseWindow[];
  clock: ClockSample[];
  /** score-change moments truncated to the observation instant — the UI picks the last ≤ revealTs */
  scoreline?: ScorePoint[];
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
