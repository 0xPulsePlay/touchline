export interface Fixture {
  fixtureId: number;
  startTime: number;
  competition: string;
  participant1: string;
  participant2: string;
  statusId: number | null;
  isFinal: boolean;
  finalP1: number | null;
  finalP2: number | null;
  oddsTickCount: number;
}

export interface PathPoint {
  ts: number;
  part1: number;
  draw: number;
  part2: number;
}

export type PhaseName =
  | "PRE" | "H1" | "HT" | "H2"
  | "ET_WAIT" | "ET1" | "ET_HT" | "ET2"
  | "PENS_WAIT" | "PENS" | "SUSP" | "POST";

export interface PhaseWindow {
  phase: PhaseName;
  startTs: number;
  endTs: number;
  clockStartS: number | null;
  clockEndS: number | null;
}

export interface PhaseTimeline {
  phases: PhaseWindow[];
  clock: { ts: number; s: number }[];
  /** score-change moments (participant1, participant2), truncated to the observation instant */
  scoreline?: { ts: number; p1: number; p2: number }[];
}

export interface PathResponse {
  fixture: Fixture;
  opening: PathPoint | null;
  tickCount: number;
  asOf: number | null;
  timeline: PhaseTimeline;
  path: PathPoint[];
}

export type Side = "part1" | "draw" | "part2";

export interface Quote {
  side: Side;
  barrier: number;
  p0: number;
  bound: number;
  discount: number;
  fair: number;
  maxObserved: number;
}

export interface Verification {
  verified: boolean;
  subTreeVerified: boolean;
  mainTreeVerified: boolean;
  pdaEpochDayMatches: boolean;
  pda: string;
  epochDay: number;
  fiveMinSlot: number;
  programId: string;
  computedRootHex: string;
  onChainRootHex: string | null;
  namespacedFixtureId: string;
  failureMode: string | null;
}

export interface Receipt {
  verified: boolean;
  messageId: string;
  ts: number;
  verification: Verification | null;
  error: string | null;
}

export interface Market {
  id: string;
  fixtureId: number;
  side: Side;
  barrierPct: number;
  quoteAtCreate: { p0: number; bound: number; fair: number };
  status: "open" | "resolved_yes" | "resolved_no";
  stakes: { bettor: string; side: "yes" | "no"; amount: number }[];
  pools: { yes: number; no: number };
  poolImpliedYes: number;
  resolution?: {
    outcome: "yes" | "no";
    evidence?: { messageId: string; ts: number; pct: number };
    receipt?: Receipt;
    payoutPerUnit: number;
  };
}

export interface CalBucket {
  barrier: number;
  n: number;
  touched: number;
  observedRate: number;
  meanBound: number;
  discount: number | null;
}

export interface Calibration {
  fixtures: number;
  samples: unknown[];
  buckets: CalBucket[];
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  fixtures: () => fetch("/api/fixtures").then((r) => j<Fixture[]>(r)),
  path: (id: number, opts: { every?: number; asOf?: number } = {}) =>
    fetch(`/api/fixtures/${id}/path?every=${opts.every ?? 4}${opts.asOf ? `&asOf=${opts.asOf}` : ""}`)
      .then((r) => j<PathResponse>(r)),
  quote: (id: number, side: Side, barrier: number) =>
    fetch(`/api/fixtures/${id}/quote?side=${side}&barrier=${barrier}`).then((r) => j<Quote>(r)),
  markets: (fixtureId: number) => fetch(`/api/markets?fixtureId=${fixtureId}`).then((r) => j<Market[]>(r)),
  createMarket: (fixtureId: number, side: Side, barrier: number) =>
    fetch("/api/markets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fixtureId, side, barrier }),
    }).then((r) => j<Market>(r)),
  stake: (id: string, side: "yes" | "no", amount: number) =>
    fetch(`/api/markets/${id}/stake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bettor: "you", side, amount }),
    }).then((r) => j<Market>(r)),
  resolve: (id: string) => fetch(`/api/markets/${id}/resolve`, { method: "POST" }).then((r) => j<Market>(r)),
  calibration: () => fetch("/api/calibration").then((r) => j<Calibration>(r)),

  // ── on-chain (devnet, mock SPL) ──────────────────────────────────────────
  chainState: () => fetch("/api/chain/state").then((r) => j<ChainState>(r)),
  faucet: (sessionId: string, label: string, usdc = 100) =>
    fetch("/api/faucet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, label, usdc }) }).then((r) => j<{ pubkey: string; balanceUsdc: number }>(r)),
  balance: (sessionId: string) => fetch(`/api/balance?sessionId=${sessionId}`).then((r) => j<{ balanceUsdc: number; balanceSol: number }>(r)),
  dealerQuote: (fixtureId: number, side: Side, barrier: number, kind: BetKind = "up", barrier2?: number) =>
    fetch(`/api/dealer/quote?fixtureId=${fixtureId}&side=${side}&barrier=${barrier}&kind=${kind}${barrier2 !== undefined ? `&barrier2=${barrier2}` : ""}`).then((r) => j<DealerQuote>(r)),
  bet: (b: { sessionId: string; label: string; fixtureId: number; side: Side; barrier: number; barrier2?: number; kind?: BetKind; usdc: number; epoch?: number }) =>
    fetch("/api/bet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => j<BetResult>(r)),
  resolveOnchain: (marketKey: string) => fetch(`/api/market/${marketKey}/resolve`, { method: "POST" }).then((r) => j<ResolveResult>(r)),
  claim: (sig: string) => fetch("/api/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sig }) }).then((r) => j<{ sig: string }>(r)),
  activity: () => fetch("/api/activity").then((r) => j<ActivityBet[]>(r)),
  onchainMarkets: (fixtureId: number) => fetch(`/api/onchain/markets?fixtureId=${fixtureId}`).then((r) => j<OnchainMarket[]>(r)),
  treasury: (marketKey: string) => fetch(`/api/treasury/${marketKey}`).then((r) => j<Treasury>(r)),

  // ── parlays ──────────────────────────────────────────────────────────────
  parlayQuote: (legs: ParlayLegInput[]) =>
    fetch("/api/parlay/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ legs }) }).then((r) => j<ParlayQuote>(r)),
  placeParlay: (b: { sessionId: string; label: string; usdc: number; legs: ParlayLegInput[] }) =>
    fetch("/api/parlay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => j<ParlayResult>(r)),
  claimParlay: (key: string) => fetch(`/api/parlay/${key}/claim`, { method: "POST" }).then((r) => j<{ sig: string; outcome: "yes" | "no"; payoutUsdc: number }>(r)),
};

export interface ParlayLegInput { fixtureId: number; side: Side; kind?: BetKind; barrier: number; barrier2?: number }
export interface ParlayQuote {
  legs: { fixtureId: number; side: Side; kind: BetKind; barrierBps: number; barrier2Bps?: number; priceBps: number }[];
  combinedPriceBps: number; payoutMult: number; error?: string;
}
export interface ParlayResult {
  key: string; sig: string; priceBps: number; payoutMult: number; amountUsdc: number; payoutUsdc: number;
  legs: { marketKey: string; fixtureId: number; side: Side; kind: BetKind; barrierBps: number; priceBps: number }[];
}

export interface Treasury {
  marketKey: string; barrierBps: number; bets: number; shares: number;
  premiumsUsdc: number; hedgeCostUsdc: number; liabilityUsdc: number; venueP: number; venue: string;
  hedgeValueIfTouched: number;
  unhedgedNetIfYes: number; hedgedNetIfYes: number; hedgedNetIfNo: number;
  realized: HedgeRealized | null;
}

export type BetKind = "up" | "down" | "band" | "heartbreak" | "comeback";
export interface ChainState { programId: string; cluster: string; rpc: string; usdcMint: string | null; betCapUsdc: number; ready: boolean }
export interface DealerQuote {
  side: Side; pBps: number; barrierBps: number; boundBps: number; discount: number; priceBps: number;
  payoutMult: number; minBarrierBps: number; valid: boolean; reason?: string;
  kind?: BetKind; barrier2Bps?: number; boundDownBps?: number; maxDownBps?: number;
}
export interface BetResult { sig: string; marketKey: string; priceBps: number; payoutMult: number; amountUsdc: number; payoutUsdc: number; kind?: BetKind }
export interface ActivityBet { sig: string; marketKey: string; fixtureId: number; side: Side; barrierBps: number; kind?: BetKind; barrier2Bps?: number | null; label: string; bot: boolean; ts: number; claimed: boolean; amountUsdc: number; priceBps: number; payoutUsdc: number; bettor: string }
export interface OnchainMarket { key: string; fixtureId: number; side: Side; barrierBps: number; status: "open" | "yes" | "no"; bets: ActivityBet[]; treasury?: Treasury }
export interface HedgeRealized { outcome: "yes" | "no"; touchProb: number; premiums: number; hedgeCost: number; hedgeValue: number; paid: number; net: number; unhedgedNet: number; ts: number }
export interface ResolveResult { outcome: "yes" | "no"; sig: string; verified?: boolean; receipt?: Receipt; hedge?: HedgeRealized; kind?: BetKind }
