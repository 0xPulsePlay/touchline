import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { getFixture, listFixtures, openingProbe, pathFor, timelineFor } from "./platform.js";
import { SIDES, type Side } from "./model.js";
import { quoteTouch, touchBound } from "./pricing.js";
import { firstTouch, maxPct } from "./touch.js";
import { createMarket, getMarket, listMarkets, poolImpliedYes, poolTotals, resolveMarket, stake } from "./markets.js";
import { receiptForTick } from "./proofs.js";
import { loadOrComputeCalibration, pricingDiscount } from "./calibration.js";

const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true, methods: ["GET", "POST"] });

/** Calibration is corpus-wide and cached; the pricing discount derives from it. */
let calibration = loadOrComputeCalibration();
let discount = pricingDiscount(calibration);

const asSide = (v: unknown): Side | null =>
  typeof v === "string" && (SIDES as string[]).includes(v) ? (v as Side) : null;

app.get("/health", async () => ({ ok: true, corpus: config.corpusDb, discount }));

app.get("/api/fixtures", async () => listFixtures());

/**
 * Downsampled path for charts + full-precision opening probe. `every` thins ticks for the wire.
 * `asOf` truncates EVERYTHING (ticks, transitions, clock) to that instant — live and simulated
 * consumers see exactly what was knowable then; the server does not leak the future.
 */
app.get<{ Params: { id: string }; Querystring: { every?: string; asOf?: string } }>(
  "/api/fixtures/:id/path",
  async (req, reply) => {
    const f = await getFixture(Number(req.params.id));
    if (!f) return reply.code(404).send({ error: "unknown fixture" });
    const asOf = req.query.asOf ? Number(req.query.asOf) : undefined;
    const path = await pathFor(f.fixtureId, asOf);
    const every = Math.max(1, Number(req.query.every ?? 5));
    const thin = path.filter((_, i) => i % every === 0 || i === path.length - 1);
    const open = openingProbe(path, f.startTime);
    const lastTs = path.length ? path[path.length - 1]!.ts : f.startTime;
    const timeline = await timelineFor(f.fixtureId, lastTs, { asOf, startTimeHint: f.startTime });
    return {
      fixture: f,
      opening: open,
      tickCount: path.length,
      asOf: asOf ?? null,
      timeline,
      path: thin.map((t) => ({ ts: t.ts, part1: t.part1, draw: t.draw, part2: t.part2 })),
    };
  },
);

/** Live quote for a prospective market. p0 comes from the kickoff-anchored opening probe. */
app.get<{ Params: { id: string }; Querystring: { side: string; barrier: string } }>(
  "/api/fixtures/:id/quote",
  async (req, reply) => {
    const f = await getFixture(Number(req.params.id));
    if (!f) return reply.code(404).send({ error: "unknown fixture" });
    const side = asSide(req.query.side);
    if (!side) return reply.code(400).send({ error: "side must be part1|draw|part2" });
    const barrier = Number(req.query.barrier);
    if (!(barrier > 0 && barrier < 100)) return reply.code(400).send({ error: "barrier in (0,100)" });
    const path = await pathFor(f.fixtureId);
    const open = openingProbe(path, f.startTime);
    if (!open) return reply.code(409).send({ error: "no odds path for fixture" });
    const p0 = open[side] / 100;
    const q = quoteTouch(p0, barrier / 100, discount);
    return {
      side,
      barrier,
      p0: open[side],
      bound: q.bound,
      discount: q.discount,
      fair: q.fair,
      maxObserved: maxPct(path, side, f.startTime),
    };
  },
);

app.get<{ Querystring: { fixtureId?: string } }>("/api/markets", async (req) => {
  const ms = listMarkets(req.query.fixtureId ? Number(req.query.fixtureId) : undefined);
  return ms.map((m) => ({ ...m, pools: poolTotals(m), poolImpliedYes: poolImpliedYes(m) }));
});

app.post<{ Body: { fixtureId: number; side: string; barrier: number } }>("/api/markets", async (req, reply) => {
  const { fixtureId, barrier } = req.body;
  const side = asSide(req.body.side);
  if (!side) return reply.code(400).send({ error: "side must be part1|draw|part2" });
  const f = await getFixture(Number(fixtureId));
  if (!f) return reply.code(404).send({ error: "unknown fixture" });
  const path = await pathFor(f.fixtureId);
  const open = openingProbe(path, f.startTime);
  if (!open) return reply.code(409).send({ error: "no odds path" });
  const p0 = open[side] / 100;
  const q = quoteTouch(p0, barrier / 100, discount);
  const m = createMarket({
    kind: "one_touch",
    fixtureId: f.fixtureId,
    side,
    barrierPct: barrier,
    quoteAtCreate: { p0: open[side], bound: q.bound, fair: q.fair },
  });
  return { ...m, pools: poolTotals(m), poolImpliedYes: poolImpliedYes(m) };
});

app.post<{ Params: { id: string }; Body: { bettor: string; side: "yes" | "no"; amount: number } }>(
  "/api/markets/:id/stake",
  async (req, reply) => {
    try {
      const m = stake(req.params.id, req.body);
      return { ...m, pools: poolTotals(m), poolImpliedYes: poolImpliedYes(m) };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  },
);

/**
 * Resolve a one-touch market from the recorded path:
 *  - a touching tick exists  → YES, with the tick as evidence + a Merkle proof receipt verified
 *    against the mainnet daily_batch_roots PDA (read-only RPC);
 *  - the fixture is final and no tick ever touched → NO.
 */
app.post<{ Params: { id: string } }>("/api/markets/:id/resolve", async (req, reply) => {
  const m = getMarket(req.params.id);
  if (!m) return reply.code(404).send({ error: "unknown market" });
  if (m.status !== "open") return reply.code(409).send({ error: `already ${m.status}` });
  const f = await getFixture(m.fixtureId);
  if (!f) return reply.code(404).send({ error: "unknown fixture" });
  const path = await pathFor(m.fixtureId);
  const hit = firstTouch(path, m.side, m.barrierPct, f.startTime);
  if (hit) {
    const receipt = await receiptForTick(hit.messageId, hit.ts);
    const resolved = resolveMarket(m.id, "yes", { messageId: hit.messageId, ts: hit.ts, pct: hit.pct }, receipt);
    return { ...resolved, pools: poolTotals(resolved) };
  }
  if (!f.isFinal) return reply.code(409).send({ error: "no touch yet and fixture not final — market stays open" });
  const resolved = resolveMarket(m.id, "no");
  return { ...resolved, pools: poolTotals(resolved) };
});

app.get("/api/calibration", async () => calibration);

app.post("/api/calibration/refresh", async () => {
  calibration = loadOrComputeCalibration(0);
  discount = pricingDiscount(calibration);
  return { generatedAt: calibration.generatedAt, discount };
});

app
  .listen({ port: config.port, host: "127.0.0.1" })
  .then(() => app.log.info(`touchline api on :${config.port}, corpus=${config.corpusDb}`))
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
