import type { FastifyInstance } from "fastify";
import { connection, PROGRAM_ID, DEVNET_RPC } from "./config.js";
import { readChainState, USDC_DECIMALS } from "./tokens.js";
import {
  ensureReady, faucet, balance, sessionSol, ensureMarket, placeBet, resolveMarketOnChain, claimBet,
  placeParlay, claimParlay, listParlays,
  activity, marketBets, listLedgerMarkets, SIDE_IDX,
} from "./service.js";
import { receiptForTick } from "../proofs.js";
import { dealerQuote, dealerQuoteKind, type BetKind } from "../dealer.js";
import { treasury, realizeHedge, bookSummary, latestRealized } from "./hedge.js";
import type { Side } from "../model.js";

const KINDS: BetKind[] = ["up", "down", "band", "heartbreak", "comeback"];
const asKind = (v: unknown): BetKind => (typeof v === "string" && (KINDS as string[]).includes(v) ? (v as BetKind) : "up");

/** Retry once (then twice) with backoff when the public devnet RPC rate-limits (429). */
async function withRpcRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      const s = String(e);
      if (attempt < 2 && (s.includes("429") || s.includes("Too Many Requests"))) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

const SIDES: Side[] = ["part1", "draw", "part2"];
const asSide = (v: unknown): Side | null => (typeof v === "string" && (SIDES as string[]).includes(v) ? (v as Side) : null);

/**
 * Registers the on-chain market routes. `deps` supplies live data (path + probability + discount)
 * from the SDK-backed layer so the dealer can quote and the resolver can find the touching tick.
 */
export function registerChainRoutes(
  app: FastifyInstance,
  deps: {
    getFixture: (id: number) => Promise<{ fixtureId: number; startTime: number; participant1: string; participant2: string; isFinal: boolean; finalP1?: number | null; finalP2?: number | null } | undefined>;
    pathFor: (id: number, asOf?: number, line?: number) => Promise<{ ts: number; messageId: string; part1: number; draw: number; part2: number }[]>;
    openingProbe: (path: { ts: number; part1: number; draw: number; part2: number }[], startTime: number) => { part1: number; draw: number; part2: number } | undefined;
    discount: () => number;
  },
) {
  const conn = connection();

  app.get("/api/chain/state", async () => {
    const state = readChainState();
    let ready = false;
    try { await ensureReady(conn); ready = true; } catch { /* not set up yet */ }
    return {
      programId: PROGRAM_ID.toBase58(),
      cluster: DEVNET_RPC.includes("127.0.0.1") ? "local" : "devnet",
      rpc: DEVNET_RPC,
      usdcMint: state?.usdcMint ?? null,
      betCapUsdc: (state?.betCap ?? 0) / 10 ** USDC_DECIMALS,
      ready,
    };
  });

  app.post<{ Body: { sessionId: string; label?: string; usdc?: number } }>("/api/faucet", async (req, reply) => {
    const { sessionId, label, usdc } = req.body ?? {};
    if (!sessionId) return reply.code(400).send({ error: "sessionId required" });
    const units = Math.round((usdc ?? 100) * 10 ** USDC_DECIMALS);
    try {
      const r = await faucet(sessionId, label ?? "you", units, conn);
      return { pubkey: r.pubkey, balanceUsdc: r.balance / 10 ** USDC_DECIMALS };
    } catch (e) { return reply.code(502).send({ error: String(e) }); }
  });

  app.get<{ Querystring: { sessionId: string } }>("/api/balance", async (req) => {
    const b = await balance(req.query.sessionId, conn).catch(() => 0);
    const sol = await sessionSol(req.query.sessionId, conn).catch(() => 0);
    return { balanceUsdc: b / 10 ** USDC_DECIMALS, balanceSol: sol };
  });

  /** Dealer quote — kind-aware (up/down/band/heartbreak/comeback), barriers gated per kind. */
  app.get<{ Querystring: { fixtureId: string; side: string; barrier: string; kind?: string; barrier2?: string; line?: string } }>(
    "/api/dealer/quote",
    async (req, reply) => {
      const f = await deps.getFixture(Number(req.query.fixtureId));
      if (!f) return reply.code(404).send({ error: "unknown fixture" });
      const side = asSide(req.query.side);
      if (!side) return reply.code(400).send({ error: "bad side" });
      const kind = asKind(req.query.kind);
      const line = req.query.line ? Number(req.query.line) : 0;
      if (line > 0 && side === "draw") return reply.code(400).send({ error: "this line has no draw side" });
      const path = await deps.pathFor(f.fixtureId, undefined, line);
      const open = deps.openingProbe(path, f.startTime);
      // current probability = latest tick's side value (live), else opening
      const pBps = Math.round((open?.[side] ?? 0) * 100);
      const barrierBps = Math.round(Number(req.query.barrier) * 100);
      const barrier2Bps = req.query.barrier2 !== undefined ? Math.round(Number(req.query.barrier2) * 100) : undefined;
      return dealerQuoteKind(kind, side, pBps, barrierBps, deps.discount(), { barrier2Bps });
    },
  );

  /** Place a bet at the current gated dealer quote (server prices + co-signs). Kind-aware. */
  app.post<{ Body: { sessionId: string; label?: string; fixtureId: number; side: string; barrier: number; barrier2?: number; kind?: string; usdc: number; epoch?: number; line?: number; bot?: boolean } }>(
    "/api/bet",
    async (req, reply) => {
      const { sessionId, label, fixtureId, usdc, bot, epoch } = req.body ?? ({} as any);
      const side = asSide(req.body?.side);
      if (!sessionId || !side || !fixtureId) return reply.code(400).send({ error: "sessionId, side, fixtureId required" });
      const kind = asKind(req.body?.kind);
      const f = await deps.getFixture(Number(fixtureId));
      if (!f) return reply.code(404).send({ error: "unknown fixture" });
      const line = req.body.line ?? 0;
      if (line > 0 && side === "draw") return reply.code(400).send({ error: "this line has no draw side" });
      const path = await deps.pathFor(f.fixtureId, undefined, line);
      const open = deps.openingProbe(path, f.startTime);
      const pBps = Math.round((open?.[side] ?? 0) * 100);
      const barrierBps = Math.round(req.body.barrier * 100);
      const barrier2Bps = req.body.barrier2 !== undefined ? Math.round(req.body.barrier2 * 100) : undefined;
      const q = dealerQuoteKind(kind, side, pBps, barrierBps, deps.discount(), { barrier2Bps });
      if (!q.valid) return reply.code(400).send({ error: q.reason });
      const capUsdc = (readChainState()?.betCap ?? 0) / 10 ** USDC_DECIMALS;
      const amount = Math.min(usdc ?? 5, capUsdc);
      const cutoffTs = Math.floor(Date.now() / 1000) + 86400; // demo/replay markets stay open 24h
      const venueP = Math.max(0.01, Math.min(0.99, pBps / 10000)); // hedge struck at the side's current win price
      try {
        const rec = await withRpcRetry(() => placeBet(sessionId, label ?? "you", f.fixtureId, side, barrierBps,
          Math.round(amount * 10 ** USDC_DECIMALS), q.priceBps, cutoffTs,
          { bot: !!bot, venueP, kind, barrier2Bps, epoch: epoch ?? 0, line }, conn));
        return {
          sig: rec.sig, marketKey: rec.marketKey, priceBps: q.priceBps, payoutMult: q.payoutMult,
          amountUsdc: amount, payoutUsdc: rec.payout / 10 ** USDC_DECIMALS, kind,
        };
      } catch (e) { return reply.code(502).send({ error: String(e) }); }
    },
  );

  /**
   * Resolve a market from the recorded path, anchoring REAL mainnet-verified evidence.
   * Kind-aware triggers:
   *   up          first tick ≥ B → YES; final without a touch → NO
   *   down        first tick ≤ B → YES; final without → NO
   *   band        RACE: first tick outside [L, U] decides — up-exit YES, down-exit NO;
   *               both outcomes carry a Merkle-provable tick (even NO is cryptographic)
   *   heartbreak  touch ≥ B AND final result = side did NOT win → YES
   *   comeback    touch ≤ B AND final result = side WON → YES
   */
  app.post<{ Params: { key: string } }>("/api/market/:key/resolve", async (req, reply) => {
    const lm = listLedgerMarkets().find((m) => m.key === req.params.key);
    if (!lm) return reply.code(404).send({ error: "unknown market" });
    if (lm.status !== "open") return reply.code(409).send({ error: `already ${lm.status}` });
    const f = await deps.getFixture(lm.fixtureId);
    if (!f) return reply.code(404).send({ error: "unknown fixture" });
    const kind = lm.kind ?? "up";
    const path = await deps.pathFor(lm.fixtureId, undefined, lm.line ?? 0);
    const inPlay = path.filter((t) => t.ts >= f.startTime);
    const bPct = lm.barrierBps / 100;
    const b2Pct = (lm.barrier2Bps ?? 0) / 100;

    /** side won at full time? (win-prob line terminates at 1 only on a win; draw counts as no-win) */
    const sideWon = (): boolean => {
      const p1 = f.finalP1 ?? 0, p2 = f.finalP2 ?? 0;
      if (lm.side === "part1") return p1 > p2;
      if (lm.side === "part2") return p2 > p1;
      return p1 === p2;
    };

    // find the deciding tick + provisional outcome per kind
    let hit: (typeof path)[number] | undefined;
    let outcome: "yes" | "no" | "pending" = "pending";
    if (kind === "up" || kind === "heartbreak") {
      hit = inPlay.find((t) => t[lm.side] >= bPct);
    } else if (kind === "down" || kind === "comeback") {
      hit = inPlay.find((t) => t[lm.side] <= bPct);
    } else {
      hit = inPlay.find((t) => t[lm.side] >= bPct || t[lm.side] <= b2Pct);
    }

    if (kind === "up" || kind === "down") {
      outcome = hit ? "yes" : f.isFinal ? "no" : "pending";
    } else if (kind === "band") {
      outcome = hit ? (hit[lm.side] >= bPct ? "yes" : "no") : f.isFinal ? "no" : "pending";
    } else if (kind === "heartbreak") {
      outcome = !hit ? (f.isFinal ? "no" : "pending") : f.isFinal ? (sideWon() ? "no" : "yes") : "pending";
    } else { // comeback
      outcome = !hit ? (f.isFinal ? "no" : "pending") : f.isFinal ? (sideWon() ? "yes" : "no") : "pending";
    }
    if (outcome === "pending") {
      return reply.code(409).send({ error: hit ? "trigger observed — awaiting the final result" : "no trigger yet and fixture not final" });
    }

    const touchFrac = hit ? hit[lm.side] / 100 : 0;
    try {
      if (hit) {
        // whichever way it resolves, the deciding tick is real — anchor its mainnet-verified proof
        const receipt = await receiptForTick(hit.messageId, hit.ts);
        const v = receipt.verification;
        const rootHash = v?.onChainRootHex ? [...Buffer.from(v.onChainRootHex.replace(/^0x/, ""), "hex").subarray(0, 32)] : [...Buffer.alloc(32)];
        const sig = await resolveMarketOnChain(lm.key, outcome === "yes", {
          messageId: hit.messageId, ts: hit.ts, probBps: Math.round(hit[lm.side] * 100),
          rootHash: rootHash.length === 32 ? rootHash : [...Buffer.alloc(32)],
          pda: v?.pda ?? "11111111111111111111111111111111",
        }, conn);
        const hedge = realizeHedge(lm.key, lm.barrierBps, outcome, touchFrac);
        return { outcome, sig, verified: receipt.verified, receipt, hedge, kind };
      }
      // no deciding tick — final-whistle attestation (nothing to prove; the claim pays 0)
      const sig = await resolveMarketOnChain(lm.key, false, {
        messageId: `final:${lm.fixtureId}`, ts: Date.now(), probBps: 0, rootHash: [...Buffer.alloc(32)],
        pda: "11111111111111111111111111111111",
      }, conn);
      const hedge = realizeHedge(lm.key, lm.barrierBps, "no", 0);
      return { outcome: "no", sig, hedge, kind };
    } catch (e) { return reply.code(502).send({ error: String(e) }); }
  });

  app.post<{ Body: { sig: string } }>("/api/claim", async (req, reply) => {
    const rec = activity(500).find((b) => b.sig === req.body?.sig);
    if (!rec) return reply.code(404).send({ error: "unknown bet" });
    try { return { sig: await claimBet(rec, conn) }; }
    catch (e) { return reply.code(502).send({ error: String(e) }); }
  });

  app.get("/api/activity", async () => activity(60).map(fmtBet));
  app.get<{ Querystring: { fixtureId?: string } }>("/api/onchain/markets", async (req) => {
    const fid = req.query.fixtureId ? Number(req.query.fixtureId) : undefined;
    const markets = listLedgerMarkets().filter((m) => fid === undefined || m.fixtureId === fid);
    return markets.map((m) => ({ ...m, bets: marketBets(m.key).map(fmtBet), treasury: treasury(m.key, m.barrierBps) }));
  });

  // ── parlays ────────────────────────────────────────────────────────────────

  interface ParlayLegBody { fixtureId: number; side: string; kind?: string; barrier: number; barrier2?: number }

  /** Quote a parlay: product of leg prices (each leg gated like a single). */
  const quoteParlayLegs = async (legs: ParlayLegBody[]) => {
    const out: { fixtureId: number; side: Side; kind: BetKind; barrierBps: number; barrier2Bps?: number; priceBps: number }[] = [];
    for (const leg of legs) {
      const side = asSide(leg.side);
      if (!side) return { error: "bad side" };
      const kind = asKind(leg.kind);
      const f = await deps.getFixture(Number(leg.fixtureId));
      if (!f) return { error: `unknown fixture ${leg.fixtureId}` };
      const path = await deps.pathFor(f.fixtureId);
      const open = deps.openingProbe(path, f.startTime);
      const pBps = Math.round((open?.[side] ?? 0) * 100);
      const barrierBps = Math.round(leg.barrier * 100);
      const barrier2Bps = leg.barrier2 !== undefined ? Math.round(leg.barrier2 * 100) : undefined;
      const q = dealerQuoteKind(kind, side, pBps, barrierBps, deps.discount(), { barrier2Bps });
      if (!q.valid) return { error: `leg ${f.fixtureId}/${side}: ${q.reason}` };
      out.push({ fixtureId: f.fixtureId, side, kind, barrierBps, barrier2Bps, priceBps: q.priceBps });
    }
    const combined = Math.max(100, Math.round(out.reduce((acc, l) => (acc * l.priceBps) / 10000, 10000)));
    return { legs: out, combinedPriceBps: combined, payoutMult: 10000 / combined };
  };

  app.post<{ Body: { legs: ParlayLegBody[] } }>("/api/parlay/quote", async (req, reply) => {
    const legs = req.body?.legs ?? [];
    if (legs.length < 2 || legs.length > 4) return reply.code(400).send({ error: "parlay needs 2-4 legs" });
    const q = await quoteParlayLegs(legs);
    if ("error" in q) return reply.code(400).send(q);
    return q;
  });

  app.post<{ Body: { sessionId: string; label?: string; usdc: number; legs: ParlayLegBody[] } }>("/api/parlay", async (req, reply) => {
    const { sessionId, label, usdc, legs } = req.body ?? ({} as any);
    if (!sessionId || !Array.isArray(legs)) return reply.code(400).send({ error: "sessionId + legs required" });
    if (legs.length < 2 || legs.length > 4) return reply.code(400).send({ error: "parlay needs 2-4 legs" });
    const q = await quoteParlayLegs(legs);
    if ("error" in q) return reply.code(400).send(q);
    const capUsdc = (readChainState()?.betCap ?? 0) / 10 ** USDC_DECIMALS;
    const amount = Math.min(usdc ?? 5, capUsdc);
    const cutoffTs = Math.floor(Date.now() / 1000) + 86400;
    try {
      const rec = await withRpcRetry(() => placeParlay(sessionId, label ?? "you", q.legs!, Math.round(amount * 10 ** USDC_DECIMALS), q.combinedPriceBps!, cutoffTs, conn));
      return {
        key: rec.key, sig: rec.sig, priceBps: rec.priceBps, payoutMult: 10000 / rec.priceBps,
        amountUsdc: amount, payoutUsdc: rec.payout / 10 ** USDC_DECIMALS,
        legs: rec.legs,
      };
    } catch (e) { return reply.code(502).send({ error: String(e) }); }
  });

  /** Claim a parlay — requires every leg resolved (resolve them via /api/market/:key/resolve first). */
  app.post<{ Params: { key: string } }>("/api/parlay/:key/claim", async (req, reply) => {
    const rec = listParlays().find((p) => p.key === req.params.key);
    if (!rec) return reply.code(404).send({ error: "unknown parlay" });
    const unresolved = rec.legs.filter((l) => listLedgerMarkets().find((m) => m.key === l.marketKey)?.status === "open");
    if (unresolved.length) return reply.code(409).send({ error: `${unresolved.length} leg(s) not resolved yet`, unresolved: unresolved.map((l) => l.marketKey) });
    try {
      const r = await withRpcRetry(() => claimParlay(rec, conn));
      return { sig: r.sig, outcome: r.allYes ? "yes" : "no", payoutUsdc: r.allYes ? rec.payout / 10 ** USDC_DECIMALS : 0 };
    } catch (e) { return reply.code(502).send({ error: String(e) }); }
  });

  app.get<{ Querystring: { sessionId?: string } }>("/api/parlays", async (req) =>
    listParlays(req.query.sessionId).map((p) => ({
      key: p.key, sig: p.sig, label: p.label, legs: p.legs, priceBps: p.priceBps,
      amountUsdc: p.amount / 10 ** USDC_DECIMALS, payoutUsdc: p.payout / 10 ** USDC_DECIMALS,
      ts: p.ts, claimed: p.claimed, outcome: p.outcome ?? null,
    })));

  /** The hedge book for one market — the offsetting win-share position + net-zero accounting. */
  app.get<{ Params: { key: string } }>("/api/treasury/:key", async (req, reply) => {
    const lm = listLedgerMarkets().find((m) => m.key === req.params.key);
    if (!lm) return reply.code(404).send({ error: "unknown market" });
    return treasury(lm.key, lm.barrierBps);
  });

  /** Platform-wide hedge book roll-up. */
  app.get("/api/treasury", async () => bookSummary());

  /** The latest realized hedge settlement — a real booked example for the white paper. */
  app.get("/api/hedge/latest-realized", async (req, reply) => {
    const r = latestRealized();
    if (!r) return reply.code(404).send({ error: "nothing settled yet" });
    return r;
  });
}

function fmtBet(b: import("./service.js").LedgerBet) {
  return {
    sig: b.sig, marketKey: b.marketKey, fixtureId: b.fixtureId, side: b.side, barrierBps: b.barrierBps,
    kind: b.kind ?? "up", barrier2Bps: b.barrier2Bps ?? null,
    label: b.label, bot: b.bot, ts: b.ts, claimed: b.claimed,
    amountUsdc: b.amount / 10 ** USDC_DECIMALS, priceBps: b.priceBps, payoutUsdc: b.payout / 10 ** USDC_DECIMALS,
    bettor: b.bettor,
  };
}
