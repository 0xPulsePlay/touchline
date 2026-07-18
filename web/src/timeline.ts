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
  PRE: 0.05, HT: 0.05, ET_WAIT: 0.022, ET_HT: 0.022, PENS_WAIT: 0.022, PENS: 0.06, POST: 0.022,
};
const PRE_WINDOW_MS = 20 * 60_000;

export function buildScale(tl: PhaseTimeline, plotX0: number, plotX1: number, lastTs: number): MatchScale | null {
  if (!tl || tl.phases.length === 0) return null;
  const pw = plotX1 - plotX0;

  // clamp PRE to a fixed pre-kickoff window; drop zero-length windows
  const windows = tl.phases
    .map((w) =>
      w.phase === "PRE" ? { ...w, startTs: Math.max(w.startTs, w.endTs - PRE_WINDOW_MS) } : { ...w },
    )
    .filter((w) => w.endTs > w.startTs || w.phase === "POST");
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
    for (const s of segments) if (ts >= s.startTs && ts < s.endTs) return s;
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
    return s.phase === "PRE" ? "pre-match" : s.phase === "POST" ? "full time" : s.phase.replace("_", " ");
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
