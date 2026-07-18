import { describe, expect, it } from "vitest";
import { firstTouch, maxPct } from "./touch.js";
import type { PathTick } from "./corpus.js";

const path: PathTick[] = [
  { ts: 100, messageId: "a", part1: 28.4, draw: 46.5, part2: 25.1 },
  { ts: 200, messageId: "b", part1: 29.0, draw: 46.0, part2: 25.0 },
  // the goal jump — crosses any barrier in (29, 69.7] in one step
  { ts: 300, messageId: "c", part1: 69.7, draw: 23.5, part2: 6.8 },
  { ts: 400, messageId: "d", part1: 65.0, draw: 26.1, part2: 8.9 },
];

describe("firstTouch", () => {
  it("finds the first tick at/above the barrier", () => {
    expect(firstTouch(path, "part1", 60)).toMatchObject({ messageId: "c", ts: 300, pct: 69.7 });
  });
  it("jump-overshoot still counts as a touch (jump lands past the barrier)", () => {
    expect(firstTouch(path, "part1", 35)?.messageId).toBe("c");
  });
  it("respects fromTs (markets opened mid-match)", () => {
    // the 69.7 spike is before fromTs; the only later tick is 65.0 < 68
    expect(firstTouch(path, "part1", 68, 350)).toBeUndefined();
    // …but 65.0 still touches a 60 barrier after fromTs
    expect(firstTouch(path, "part1", 60, 350)?.messageId).toBe("d");
  });
  it("returns undefined when never touched", () => {
    expect(firstTouch(path, "part2", 30)).toBeUndefined();
  });
});

describe("maxPct", () => {
  it("running maximum over the window", () => {
    expect(maxPct(path, "part1")).toBe(69.7);
    expect(maxPct(path, "draw", 250)).toBe(26.1);
  });
});
