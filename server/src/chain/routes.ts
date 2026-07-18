import type { FastifyInstance } from "fastify";
import { connection, PROGRAM_ID, DEVNET_RPC } from "./config.js";
import { readChainState, USDC_DECIMALS } from "./tokens.js";
import {
  ensureReady, faucet, balance, ensureMarket, placeBet, resolveMarketOnChain, claimBet,
  activity, marketBets, listLedgerMarkets, SIDE_IDX,
} from "./service.js";
import { receiptForTick } from "../proofs.js";
import { dealerQuote } from "../dealer.js";
import { treasury, realizeHedge, bookSummary } from "./hedge.js";
import type { Side } from "../model.js";

const SIDES: Side[] = ["part1", "draw", "part2"];
const asSide = (v: unknown): Side | null => (typeof v === "string" && (SIDES as string[]).includes(v) ? (v as Side) : null);

/**
 * Registers the on-chain market routes. `deps` supplies live data (path + probability + discount)
 * from the SDK-backed layer so the dealer can quote and the resolver can find the touching tick.
 */
export function registerChainRoutes(
  app: FastifyInstance,
  deps: {
    getFixture: (id: number) => Promise<{ fixtureId: number; startTime: number; participant1: string; participant2: string; isFinal: boolean } | undefined>;
    pathFor: (id: number, asOf?: number) => Promise<{ ts: number; messageId: string; part1: number; draw: number; part2: number }[]>;
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
    return { balanceUsdc: b / 10 ** USDC_DECIMALS };
  });

  /** Dealer quote — barrier gated to ≥ current probability + step. */
  app.get<{ Querystring: { fixtureId: string; side: string; barrier: string } }>("/api/dealer/quote", async (req, reply) => {
    const f = await deps.getFixture(Number(req.query.fixtureId));
    if (!f) return reply.code(404).send({ error: "unknown fixture" });
    const side = asSide(req.query.side);
    if (!side) return reply.code(400).send({ error: "bad side" });
    const path = await deps.pathFor(f.fixtureId);
    const open = deps.openingProbe(path, f.startTime);
    // current probability = latest tick's side value (live), else opening
    const pBps = Math.round((open?.[side] ?? 0) * 100);
    const barrierBps = Math.round(Number(req.query.barrier) * 100);
    return dealerQuote(side, pBps, barrierBps, deps.discount());
  });

  /** Place a bet at the current gated dealer quote (server prices + co-signs). */
  app.post<{ Body: { sessionId: string; label?: string; fixtureId: number; side: string; barrier: number; usdc: number; bot?: boolean } }>(
    "/api/bet",
    async (req, reply) => {
      const { sessionId, label, fixtureId, usdc, bot } = req.body ?? ({} as any);
      const side = asSide(req.body?.side);
      if (!sessionId || !side || !fixtureId) return reply.code(400).send({ error: "sessionId, side, fixtureId required" });
      const f = await deps.getFixture(Number(fixtureId));
      if (!f) return reply.code(404).send({ error: "unknown fixture" });
      const path = await deps.pathFor(f.fixtureId);
      const open = deps.openingProbe(path, f.startTime);
      const pBps = Math.round((open?.[side] ?? 0) * 100);
      const barrierBps = Math.round(req.body.barrier * 100);
      const q = dealerQuote(side, pBps, barrierBps, deps.discount());
      if (!q.valid) return reply.code(400).send({ error: q.reason });
      const capUsdc = (readChainState()?.betCap ?? 0) / 10 ** USDC_DECIMALS;
      const amount = Math.min(usdc ?? 5, capUsdc);
      const cutoffTs = Math.floor(Date.now() / 1000) + 86400; // demo/replay markets stay open 24h
      const venueP = Math.max(0.01, Math.min(0.99, pBps / 10000)); // hedge struck at the side's current win price
      try {
        const rec = await placeBet(sessionId, label ?? "you", f.fixtureId, side, barrierBps,
          Math.round(amount * 10 ** USDC_DECIMALS), q.priceBps, cutoffTs, { bot: !!bot, venueP }, conn);
        return {
          sig: rec.sig, marketKey: rec.marketKey, priceBps: q.priceBps, payoutMult: q.payoutMult,
          amountUsdc: amount, payoutUsdc: rec.payout / 10 ** USDC_DECIMALS,
        };
      } catch (e) { return reply.code(502).send({ error: String(e) }); }
    },
  );

  /** Resolve a market from the recorded path, anchoring REAL mainnet-verified evidence for YES. */
  app.post<{ Params: { key: string } }>("/api/market/:key/resolve", async (req, reply) => {
    const lm = listLedgerMarkets().find((m) => m.key === req.params.key);
    if (!lm) return reply.code(404).send({ error: "unknown market" });
    if (lm.status !== "open") return reply.code(409).send({ error: `already ${lm.status}` });
    const f = await deps.getFixture(lm.fixtureId);
    if (!f) return reply.code(404).send({ error: "unknown fixture" });
    const path = await deps.pathFor(lm.fixtureId);
    const barrierPct = lm.barrierBps / 100;
    const hit = path.find((t) => t.ts >= f.startTime && t[lm.side] >= barrierPct);
    try {
      if (hit) {
        const receipt = await receiptForTick(hit.messageId, hit.ts);
        const v = receipt.verification;
        const rootHash = v?.onChainRootHex ? [...Buffer.from(v.onChainRootHex.replace(/^0x/, ""), "hex").subarray(0, 32)] : [...Buffer.alloc(32)];
        const sig = await resolveMarketOnChain(lm.key, true, {
          messageId: hit.messageId, ts: hit.ts, probBps: Math.round(hit[lm.side] * 100),
          rootHash: rootHash.length === 32 ? rootHash : [...Buffer.alloc(32)],
          pda: v?.pda ?? "11111111111111111111111111111111",
        }, conn);
        // realize the hedge: win-shares liquidate at the touching probability (≥ B, captures overshoot).
        // path values are percentages (0..100); realizeHedge wants a fraction.
        const hedge = realizeHedge(lm.key, lm.barrierBps, "yes", hit[lm.side] / 100);
        return { outcome: "yes", sig, verified: receipt.verified, receipt, hedge };
      }
      if (!f.isFinal) return reply.code(409).send({ error: "no touch yet and fixture not final" });
      const sig = await resolveMarketOnChain(lm.key, false, {
        messageId: `final:${lm.fixtureId}`, ts: Date.now(), probBps: 0, rootHash: [...Buffer.alloc(32)],
        pda: "11111111111111111111111111111111",
      }, conn);
      const hedge = realizeHedge(lm.key, lm.barrierBps, "no", 0);
      return { outcome: "no", sig, hedge };
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

  /** The hedge book for one market — the offsetting win-share position + net-zero accounting. */
  app.get<{ Params: { key: string } }>("/api/treasury/:key", async (req, reply) => {
    const lm = listLedgerMarkets().find((m) => m.key === req.params.key);
    if (!lm) return reply.code(404).send({ error: "unknown market" });
    return treasury(lm.key, lm.barrierBps);
  });

  /** Platform-wide hedge book roll-up. */
  app.get("/api/treasury", async () => bookSummary());
}

function fmtBet(b: import("./service.js").LedgerBet) {
  return {
    sig: b.sig, marketKey: b.marketKey, fixtureId: b.fixtureId, side: b.side, barrierBps: b.barrierBps,
    label: b.label, bot: b.bot, ts: b.ts, claimed: b.claimed,
    amountUsdc: b.amount / 10 ** USDC_DECIMALS, priceBps: b.priceBps, payoutUsdc: b.payout / 10 ** USDC_DECIMALS,
    bettor: b.bettor,
  };
}
