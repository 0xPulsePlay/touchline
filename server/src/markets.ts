import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { parimutuelPayoutPerUnit } from "./pricing.js";
import type { Side } from "./corpus.js";

export type MarketKind = "one_touch";
export type MarketStatus = "open" | "resolved_yes" | "resolved_no";

export interface Stake {
  bettor: string;
  side: "yes" | "no";
  amount: number; // virtual USDC in the prototype
}

export interface Resolution {
  outcome: "yes" | "no";
  /** the touching tick, when YES */
  evidence?: { messageId: string; ts: number; pct: number };
  /** proof receipt attached after on-chain verification */
  receipt?: unknown;
  payoutPerUnit: number;
  resolvedAt: number;
}

export interface Market {
  id: string;
  kind: MarketKind;
  fixtureId: number;
  side: Side;
  /** barrier in percent (e.g. 60 = "touches 60%") */
  barrierPct: number;
  /** displayed fair quote at creation (p/B × discount) */
  quoteAtCreate: { p0: number; bound: number; fair: number };
  createdAt: number;
  status: MarketStatus;
  stakes: Stake[];
  resolution?: Resolution;
}

const FILE = "markets.json";

function load(): Market[] {
  try {
    return JSON.parse(readFileSync(join(config.dataDir, FILE), "utf8")) as Market[];
  } catch {
    return [];
  }
}

/** Tests exercise the same store in-memory only — never the on-disk file. */
const PERSIST = !process.env.VITEST;

function save(all: Market[]): void {
  if (!PERSIST) return;
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(join(config.dataDir, FILE), JSON.stringify(all, null, 2), "utf8");
}

let markets: Market[] = load();

export function listMarkets(fixtureId?: number): Market[] {
  return fixtureId === undefined ? markets : markets.filter((m) => m.fixtureId === fixtureId);
}

export function getMarket(id: string): Market | undefined {
  return markets.find((m) => m.id === id);
}

export function createMarket(
  m: Omit<Market, "id" | "createdAt" | "status" | "stakes">,
): Market {
  const market: Market = {
    ...m,
    id: `tl_${m.fixtureId}_${m.side}_${m.barrierPct}_${Date.now().toString(36)}`,
    createdAt: Date.now(),
    status: "open",
    stakes: [
      // seed pool at the fair quote so pool-implied odds open "already correct"
      { bettor: "house-seed", side: "yes", amount: Math.round(100 * m.quoteAtCreate.fair) },
      { bettor: "house-seed", side: "no", amount: Math.round(100 * (1 - m.quoteAtCreate.fair)) },
    ],
  };
  markets.push(market);
  save(markets);
  return market;
}

export function stake(id: string, s: Stake): Market {
  const m = getMarket(id);
  if (!m) throw new Error(`no market ${id}`);
  if (m.status !== "open") throw new Error(`market ${id} is ${m.status}`);
  if (!(s.amount > 0)) throw new Error("stake must be positive");
  m.stakes.push(s);
  save(markets);
  return m;
}

export function poolTotals(m: Market): { yes: number; no: number } {
  let yes = 0, no = 0;
  for (const s of m.stakes) (s.side === "yes" ? (yes += s.amount) : (no += s.amount));
  return { yes, no };
}

/** Pool-implied YES probability (what the crowd currently says). */
export function poolImpliedYes(m: Market): number {
  const { yes, no } = poolTotals(m);
  return yes + no > 0 ? yes / (yes + no) : 0.5;
}

export function resolveMarket(
  id: string,
  outcome: "yes" | "no",
  evidence?: Resolution["evidence"],
  receipt?: unknown,
): Market {
  const m = getMarket(id);
  if (!m) throw new Error(`no market ${id}`);
  if (m.status !== "open") throw new Error(`market ${id} already ${m.status}`);
  const { yes, no } = poolTotals(m);
  const payoutPerUnit = outcome === "yes" ? parimutuelPayoutPerUnit(yes, no) : parimutuelPayoutPerUnit(no, yes);
  m.status = outcome === "yes" ? "resolved_yes" : "resolved_no";
  m.resolution = { outcome, evidence, receipt, payoutPerUnit, resolvedAt: Date.now() };
  save(markets);
  return m;
}

/** test seam */
export function _resetForTests(initial: Market[] = []): void {
  markets = initial;
}
