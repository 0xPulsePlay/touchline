import type { Fixture } from "./api.js";

/** Shared fixture grouping — one source of truth for the home page and the market view. */
export type Group = "live" | "upcoming" | "finished";

export function groupOf(f: Fixture, now: number): Group {
  if (f.startTime > now) return "upcoming";
  if (!f.isFinal && now - f.startTime < 5 * 3600_000) return "live";
  return "finished";
}

export const GROUP_META: Record<Group, { label: string; live?: boolean }> = {
  live: { label: "Live now", live: true },
  upcoming: { label: "Upcoming" },
  finished: { label: "Finished" },
};
