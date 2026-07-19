import { connection } from "./config.js";
import { readChainState, USDC_DECIMALS } from "./tokens.js";
import { balance, ensureReady, faucet, placeBet } from "./service.js";
import { dealerQuote } from "../dealer.js";
import type { Side } from "../model.js";

/**
 * A small fleet of autonomous bots that trade against the dealer on devnet (mock USDC). Each has
 * its own funded session wallet and a distinct strategy, so the activity feed and on-graph columns
 * show a live, adversarial-ish market rather than a single actor. Deterministic, not random —
 * strategies are pure functions of the current probability/barrier.
 */

interface BotDeps {
  getFixture: (id: number) => Promise<{ fixtureId: number; startTime: number; participant1: string; participant2: string; isFinal: boolean } | undefined>;
  pathFor: (id: number, asOf?: number) => Promise<{ ts: number; messageId: string; part1: number; draw: number; part2: number }[]>;
  openingProbe: (p: { ts: number; part1: number; draw: number; part2: number }[], s: number) => { part1: number; draw: number; part2: number } | undefined;
  discount: () => number;
}

interface Bot {
  id: string; label: string;
  /** pick a barrier offset (bps above current p) given the current probability — the bot's "appetite" */
  barrierOffset: (pBps: number) => number;
  stakeUsdc: number;
}

const FLEET: Bot[] = [
  { id: "bot-nearline", label: "NearLine", barrierOffset: () => 150, stakeUsdc: 4 },   // conservative, small touches
  { id: "bot-momentum", label: "Momentum", barrierOffset: (p) => Math.round(p * 0.15) + 200, stakeUsdc: 6 }, // scales with p
  { id: "bot-longshot", label: "LongShot", barrierOffset: () => 2500, stakeUsdc: 3 },   // far barriers, big payouts
  { id: "bot-quant",    label: "Quant",    barrierOffset: (p) => (p > 4000 ? 800 : 400), stakeUsdc: 8 },
];

/** Which fixtures the bots trade — prefer live, else the most-recent finished with an odds path. */
async function targetFixtures(deps: BotDeps): Promise<number[]> {
  // the semifinal is always a good demo target (rich path); plus the final/3rd-place if live
  const candidates = [18241006, 18202783, 18257739, 18257865];
  const out: number[] = [];
  for (const id of candidates) {
    const f = await deps.getFixture(id);
    if (f) out.push(id);
  }
  return out.slice(0, 2);
}

let running = false;
/** markets this process's bots already hold a ticket in — one open ticket per (bot, market) */
const placed = new Set<string>();
let cycle = 0;

const SIDES: Side[] = ["part1", "part2", "draw"];

export async function startBots(deps: BotDeps): Promise<void> {
  if (running) return;
  running = true;
  const conn = connection();
  await ensureReady(conn);
  // fund every bot with mock USDC up front
  for (const b of FLEET) {
    await faucet(b.id, b.label, 500 * 10 ** USDC_DECIMALS, conn).catch(() => {});
  }
  console.log(`[bots] ${FLEET.length} bots funded; trading loop starting`);

  const tick = async () => {
    cycle++;
    try {
      const fixtures = await targetFixtures(deps);
      for (const [fi, fixtureId] of fixtures.entries()) {
        const f = await deps.getFixture(fixtureId);
        if (!f) continue;
        const path = await deps.pathFor(fixtureId);
        const open = deps.openingProbe(path, f.startTime);
        // one bot acts per fixture per tick, staggered so different bots hit different fixtures
        const b = FLEET[(cycle + fi) % FLEET.length]!;

        // solvency: bots re-faucet themselves when they run low (mock USDC, zero real value)
        const bal = await balance(b.id, conn).catch(() => 0);
        if (bal < b.stakeUsdc * 10 ** USDC_DECIMALS) {
          await faucet(b.id, b.label, 500 * 10 ** USDC_DECIMALS, conn).catch(() => {});
          console.log(`[bots] ${b.label} re-fauceted (balance ran dry)`);
        }

        // side + barrier vary deterministically by cycle so the feed shows a real market,
        // not one actor re-betting one line forever
        const side = SIDES[(cycle * 2 + fi) % SIDES.length]!;
        const pBps = Math.round((open?.[side] ?? 0) * 100);
        if (pBps < 300) continue; // don't chase dead lines
        const jitter = ((cycle * 37) % 5) * 60 - 120; // −120..+120bps, deterministic
        const barrierBps = Math.max(500, Math.min(9500, pBps + b.barrierOffset(pBps) + jitter));
        const q = dealerQuote(side, pBps, barrierBps, deps.discount());
        if (!q.valid) continue;

        const dedupe = `${b.id}:${fixtureId}:${side}:${barrierBps}`;
        if (placed.has(dedupe)) continue; // already holds this exact ticket

        const cutoffTs = Math.floor(Date.now() / 1000) + 86400;
        await placeBet(b.id, b.label, fixtureId, side, barrierBps,
          Math.round(b.stakeUsdc * 10 ** USDC_DECIMALS), q.priceBps, cutoffTs,
          { bot: true, venueP: Math.max(0.01, Math.min(0.99, pBps / 10000)) }, conn)
          .then((r) => {
            placed.add(dedupe);
            console.log(`[bots] ${b.label} bet $${b.stakeUsdc} on ${side} touches ${barrierBps / 100}% @ ${(q.priceBps / 100).toFixed(1)}% (${r.sig.slice(0, 8)})`);
          })
          .catch((e) => console.log(`[bots] ${b.label} skip: ${String(e).slice(0, 200)}`));
      }
    } catch (e) {
      console.log("[bots] tick error:", String(e).slice(0, 200));
    }
  };
  void tick();
  setInterval(tick, 12_000);
}
