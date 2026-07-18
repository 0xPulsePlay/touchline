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

export interface PathResponse {
  fixture: Fixture;
  opening: PathPoint | null;
  tickCount: number;
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
  path: (id: number, every = 4) => fetch(`/api/fixtures/${id}/path?every=${every}`).then((r) => j<PathResponse>(r)),
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
};
