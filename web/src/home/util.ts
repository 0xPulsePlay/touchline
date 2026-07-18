import type { Fixture, PathPoint, Side } from "../api.js";

/* ────────────────────────────────────────────────────────────────────────
 * Home path-picker helpers. Self-contained on purpose: the market view owns
 * its own fetch client (../api.ts, edited concurrently), so this feature only
 * borrows *types* from it and talks to the documented endpoints directly.
 * ──────────────────────────────────────────────────────────────────────── */

export type Group = "live" | "upcoming" | "finished";

/** Same rule the market view uses: future = upcoming, started-and-recent-and-not-final = live. */
export function groupOf(f: Fixture, now: number): Group {
  if (f.startTime > now) return "upcoming";
  if (!f.isFinal && now - f.startTime < 5 * 3600_000) return "live";
  return "finished";
}

export const GROUP_META: Record<Group, { label: string; kicker: string; live?: boolean }> = {
  live: { label: "Live now", kicker: "moving in real time", live: true },
  upcoming: { label: "Upcoming", kicker: "pre-match lines open" },
  finished: { label: "Full time", kicker: "settled paths, replayable" },
};

/** 1X2 sides mapped to the design-system probability colors (home/draw/away). */
export const SIDE_COLOR: Record<Side, string> = {
  part1: "var(--home)",
  draw: "var(--draw)",
  part2: "var(--away)",
};

/* ── endpoints (raw fetch — decoupled from the concurrently-edited api.ts) ── */

export async function fetchFixtures(): Promise<Fixture[]> {
  const r = await fetch("/api/fixtures");
  if (!r.ok) throw new Error(`fixtures ${r.status}`);
  return (await r.json()) as Fixture[];
}

export async function fetchPath(id: number, every = 12): Promise<PathPoint[]> {
  const r = await fetch(`/api/fixtures/${id}/path?every=${every}`);
  if (!r.ok) throw new Error(`path ${r.status}`);
  const data = (await r.json()) as { path?: PathPoint[] };
  return data.path ?? [];
}

/* ── favourite selection ──────────────────────────────────────────────── */

export interface Favourite {
  side: Side;
  value: number; // 0–100 (the path scale)
  color: string;
}

/** The side leading at the latest tick — what the sparkline emphasises. */
export function favouriteOf(path: PathPoint[]): Favourite | null {
  const last = path[path.length - 1];
  if (!last) return null;
  const sides: Side[] = ["part1", "draw", "part2"];
  let best: Side = "part1";
  for (const s of sides) if (last[s] > last[best]) best = s;
  return { side: best, value: last[best], color: SIDE_COLOR[best] };
}

export function sideName(f: Fixture, side: Side): string {
  return side === "part1" ? f.participant1 : side === "part2" ? f.participant2 : "Draw";
}

/* ── formatting ───────────────────────────────────────────────────────── */

/** FIFA-style three-letter codes for the World Cup corpus; falls back to first letters. */
const CODE: Record<string, string> = {
  Algeria: "ALG", Argentina: "ARG", Australia: "AUS", Austria: "AUT", Belgium: "BEL",
  "Bosnia & Herzegovina": "BIH", Brazil: "BRA", Canada: "CAN", "Cape Verde": "CPV",
  Colombia: "COL", "Congo DR": "COD", "Costa Rica": "CRC", Croatia: "CRO", Curacao: "CUW",
  Ecuador: "ECU", Egypt: "EGY", England: "ENG", France: "FRA", Germany: "GER", Ghana: "GHA",
  Haiti: "HAI", Iran: "IRN", Iraq: "IRQ", "Ivory Coast": "CIV", Japan: "JPN", Jordan: "JOR",
  Mexico: "MEX", Morocco: "MAR", Myanmar: "MYA", Netherlands: "NED", "New Zealand": "NZL",
  Norway: "NOR", Panama: "PAN", Paraguay: "PAR", Portugal: "POR", Qatar: "QAT",
  "Saudi Arabia": "KSA", Scotland: "SCO", Senegal: "SEN", "South Africa": "RSA",
  "South Korea": "KOR", Spain: "ESP", Sweden: "SWE", Switzerland: "SUI", Tunisia: "TUN",
  USA: "USA", Uruguay: "URU", Uzbekistan: "UZB", Vietnam: "VIE",
};

export function code(team: string): string {
  return CODE[team] ?? team.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "—";
}

/** Compact, trust-cue tick counts: 5_512_340 → "5.5M". */
export function fmtTicks(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

/** "Sat · Jul 20 · 15:00" — weekday helps a browsing eye more than a bare date. */
export function fmtKickoff(ts: number): string {
  const d = new Date(ts);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

/** Relative countdown for upcoming fixtures ("in 3h", "in 2d"), null once it has passed. */
export function countdown(ts: number, now: number): string | null {
  const ms = ts - now;
  if (ms <= 0) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.round(hrs / 24)}d`;
}
