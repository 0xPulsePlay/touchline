import { describe, expect, it } from "vitest";
import { windowsFromTransitions, type StatusTransition } from "./phases.js";

const T = (m: number) => 1_784_142_000_000 + m * 60_000; // minutes after a fixed kickoff wall-time
const t = (m: number, statusId: number): StatusTransition => ({ ts: T(m), statusId });

describe("windowsFromTransitions — pure derivation", () => {
  it("regulation match: PRE → H1 → HT → H2 → POST", () => {
    const w = windowsFromTransitions([t(0, 2), t(48, 3), t(63, 4), t(120, 5)], T(125));
    expect(w.map((x) => x.phase)).toEqual(["PRE", "H1", "HT", "H2", "POST"]);
    expect(w[1]).toMatchObject({ startTs: T(0), endTs: T(48), clockStartS: 0 });
    expect(w[3]).toMatchObject({ startTs: T(63), clockStartS: 45 * 60 });
  });

  it("full ET + pens path", () => {
    const w = windowsFromTransitions(
      [t(0, 2), t(48, 3), t(63, 4), t(115, 6), t(119, 7), t(135, 8), t(138, 9), t(155, 11), t(160, 12), t(172, 13)],
      T(180),
    );
    expect(w.map((x) => x.phase)).toEqual(
      ["PRE", "H1", "HT", "H2", "ET_WAIT", "ET1", "ET_HT", "ET2", "PENS_WAIT", "PENS", "POST"],
    );
  });

  it("LIVE mid-H1 (asOf-truncated inputs): open window extends to the observation edge", () => {
    const w = windowsFromTransitions([t(0, 2)], T(23));
    expect(w.map((x) => x.phase)).toEqual(["PRE", "H1", "POST"]);
    expect(w[1]!.endTs).toBe(T(23)); // grows with the leading edge
    expect(w[2]!.startTs).toBe(w[2]!.endTs); // zero-width trailing POST
  });

  it("LIVE at halftime: HT band exists and extends to the edge", () => {
    const w = windowsFromTransitions([t(0, 2), t(48, 3)], T(55));
    expect(w.map((x) => x.phase)).toEqual(["PRE", "H1", "HT", "POST"]);
    expect(w[2]).toMatchObject({ startTs: T(48), endTs: T(55) });
  });

  it("interruption statuses map to SUSP bands and play can resume", () => {
    const w = windowsFromTransitions([t(0, 2), t(20, 14), t(30, 2), t(48, 3)], T(50));
    expect(w.map((x) => x.phase)).toEqual(["PRE", "H1", "SUSP", "H1", "HT", "POST"]);
  });

  it("abandonment is terminal", () => {
    const w = windowsFromTransitions([t(0, 2), t(30, 15), t(31, 2)], T(40));
    expect(w.map((x) => x.phase)).toEqual(["PRE", "H1", "POST"]);
  });

  it("pre-kickoff (no transitions yet): PRE-only axis with the startTime hint", () => {
    const w = windowsFromTransitions([], T(-30), T(0));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ phase: "PRE", endTs: T(0) });
  });

  it("no transitions and no hint → empty (wall-clock fallback)", () => {
    expect(windowsFromTransitions([], T(0))).toEqual([]);
  });

  it("repeated status messages collapse", () => {
    const w = windowsFromTransitions([t(0, 2), t(5, 2), t(48, 3), t(48.5, 3)], T(50));
    expect(w.map((x) => x.phase)).toEqual(["PRE", "H1", "HT", "POST"]);
  });
});
