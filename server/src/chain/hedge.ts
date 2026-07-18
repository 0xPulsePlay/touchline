import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "./config.js";
import type { Side } from "../model.js";

/**
 * The hedge leg — the net-zero replication, made structural.
 *
 * When the house writes a one-touch YES ticket (user stakes S, we owe payout P if the barrier B is
 * touched), it takes an OFFSETTING position on a liquid win market: it buys `P/B` win-shares at the
 * current win price p. The replication (see the white paper):
 *   - premium/edge aside, the win-share position is worth exactly P at the moment of touch
 *     (a win-share trades at the win probability, which equals B at the touch), so it funds the
 *     payout — net ≈ 0 for the house;
 *   - if the barrier is never touched, the team never won, the shares expire worthless, and the
 *     house owes nothing — net 0 again.
 * The measured 0.87 discount is the cushion: jumps make touches overshoot B, so the shares are
 * usually worth a little MORE than P at the touch — a one-sided residual in the house's favour.
 *
 * VENUE PRICE. `venuePrice` is the win probability p used to size + cost the hedge. Today it comes
 * from TxLINE's own de-margined win probability (the efficient-market proxy — for a liquid match
 * the venue and TxLINE agree, which is the whole premise). The `venue` field marks the source so a
 * real Polymarket/Kalshi adapter can drop in per market without changing the accounting.
 */

const FILE = resolve(DATA_DIR, "hedge-ledger.json");

/**
 * Pure replication math (no ledger I/O) — the identity the white paper proves.
 * To cover a payout P on a touch of barrier B, hold P/B win-shares; each is worth the win
 * probability, which equals B at the touch, so the position is worth exactly P there.
 */
export function replicate(payoutUsdc: number, barrierBps: number, venueP: number): { shares: number; cost: number } {
  const B = barrierBps / 10000;
  const shares = payoutUsdc / B;
  return { shares, cost: shares * venueP };
}

/** Hedge liquidation value at settlement. YES → shares × touching-prob (≥ B); NO → worthless. */
export function hedgeValueAt(shares: number, outcome: "yes" | "no", touchProbFrac: number, barrierBps: number): number {
  if (outcome === "no") return 0;
  return shares * Math.max(touchProbFrac, barrierBps / 10000);
}

export interface HedgeLot {
  marketKey: string;
  betSig: string;
  side: Side;
  barrierBps: number;
  /** premium the user staked (house cash in) */
  stakeUsdc: number;
  /** dollars the house owes if this ticket resolves YES */
  payoutUsdc: number;
  /** win probability used to size/price the hedge (fraction 0..1) */
  venueP: number;
  venue: string;
  /** win-shares held = payout / B */
  shares: number;
  /** cost to acquire the shares now = shares × p */
  costUsdc: number;
  ts: number;
}

export interface HedgeRealized {
  outcome: "yes" | "no";
  touchProb: number;
  premiums: number;
  hedgeCost: number;
  hedgeValue: number;
  paid: number;
  /** house P&L WITH the hedge = premiums − hedgeCost + hedgeValue − paid */
  net: number;
  /** house P&L the same outcome would have cost UNHEDGED = premiums − paid */
  unhedgedNet: number;
  ts: number;
}

interface HedgeLedger {
  lots: HedgeLot[];
  /** per-market realized settlement, keyed by marketKey */
  realized: Record<string, HedgeRealized>;
}

function load(): HedgeLedger {
  try { return JSON.parse(readFileSync(FILE, "utf8")) as HedgeLedger; } catch { return { lots: [], realized: {} }; }
}
function save(l: HedgeLedger): void { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(l, null, 2), "utf8"); }
let ledger = load();

/** Record the hedge the house takes against one bet. Returns the lot. */
export function recordHedge(args: {
  marketKey: string; betSig: string; side: Side; barrierBps: number; stakeUsdc: number; payoutUsdc: number; venueP: number; venue?: string;
}): HedgeLot {
  const { shares, cost } = replicate(args.payoutUsdc, args.barrierBps, args.venueP); // P/B win-shares — worth P at the touch
  const lot: HedgeLot = {
    marketKey: args.marketKey, betSig: args.betSig, side: args.side, barrierBps: args.barrierBps,
    stakeUsdc: args.stakeUsdc, payoutUsdc: args.payoutUsdc, venueP: args.venueP, venue: args.venue ?? "txline-winprob",
    shares, costUsdc: cost, ts: Date.now(),
  };
  ledger.lots.push(lot);
  save(ledger);
  return lot;
}

export function lotsFor(marketKey: string): HedgeLot[] {
  return ledger.lots.filter((l) => l.marketKey === marketKey);
}

export interface Treasury {
  marketKey: string;
  barrierBps: number;
  bets: number;
  /** total win-shares held against this market */
  shares: number;
  /** premiums the house collected (stakes) */
  premiumsUsdc: number;
  /** total $ paid to acquire the hedge */
  hedgeCostUsdc: number;
  /** total payout the house owes if YES */
  liabilityUsdc: number;
  /** the venue win price the hedge was struck at (avg, fraction) */
  venueP: number;
  venue: string;
  /** projected hedge value if the barrier is touched (shares liquidate at ~B) */
  hedgeValueIfTouched: number;
  /** house P&L if it touches WITHOUT the hedge = premiums − liability (the risk being removed) */
  unhedgedNetIfYes: number;
  /** house P&L if it touches WITH the hedge = premiums − hedgeCost + hedgeValue − liability (small) */
  hedgedNetIfYes: number;
  /** house P&L if it never touches = premiums − hedgeCost (shares expire worthless) */
  hedgedNetIfNo: number;
  realized: HedgeLedger["realized"][string] | null;
}

/** Aggregate the hedge book for one market. */
export function treasury(marketKey: string, barrierBps: number): Treasury {
  const lots = lotsFor(marketKey);
  const shares = lots.reduce((a, l) => a + l.shares, 0);
  const premiums = lots.reduce((a, l) => a + l.stakeUsdc, 0);
  const hedgeCost = lots.reduce((a, l) => a + l.costUsdc, 0);
  const liability = lots.reduce((a, l) => a + l.payoutUsdc, 0);
  const venueP = lots.length ? lots.reduce((a, l) => a + l.venueP, 0) / lots.length : 0;
  const barrierFrac = barrierBps / 10000;
  const hedgeValueIfTouched = shares * barrierFrac; // shares × B ≈ liability by construction
  return {
    marketKey, barrierBps, bets: lots.length, shares, premiumsUsdc: premiums,
    hedgeCostUsdc: hedgeCost, liabilityUsdc: liability, venueP, venue: lots[0]?.venue ?? "txline-winprob",
    hedgeValueIfTouched,
    unhedgedNetIfYes: premiums - liability,
    hedgedNetIfYes: premiums - hedgeCost + hedgeValueIfTouched - liability,
    hedgedNetIfNo: premiums - hedgeCost,
    realized: ledger.realized[marketKey] ?? null,
  };
}

/**
 * Realize the hedge at settlement. YES → shares liquidate at the touching probability `touchProb`
 * (≥ B, capturing any jump overshoot); the house pays `liability` and keeps the difference. NO →
 * shares expire worthless, the house owes nothing and keeps the premiums it collected elsewhere.
 */
export function realizeHedge(marketKey: string, barrierBps: number, outcome: "yes" | "no", touchProbFrac: number): HedgeRealized {
  const t = treasury(marketKey, barrierBps);
  const hedgeValue = hedgeValueAt(t.shares, outcome, touchProbFrac, barrierBps);
  const paid = outcome === "yes" ? t.liabilityUsdc : 0;
  // full house P&L: premiums in − hedge cost − payout out + hedge liquidation
  const net = t.premiumsUsdc - t.hedgeCostUsdc + hedgeValue - paid;
  const rec: HedgeRealized = {
    outcome, touchProb: touchProbFrac, premiums: t.premiumsUsdc, hedgeCost: t.hedgeCostUsdc,
    hedgeValue, paid, net, unhedgedNet: t.premiumsUsdc - paid, ts: Date.now(),
  };
  ledger.realized[marketKey] = rec;
  save(ledger);
  return rec;
}

/** Platform-wide roll-up for the treasury dashboard. */
export function bookSummary(): { lots: number; shares: number; premiumsUsdc: number; hedgeCostUsdc: number; liabilityUsdc: number; markets: number } {
  const markets = new Set(ledger.lots.map((l) => l.marketKey));
  return {
    lots: ledger.lots.length,
    shares: ledger.lots.reduce((a, l) => a + l.shares, 0),
    premiumsUsdc: ledger.lots.reduce((a, l) => a + l.stakeUsdc, 0),
    hedgeCostUsdc: ledger.lots.reduce((a, l) => a + l.costUsdc, 0),
    liabilityUsdc: ledger.lots.reduce((a, l) => a + l.payoutUsdc, 0),
    markets: markets.size,
  };
}
