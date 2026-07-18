import type { PhaseTimeline, PhaseWindow } from "./api.js";

/**
 * Piecewise x-scale over a match: playing phases are drawn in MATCH-CLOCK time (widths
 * proportional to real clock duration), breaks (HT/ET waits/shootout) are compressed fixed-width
 * bands — probability keeps ticking inside them, they just stop stealing axis space.
 */

export interface Segment extends PhaseWindow {
  x0: number;
  x1: number;
  playing: boolean;
  /** true = not yet reached (live/sim projection) — rendered dimmed, keeps the axis stable */
  projected?: boolean;
}

export interface MatchScale {
  segments: Segment[];
  xOf: (ts: number) => number;
  /** "54′ H2" during play, "HT" / "PENS" inside bands */
  labelOf: (ts: number) => string;
  /** minute gridlines: {x, label} at 15-clock-minute marks inside playing segments */
  minuteTicks: { x: number; label: string }[];
}

const PLAYING = new Set(["H1", "H2", "ET1", "ET2"]);
/** nominal end of each playing phase in clock seconds — beyond it is stoppage ("45+2") */
export const NOMINAL_END: Record<string, number> = {
  H1: 45 * 60, H2: 90 * 60, ET1: 105 * 60, ET2: 120 * 60,
};

/** football-style minute label: 47:10 in H1 → "45+3′" */
export function footballMinute(phase: string, clockS: number): string {
  const nominal = NOMINAL_END[phase];
  const m = Math.floor(clockS / 60);
  if (nominal !== undefined && clockS > nominal) {
    return `${nominal / 60}+${Math.ceil((clockS - nominal) / 60)}′`;
  }
  return `${m}′`;
}
/** compressed band widths as fractions of plot width */
const BAND_FRACTION: Record<string, number> = {
  PRE: 0.05, HT: 0.05, ET_WAIT: 0.022, ET_HT: 0.022, PENS_WAIT: 0.022, PENS: 0.06, SUSP: 0.03, POST: 0.022,
};
const PRE_WINDOW_MS = 20 * 60_000;

/** est. stoppage appended to a nominal half when projecting (seconds) */
const STOPPAGE_EST_S = 4 * 60;
const NOMINAL_LEN_S: Record<string, number> = { H1: 45 * 60, H2: 45 * 60, ET1: 15 * 60, ET2: 15 * 60 };

/**
 * Live/sim projection: extend the KNOWN windows with the expected remainder of the match so the
 * axis is stable from kickoff — the leading edge fills INTO a fixed layout instead of
 * re-compressing it every poll. Projections cover only the current regulation/ET block; ET and
 * pens appear as single axis-extension moments when their transitions actually arrive.
 */
function projectWindows(known: PhaseWindow[], asOfTs: number): (PhaseWindow & { projected?: boolean })[] {
  const out: (PhaseWindow & { projected?: boolean })[] = known.map((w) => ({ ...w }));
  const last = [...out].reverse().find((w) => w.phase !== "POST");
  if (!last) return out;
  const proj: (PhaseWindow & { projected?: boolean })[] = [];
  const mk = (phase: PhaseWindow["phase"], clockStartS: number | null, lenS: number | null): void => {
    const startTs = (proj[proj.length - 1] ?? { endTs: last.endTs }).endTs;
    // wall duration of projected playing phases ≈ clock length; breaks get fixed bands anyway
    const endTs = startTs + (lenS ?? 15 * 60) * 1000;
    proj.push({ phase, startTs, endTs, clockStartS, clockEndS: clockStartS != null && lenS != null ? clockStartS + lenS : null, projected: true });
  };
  const stillToCome = (p: string) => !out.some((w) => w.phase === p);

  if (PLAYING.has(last.phase)) {
    // extend the CURRENT phase to its nominal + stoppage estimate (never shrink below observed)
    const nominalEnd = (NOMINAL_CLOCK_START_LOOKUP[last.phase] ?? 0) + (NOMINAL_LEN_S[last.phase] ?? 45 * 60) + STOPPAGE_EST_S;
    const observed = last.clockEndS ?? NOMINAL_CLOCK_START_LOOKUP[last.phase] ?? 0;
    if (observed < nominalEnd) {
      last.endTs = Math.max(last.endTs, asOfTs + (nominalEnd - observed) * 1000);
      last.clockEndS = nominalEnd;
    }
  }
  if (last.phase === "PRE") {
    mk("H1", 0, 45 * 60 + STOPPAGE_EST_S);
    mk("HT", null, null);
    mk("H2", 45 * 60, 45 * 60 + STOPPAGE_EST_S);
  } else if (last.phase === "H1") {
    if (stillToCome("HT")) mk("HT", null, null);
    if (stillToCome("H2")) mk("H2", 45 * 60, 45 * 60 + STOPPAGE_EST_S);
  } else if (last.phase === "HT") {
    if (stillToCome("H2")) mk("H2", 45 * 60, 45 * 60 + STOPPAGE_EST_S);
  } else if (last.phase === "ET_WAIT" || last.phase === "ET1") {
    if (stillToCome("ET1") && last.phase === "ET_WAIT") mk("ET1", 90 * 60, 15 * 60 + 2 * 60);
    if (stillToCome("ET_HT")) mk("ET_HT", null, null);
    if (stillToCome("ET2")) mk("ET2", 105 * 60, 15 * 60 + 2 * 60);
  } else if (last.phase === "ET_HT") {
    if (stillToCome("ET2")) mk("ET2", 105 * 60, 15 * 60 + 2 * 60);
  }
  return [...out, ...proj];
}

const NOMINAL_CLOCK_START_LOOKUP: Record<string, number> = { H1: 0, H2: 45 * 60, ET1: 90 * 60, ET2: 105 * 60 };

export function buildScale(
  tl: PhaseTimeline,
  plotX0: number,
  plotX1: number,
  lastTs: number,
  opts: { project?: boolean } = {},
): MatchScale | null {
  if (!tl || tl.phases.length === 0) return null;
  const pw = plotX1 - plotX0;

  // clamp PRE to a fixed pre-kickoff window; drop zero-length windows
  let baseWindows: (PhaseWindow & { projected?: boolean })[] = tl.phases
    .map((w) =>
      w.phase === "PRE" ? { ...w, startTs: Math.max(w.startTs, w.endTs - PRE_WINDOW_MS) } : { ...w },
    )
    .filter((w) => w.endTs > w.startTs || w.phase === "POST");
  if (opts.project) {
    baseWindows = projectWindows(baseWindows.filter((w) => w.phase !== "POST" || w.endTs > w.startTs), lastTs);
  }
  const windows = baseWindows;
  if (windows.length && windows[windows.length - 1]!.phase === "POST") {
    const post = windows[windows.length - 1]!;
    post.endTs = Math.max(post.endTs, lastTs, post.startTs + 1);
  }

  const playingDur = windows
    .filter((w) => PLAYING.has(w.phase))
    .reduce((a, w) => a + Math.max(60, (w.clockEndS ?? 0) - (w.clockStartS ?? 0)), 0);
  const bandTotal = windows.reduce((a, w) => a + (PLAYING.has(w.phase) ? 0 : (BAND_FRACTION[w.phase] ?? 0.03)), 0);
  const playWidth = pw * Math.max(0.2, 1 - bandTotal);

  const segments: Segment[] = [];
  let x = plotX0;
  for (const w of windows) {
    const playing = PLAYING.has(w.phase);
    const width = playing
      ? (Math.max(60, (w.clockEndS ?? 0) - (w.clockStartS ?? 0)) / Math.max(1, playingDur)) * playWidth
      : (BAND_FRACTION[w.phase] ?? 0.03) * pw;
    segments.push({ ...w, x0: x, x1: x + width, playing });
    x += width;
  }
  // normalize to exactly fill the plot
  const scaleFix = pw / (x - plotX0);
  let acc = plotX0;
  for (const s of segments) {
    const width = (s.x1 - s.x0) * scaleFix;
    s.x0 = acc;
    s.x1 = acc + width;
    acc += width;
  }

  const clock = tl.clock;
  /** interpolated match-clock seconds at ts within a playing segment */
  const clockAt = (seg: Segment, ts: number): number => {
    const lo = seg.clockStartS ?? 0, hi = seg.clockEndS ?? lo + 1;
    const inSeg = clock.filter((c) => c.ts >= seg.startTs && c.ts <= seg.endTs);
    if (!inSeg.length) {
      const f = (ts - seg.startTs) / Math.max(1, seg.endTs - seg.startTs);
      return lo + f * (hi - lo);
    }
    let prev = inSeg[0]!, next = inSeg[inSeg.length - 1]!;
    for (const c of inSeg) {
      if (c.ts <= ts) prev = c;
      if (c.ts >= ts) { next = c; break; }
    }
    if (next.ts === prev.ts) return Math.min(hi, Math.max(lo, prev.s));
    const f = (ts - prev.ts) / (next.ts - prev.ts);
    const s = prev.s + Math.max(0, Math.min(1, f)) * (next.s - prev.s);
    return Math.min(hi, Math.max(lo, s));
  };

  const segFor = (ts: number): Segment => {
    if (ts <= segments[0]!.startTs) return segments[0]!;
    // inclusive end-bound: the live leading-edge tick (ts == activePhase.endTs) must resolve to
    // the active phase, not the zero-width trailing POST that starts at the same instant
    for (const s of segments) if (ts >= s.startTs && ts <= s.endTs && s.endTs > s.startTs) return s;
    return segments[segments.length - 1]!;
  };

  const xOf = (ts: number): number => {
    const s = segFor(ts);
    if (s.playing) {
      const lo = s.clockStartS ?? 0, hi = s.clockEndS ?? lo + 1;
      const f = (clockAt(s, ts) - lo) / Math.max(1, hi - lo);
      return s.x0 + f * (s.x1 - s.x0);
    }
    const f = (Math.min(ts, s.endTs) - s.startTs) / Math.max(1, s.endTs - s.startTs);
    return s.x0 + Math.max(0, Math.min(1, f)) * (s.x1 - s.x0);
  };

  const labelOf = (ts: number): string => {
    const s = segFor(ts);
    if (s.playing) return `${footballMinute(s.phase, clockAt(s, ts))} ${s.phase}`;
    if (s.phase === "PRE") return "pre-match";
    if (s.phase === "POST") return "full time";
    if (s.phase === "SUSP") return "suspended";
    return s.phase.replace("_", " ");
  };

  const minuteTicks: { x: number; label: string }[] = [];
  for (const s of segments) {
    if (!s.playing) continue;
    const lo = s.clockStartS ?? 0, hi = s.clockEndS ?? lo;
    for (let m = Math.ceil(lo / 900) * 15; m * 60 <= hi; m += 15) {
      if (m === 0) continue; // kickoff already carries the KO marker
      if (m * 60 === lo && lo !== 0) continue; // phase start duplicates the previous phase's end tick
      const f = (m * 60 - lo) / Math.max(1, hi - lo);
      minuteTicks.push({ x: s.x0 + f * (s.x1 - s.x0), label: `${m}′` });
    }
  }

  return { segments, xOf, labelOf, minuteTicks };
}
