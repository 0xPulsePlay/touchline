import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "./config.js";
import type { BetKind } from "../dealer.js";
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
  /** bet kind — determines the replicating position (default "up") */
  kind?: BetKind;
  /** BAND: the lower edge (bps) */
  barrier2Bps?: number;
  /** premium the user staked (house cash in) */
  stakeUsdc: number;
  /** dollars the house owes if this ticket resolves YES */
  payoutUsdc: number;
  /** win probability used to size/price the hedge (fraction 0..1) */
  venueP: number;
  venue: string;
  /** primary position size (win-shares for up/heartbreak, NO-shares for down/comeback; combined for band) */
  shares: number;
  /** cost to acquire the position now (self-financing ≈ the fair premium) */
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

/**
 * The replicating position per kind (all self-financing at the fair price):
 *   up         P/B win-shares @ p                     — worth P at the touch
 *   down       P/(1−L) NO-shares @ (1−p)              — worth P when X touches L (NO price 1−L)
 *   band       both legs, each covering full P        — whichever edge trips funds the payout
 *   heartbreak P(1−B)/B win-shares @ p                — at the touch worth P(1−B); switch into
 *                                                       P NO-shares at (1−B): exactly self-financing;
 *                                                       the NO-shares pay P iff the team loses
 *   comeback   P·A/(1−A) NO-shares @ (1−p)            — mirror two-phase switch at the down-touch
 */
export function positionFor(kind: BetKind, payoutUsdc: number, barrierBps: number, barrier2Bps: number | undefined, venueP: number): { shares: number; cost: number } {
  const B = barrierBps / 10000;
  switch (kind) {
    case "up": return replicate(payoutUsdc, barrierBps, venueP);
    case "down": {
      const shares = payoutUsdc / (1 - B); // NO-shares
      return { shares, cost: shares * (1 - venueP) };
    }
    case "band": {
      // exact gambler's-ruin replication: N = P/(U−L) win-shares + cash leg −P·L/(U−L);
      // worth P at an up-exit, ~0 at a down-exit, cost = P(p−L)/(U−L) = the fair premium
      const L = (barrier2Bps ?? 0) / 10000;
      const N = payoutUsdc / Math.max(1e-9, B - L);
      return { shares: N, cost: N * venueP - (payoutUsdc * L) / Math.max(1e-9, B - L) };
    }
    case "heartbreak": {
      const shares = (payoutUsdc * (1 - B)) / B; // win-shares, phase 1
      return { shares, cost: shares * venueP };
    }
    case "comeback": {
      const A = B; // primary barrier is the down edge for comeback
      const shares = (payoutUsdc * A) / (1 - A); // NO-shares, phase 1
      return { shares, cost: shares * (1 - venueP) };
    }
  }
}

/** Record the hedge the house takes against one bet. Returns the lot. */
export function recordHedge(args: {
  marketKey: string; betSig: string; side: Side; barrierBps: number; stakeUsdc: number; payoutUsdc: number; venueP: number;
  kind?: BetKind; barrier2Bps?: number; venue?: string;
}): HedgeLot {
  const kind = args.kind ?? "up";
  const { shares, cost } = positionFor(kind, args.payoutUsdc, args.barrierBps, args.barrier2Bps, args.venueP);
  const lot: HedgeLot = {
    marketKey: args.marketKey, betSig: args.betSig, side: args.side, barrierBps: args.barrierBps,
    kind, barrier2Bps: args.barrier2Bps,
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
/**
 * Value one lot's position at settlement. `touchFrac` = the probability printed by the resolving
 * tick (the touch/exit tick); 0 means the trigger never fired. Two-phase kinds (heartbreak,
 * comeback) also need the touch info on NO outcomes — a touched-but-wrong-result NO liquidates the
 * switched position, a never-touched NO expires phase 1 worthless (or the claim just pays 0).
 */
export function lotValueAtSettlement(lot: HedgeLot, outcome: "yes" | "no", touchFrac: number): number {
  const kind = lot.kind ?? "up";
  const P = lot.payoutUsdc;
  const B = lot.barrierBps / 10000;
  switch (kind) {
    case "up":
      return outcome === "yes" ? lot.shares * Math.max(touchFrac, B) : 0;
    case "down":
      // NO-shares liquidate at (1 − touch) ≥ (1 − L) on a down-touch; expire at 0 if never touched
      // (a never-touched path can't terminate at 0, so the team won and NO-shares are worthless)
      return outcome === "yes" ? lot.shares * Math.max(1 - touchFrac, 1 - B) : 0;
    case "band": {
      // liquidate the whole position at the first exit, whichever edge: N·M_exit − P·L/(U−L)
      const L = (lot.barrier2Bps ?? 0) / 10000;
      const cash = (P * L) / Math.max(1e-9, B - L);
      return lot.shares * touchFrac - cash;
    }
    case "heartbreak": {
      // phase 1 sold at the touch (shares×touch), phase 2 bought P NO-shares at (1−touch);
      // NO-shares pay P iff the team lost (the YES condition). Never touched → 0.
      if (touchFrac <= 0) return 0;
      const switchNet = lot.shares * touchFrac - P * (1 - touchFrac);
      return switchNet + (outcome === "yes" ? P : 0);
    }
    case "comeback": {
      // mirror: phase 1 NO-shares sold at the down-touch (worth 1−touch each), phase 2 buys P
      // win-shares at touch; they pay P iff the team won (the YES condition).
      if (touchFrac <= 0) return 0;
      const switchNet = lot.shares * (1 - touchFrac) - P * touchFrac;
      return switchNet + (outcome === "yes" ? P : 0);
    }
  }
}

export function realizeHedge(marketKey: string, barrierBps: number, outcome: "yes" | "no", touchProbFrac: number): HedgeRealized {
  const t = treasury(marketKey, barrierBps);
  const lots = lotsFor(marketKey);
  const hedgeValue = lots.reduce((a, l) => a + lotValueAtSettlement(l, outcome, touchProbFrac), 0);
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

/** The most recently REALIZED hedge — a real booked settlement for the white paper's worked example. */
export function latestRealized(): (HedgeRealized & { marketKey: string; kind: BetKind; side: Side; barrierBps: number; venueP: number; shares: number }) | null {
  // newest realized settlement that has a hedge lot (parlay non-first legs carry none)
  const entries = Object.entries(ledger.realized).sort((a, b) => b[1].ts - a[1].ts);
  for (const [marketKey, rec] of entries) {
    const lot = lotsFor(marketKey)[0];
    if (lot) return { ...rec, marketKey, kind: lot.kind ?? "up", side: lot.side, barrierBps: lot.barrierBps, venueP: lot.venueP, shares: lot.shares };
  }
  return null;
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
