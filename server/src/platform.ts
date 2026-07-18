import { TxlinePlatformClient } from "@txline/client-sdk";
import { config } from "./config.js";
import { openingProbe, type FixtureRow, type PathTick } from "./model.js";
import {
  windowsFromTransitions,
  PLAYING,
  NOMINAL_CLOCK_START,
  type ClockSample,
  type PhaseTimeline,
  type ScorePoint,
  type StatusTransition,
} from "./phases.js";

/**
 * SDK-backed data layer (options a+b, folded in): every product-path read goes through
 * `@txline/client-sdk` against the running platform API — no direct corpus access.
 * The `asOf` seam is preserved: inputs are truncated to the observation instant either by the
 * platform itself (odds) or here before derivation (timeline), so live/sim consumers never see
 * the future. The SQL-backed `corpus.ts` remains only for the offline calibration study.
 */
const client = new TxlinePlatformClient({ baseUrl: config.platformUrl });

export async function listFixtures(): Promise<FixtureRow[]> {
  const res = await client.fixtures({ limit: 500 });
  return res.fixtures
    .filter((f) => f.oddsTickCount > 0 && f.startTime != null && f.participant1 != null && f.participant2 != null)
    .map((f) => ({
      fixtureId: f.fixtureId,
      startTime: f.startTime as number,
      competition: f.competition ?? "",
      participant1: f.participant1 as string,
      participant2: f.participant2 as string,
      participant1IsHome: f.participant1IsHome ?? true,
      statusId: f.statusId,
      isFinal: f.isFinal,
      finalP1: Array.isArray(f.finalScore) ? (f.finalScore[0] ?? null) : null,
      finalP2: Array.isArray(f.finalScore) ? (f.finalScore[1] ?? null) : null,
      oddsTickCount: f.oddsTickCount,
    }))
    .sort((a, b) => a.startTime - b.startTime);
}

export async function getFixture(fixtureId: number): Promise<FixtureRow | undefined> {
  return (await listFixtures()).find((f) => f.fixtureId === fixtureId);
}

/** Full-precision 1X2 path (full-match variable), optionally truncated server-side via asOf. */
export async function pathFor(fixtureId: number, asOf?: number): Promise<PathTick[]> {
  const res = await client.oddsRaw(fixtureId, {
    market: "1X2_PARTICIPANT_RESULT",
    ...(asOf !== undefined ? { asOf } : {}),
    limit: 100_000,
  });
  const out: PathTick[] = [];
  for (const t of res.ticks) {
    if ((t.MarketPeriod ?? "") !== "") continue; // full-match variable only
    const names = t.PriceNames ?? [];
    const pct = (t.Pct ?? []).map(Number);
    const i1 = names.indexOf("part1"), ix = names.indexOf("draw"), i2 = names.indexOf("part2");
    if (i1 < 0 || ix < 0 || i2 < 0) continue;
    const p1 = pct[i1], dr = pct[ix], p2 = pct[i2];
    if (![p1, dr, p2].every((v) => Number.isFinite(v))) continue;
    out.push({ ts: t.Ts, messageId: t.MessageId, part1: p1!, draw: dr!, part2: p2! });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

/**
 * Timeline as known at `asOf`: SDK fixture detail supplies folded status transitions and
 * minute-stamped events; both are truncated to asOf here, then the pure derivation runs.
 * Clock anchors come from event minutes (plus nominal phase starts) — no raw-feed parsing.
 */
export async function timelineFor(
  fixtureId: number,
  pathEndTs: number,
  opts: { asOf?: number; startTimeHint?: number } = {},
): Promise<PhaseTimeline> {
  const asOf = opts.asOf ?? Number.MAX_SAFE_INTEGER;
  const endAnchor = Math.min(pathEndTs, asOf);
  const detail = await client.fixture(fixtureId);
  const transitions: StatusTransition[] = (detail.timeline?.phases ?? [])
    .filter((p) => p.ts <= asOf)
    .map((p) => ({ ts: p.ts, statusId: p.status }));
  const phases = windowsFromTransitions(transitions, endAnchor, opts.startTimeHint);

  const anchors: ClockSample[] = (detail.timeline?.events ?? [])
    .filter((e) => e.minute !== undefined && e.ts <= asOf)
    .map((e) => ({ ts: e.ts, s: (e.minute as number) * 60 }));
  anchors.sort((a, b) => a.ts - b.ts);

  // score-change moments ([participant1, participant2]); baseline 0–0 at kickoff
  const scoreline: ScorePoint[] = [];
  const kickoffTs = transitions.find((t) => t.statusId === 2)?.ts;
  if (kickoffTs !== undefined) scoreline.push({ ts: kickoffTs, p1: 0, p2: 0 });
  for (const e of detail.timeline?.events ?? []) {
    if (!Array.isArray(e.score) || e.ts > asOf) continue;
    const [p1, p2] = e.score as [number, number];
    const last = scoreline[scoreline.length - 1];
    if (!last || last.p1 !== p1 || last.p2 !== p2) scoreline.push({ ts: e.ts, p1, p2 });
  }

  const clock: ClockSample[] = [];
  for (const w of phases) {
    if (!PLAYING.has(w.phase)) continue;
    const inWin = anchors.filter((a) => a.ts >= w.startTs && a.ts <= Math.min(w.endTs, asOf));
    if (inWin.length) {
      w.clockEndS = Math.max(inWin[inWin.length - 1]!.s, w.clockStartS ?? 0);
      if (w.clockStartS == null) w.clockStartS = inWin[0]!.s;
      clock.push(...inWin);
    } else {
      const nominal = NOMINAL_CLOCK_START[w.phase] ?? 0;
      w.clockStartS = nominal;
      w.clockEndS = nominal + Math.round((Math.min(w.endTs, asOf) - w.startTs) / 1000);
    }
  }
  return { phases, clock, scoreline };
}

export { openingProbe };
