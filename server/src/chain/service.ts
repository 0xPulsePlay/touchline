import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, dirname as dn } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { connection, houseKeypair, DATA_DIR } from "./config.js";
import { ensureChainSetup, ensureAta, faucetMint, tokenBalance, readChainState, BET_CAP, USDC_DECIMALS } from "./tokens.js";
import { loadProgram, configPda, marketPda, vaultPda, betPda, parlayPda, parlayVaultPda, messageIdBytes, TOKEN_PROGRAM_ID, BN } from "./program.js";
import { ensureWallet, fundSol, getWallet, type SessionWallet } from "./wallets.js";
import { recordHedge } from "./hedge.js";
import { KIND_IDX, type BetKind } from "../dealer.js";
import type { Side } from "../model.js";

const LEDGER = resolve(DATA_DIR, "onchain-ledger.json");

const SIDE_IDX: Record<Side, number> = { part1: 0, draw: 1, part2: 2 };

/**
 * On-chain market identity. The program's market PDA seeds are (fixture_id: i64, side: u8,
 * barrier: u16). The program VALIDATES side ≤ 2 and 0 < barrier < 10000, but fixture_id is an
 * opaque i64 — so richer identity is encoded there without a program change:
 *   fid i64 = fixtureId | line<<32 | epoch<<40 | kind<<48
 * (line = probability series, epoch = re-run seed, kind = bet type). Max ≈ 2^50 — safe in JS
 * number space and in the i64 seed. The ledger keeps the decoded fields; the chain sees stable
 * unique seeds. Band markets carry the lower edge (barrier2) in the ledger + resolution evidence —
 * the chain's `barrier` is the upper edge.
 */
export const sideCode = (_kind: BetKind, side: Side): number => SIDE_IDX[side];
export const chainFid = (fixtureId: number, line = 0, epoch = 0, kind: BetKind = "up"): number =>
  fixtureId + line * 2 ** 32 + epoch * 2 ** 40 + KIND_IDX[kind] * 2 ** 48;

/**
 * Mint era: a byte derived from the current mock-USDC mint, folded into the epoch bits. A fresh
 * chain setup (new mint) automatically gets fresh market PDAs — old-era on-chain markets (older
 * mints, expired cutoffs) can never collide with today's demo. User-supplied epoch bumps on top
 * (re-runnable markets).
 */
function mintEra(): number {
  const s = readChainState();
  if (!s) return 0;
  return new PublicKey(s.usdcMint).toBytes()[0] ?? 0;
}
export const effectiveEpoch = (epoch = 0): number => (mintEra() + epoch) & 0xff;

export interface MarketOpts { kind?: BetKind; barrier2Bps?: number; line?: number; epoch?: number }

export interface LedgerMarket {
  key: string; fixtureId: number; side: Side; barrierBps: number; createdAt: number; status: "open" | "yes" | "no";
  kind?: BetKind; barrier2Bps?: number; line?: number; epoch?: number;
}
export interface LedgerBet {
  sig: string; marketKey: string; fixtureId: number; side: Side; barrierBps: number;
  bettor: string; label: string; bot: boolean; nonce: number;
  amount: number; priceBps: number; payout: number; ts: number; claimed: boolean;
  kind?: BetKind; barrier2Bps?: number; line?: number;
}
export interface ParlayLeg { marketKey: string; fixtureId: number; side: Side; kind: BetKind; barrierBps: number; barrier2Bps?: number; priceBps: number }
export interface LedgerParlay {
  key: string; sig: string; sessionId: string; label: string; bettor: string; nonce: number;
  legs: ParlayLeg[]; amount: number; priceBps: number; payout: number; ts: number;
  claimed: boolean; outcome?: "yes" | "no";
}
interface Ledger { markets: LedgerMarket[]; bets: LedgerBet[]; parlays?: LedgerParlay[] }

function loadLedger(): Ledger {
  try { return JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger; } catch { return { markets: [], bets: [] }; }
}
function saveLedger(l: Ledger): void { mkdirSync(dirname(LEDGER), { recursive: true }); writeFileSync(LEDGER, JSON.stringify(l, null, 2), "utf8"); }
let ledger = loadLedger();

export function activity(limit = 50): LedgerBet[] {
  return [...ledger.bets].sort((a, b) => b.ts - a.ts).slice(0, limit);
}
export function marketBets(marketKey: string): LedgerBet[] {
  return ledger.bets.filter((b) => b.marketKey === marketKey).sort((a, b) => a.ts - b.ts);
}
export function listLedgerMarkets(): LedgerMarket[] { return ledger.markets; }

let configReady = false;

/** Ensure mints exist and init_config has run (idempotent). Returns the mock USDC mint. */
export async function ensureReady(conn?: Connection): Promise<{ usdcMint: PublicKey; betCap: number }> {
  const c = conn ?? connection();
  const state = await ensureChainSetup(c);
  const { program } = loadProgram(c);
  const cfg = configPda();
  if (!configReady) {
    const acct = await c.getAccountInfo(cfg);
    if (!acct) {
      const house = houseKeypair();
      await program.methods.initConfig(house.publicKey, new BN(BET_CAP))
        .accounts({ admin: house.publicKey, config: cfg, systemProgram: SystemProgram.programId }).rpc();
    }
    // house needs a big tUSDC balance to cover liabilities
    await faucetMint(new PublicKey(state.usdcMint), house_pub(), 100_000 * 10 ** USDC_DECIMALS, c);
    configReady = true;
  }
  return { usdcMint: new PublicKey(state.usdcMint), betCap: BET_CAP };
}
function house_pub(): PublicKey { return houseKeypair().publicKey; }

/** Faucet mock USDC to a session wallet (creating + SOL-funding it if new). */
export async function faucet(sessionId: string, label: string, usdcUnits: number, conn?: Connection): Promise<{ pubkey: string; balance: number }> {
  const c = conn ?? connection();
  const { usdcMint } = await ensureReady(c);
  const w = await ensureWallet(sessionId, label, {}, c);
  await faucetMint(usdcMint, w.keypair.publicKey, usdcUnits, c);
  return { pubkey: w.keypair.publicKey.toBase58(), balance: await tokenBalance(usdcMint, w.keypair.publicKey, c) };
}

export async function balance(sessionId: string, conn?: Connection): Promise<number> {
  const c = conn ?? connection();
  const state = readChainState(); if (!state) return 0;
  const w = getWallet(sessionId); if (!w) return 0;
  return tokenBalance(new PublicKey(state.usdcMint), w.keypair.publicKey, c);
}

/** Session wallet's SOL balance (lamports → SOL). */
export async function sessionSol(sessionId: string, conn?: Connection): Promise<number> {
  const c = conn ?? connection();
  const w = getWallet(sessionId); if (!w) return 0;
  return (await c.getBalance(w.keypair.publicKey)) / 1e9;
}

/** Create the on-chain barrier market if it doesn't exist. Returns its PDA key. */
export async function ensureMarket(
  fixtureId: number, side: Side, barrierBps: number, cutoffTs: number,
  mOpts: MarketOpts = {}, conn?: Connection,
): Promise<string> {
  const c = conn ?? connection();
  const { usdcMint } = await ensureReady(c);
  const house = houseKeypair();
  const { program } = loadProgram(c, house);
  const kind = mOpts.kind ?? "up";
  const line = mOpts.line ?? 0;
  const epoch = effectiveEpoch(mOpts.epoch ?? 0); // mint-era folded in — no cross-era PDA reuse
  const code = sideCode(kind, side);
  const fid = chainFid(fixtureId, line, epoch, kind);
  const market = marketPda(fid, code, barrierBps);
  const key = market.toBase58();
  if (!(await c.getAccountInfo(market))) {
    const vault = vaultPda(market);
    await program.methods.createMarket(new BN(fid), code, barrierBps, new BN(cutoffTs))
      .accounts({
        house: house.publicKey, mint: usdcMint, market, vault,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
      }).rpc();
    ledger.markets.push({
      key, fixtureId, side, barrierBps, createdAt: Date.now(), status: "open",
      kind, barrier2Bps: mOpts.barrier2Bps, line, epoch,
    });
    saveLedger(ledger);
  }
  return key;
}

/** Place a co-signed fixed-odds bet (house + session both sign). Returns the tx signature. */
export async function placeBet(
  sessionId: string, label: string, fixtureId: number, side: Side, barrierBps: number,
  amountUnits: number, priceBps: number, cutoffTs: number,
  opts: { bot?: boolean; venueP?: number } & MarketOpts = {}, conn?: Connection,
): Promise<LedgerBet> {
  const c = conn ?? connection();
  const { usdcMint } = await ensureReady(c);
  const house = houseKeypair();
  const w = await ensureWallet(sessionId, label, { bot: opts.bot }, c);
  await fundSol(w.keypair.publicKey, Math.floor(0.05 * 1e9), c);
  const marketKey = await ensureMarket(fixtureId, side, barrierBps, cutoffTs,
    { kind: opts.kind, barrier2Bps: opts.barrier2Bps, line: opts.line, epoch: opts.epoch }, c);
  const market = new PublicKey(marketKey);
  const vault = vaultPda(market);
  const nonce = Date.now();
  const bet = betPda(market, w.keypair.publicKey, nonce);
  const userAta = await ensureAta(c, usdcMint, w.keypair.publicKey);
  const houseAta = await ensureAta(c, usdcMint, house.publicKey);
  const payout = Math.floor((amountUnits * 10000) / priceBps);

  const { program } = loadProgram(c, house);
  const sig = await program.methods.placeBet(new BN(nonce), new BN(amountUnits), priceBps)
    .accounts({
      user: w.keypair.publicKey, house: house.publicKey, config: configPda(), market, vault,
      userToken: userAta, houseToken: houseAta, bet,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([w.keypair, house]).rpc();

  const rec: LedgerBet = {
    sig, marketKey, fixtureId, side, barrierBps,
    bettor: w.keypair.publicKey.toBase58(), label, bot: !!opts.bot, nonce,
    amount: amountUnits, priceBps, payout, ts: Date.now(), claimed: false,
    kind: opts.kind ?? "up", barrier2Bps: opts.barrier2Bps, line: opts.line,
  };
  ledger.bets.push(rec);
  saveLedger(ledger);

  // hedge the ticket: take the kind-appropriate offsetting position (net-zero replication).
  // venueP = the side's current win probability p. When a caller omits it, reconstruct p from the
  // quoted price: price ≈ (p/B)·discount·spread ⟹ p ≈ price·B/discount (spread absorbed in the clamp).
  const venueP = opts.venueP
    ?? Math.max(0.01, Math.min(0.99, (priceBps / 10000) * (barrierBps / 10000) / 0.87));
  recordHedge({
    marketKey, betSig: sig, side, barrierBps, stakeUsdc: amountUnits / 1e6, payoutUsdc: payout / 1e6,
    venueP, kind: opts.kind ?? "up", barrier2Bps: opts.barrier2Bps,
  });
  return rec;
}

/** Resolve a market on-chain with verified evidence (YES) or the fixture-final attestation (NO). */
export async function resolveMarketOnChain(
  marketKey: string, outcome: boolean,
  evidence: { messageId: string; ts: number; probBps: number; rootHash: number[]; pda: string },
  conn?: Connection,
): Promise<string> {
  const c = conn ?? connection();
  const house = houseKeypair();
  const { program } = loadProgram(c, house);
  const market = new PublicKey(marketKey);
  const ev = {
    messageId: messageIdBytes(evidence.messageId),
    ts: new BN(evidence.ts),
    probBps: evidence.probBps,
    rootHash: evidence.rootHash.length === 32 ? evidence.rootHash : [...Buffer.alloc(32)],
    pda: new PublicKey(evidence.pda),
  };
  const sig = await program.methods.resolve(outcome, ev).accounts({ resolver: house.publicKey, config: configPda(), market }).rpc();
  const lm = ledger.markets.find((m) => m.key === marketKey);
  if (lm) { lm.status = outcome ? "yes" : "no"; saveLedger(ledger); }
  return sig;
}

/** Claim a winning bet's escrow to the winner. */
export async function claimBet(betRec: LedgerBet, conn?: Connection): Promise<string> {
  const c = conn ?? connection();
  const state = readChainState()!;
  const house = houseKeypair();
  const market = new PublicKey(betRec.marketKey);
  const w = getWallet(sessionIdForBettor(betRec.bettor));
  const claimant = w?.keypair ?? house;
  const lm = ledger.markets.find((m) => m.key === betRec.marketKey);
  const yes = lm?.status === "yes";
  const winnerOwner = yes ? new PublicKey(betRec.bettor) : house.publicKey;
  const winnerAta = await ensureAta(c, new PublicKey(state.usdcMint), winnerOwner);
  const { program } = loadProgram(c, house);
  const sig = await program.methods.claim()
    .accounts({
      claimant: claimant.publicKey, market, vault: vaultPda(market),
      bet: betPda(market, new PublicKey(betRec.bettor), betRec.nonce),
      winnerToken: winnerAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([claimant]).rpc();
  betRec.claimed = true; saveLedger(ledger);
  return sig;
}

function sessionIdForBettor(pubkey: string): string {
  const w = listWalletsByPubkey(pubkey);
  return w ?? "";
}
import { listWallets } from "./wallets.js";
function listWalletsByPubkey(pubkey: string): string | undefined {
  return listWallets().find((w) => w.keypair.publicKey.toBase58() === pubkey)?.id;
}

// ── parlays ─────────────────────────────────────────────────────────────────────────────────────

/** Place a co-signed parlay across 2–4 legs. Each leg's market is ensured on-chain first. */
export async function placeParlay(
  sessionId: string, label: string,
  legs: { fixtureId: number; side: Side; kind: BetKind; barrierBps: number; barrier2Bps?: number; priceBps: number }[],
  amountUnits: number, combinedPriceBps: number, cutoffTs: number, conn?: Connection,
): Promise<LedgerParlay> {
  const c = conn ?? connection();
  const { usdcMint } = await ensureReady(c);
  const house = houseKeypair();
  const w = await ensureWallet(sessionId, label, {}, c);
  await fundSol(w.keypair.publicKey, Math.floor(0.05 * 1e9), c);

  const legKeys: string[] = [];
  for (const leg of legs) {
    legKeys.push(await ensureMarket(leg.fixtureId, leg.side, leg.barrierBps, cutoffTs,
      { kind: leg.kind, barrier2Bps: leg.barrier2Bps }, c));
  }

  const nonce = Date.now();
  const parlay = parlayPda(w.keypair.publicKey, nonce);
  const vault = parlayVaultPda(parlay);
  const userAta = await ensureAta(c, usdcMint, w.keypair.publicKey);
  const houseAta = await ensureAta(c, usdcMint, house.publicKey);
  const payout = Math.floor((amountUnits * 10000) / combinedPriceBps);

  const { program } = loadProgram(c, house);
  const sig = await program.methods.placeParlay(new BN(nonce), new BN(amountUnits), combinedPriceBps, legs.length)
    .accounts({
      user: w.keypair.publicKey, house: house.publicKey, config: configPda(), mint: usdcMint,
      parlay, vault, userToken: userAta, houseToken: houseAta,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
    })
    .remainingAccounts(legKeys.map((k) => ({ pubkey: new PublicKey(k), isWritable: false, isSigner: false })))
    .signers([w.keypair, house]).rpc();

  const rec: LedgerParlay = {
    key: parlay.toBase58(), sig, sessionId, label, bettor: w.keypair.publicKey.toBase58(), nonce,
    legs: legs.map((l, i) => ({ marketKey: legKeys[i]!, fixtureId: l.fixtureId, side: l.side, kind: l.kind, barrierBps: l.barrierBps, barrier2Bps: l.barrier2Bps, priceBps: l.priceBps })),
    amount: amountUnits, priceBps: combinedPriceBps, payout, ts: Date.now(), claimed: false,
  };
  ledger.parlays = ledger.parlays ?? [];
  ledger.parlays.push(rec);
  saveLedger(ledger);

  // rolling hedge: the first leg carries the ticket's live exposure (documented approximation —
  // each touch rolls the position into the next leg)
  const first = rec.legs[0]!;
  recordHedge({
    marketKey: first.marketKey, betSig: sig, side: first.side, barrierBps: first.barrierBps,
    stakeUsdc: amountUnits / 1e6, payoutUsdc: (amountUnits / 1e6) * (10000 / first.priceBps),
    venueP: Math.max(0.01, Math.min(0.99, (first.priceBps / 10000) * (first.barrierBps / 10000) / 0.87)),
    kind: first.kind, barrier2Bps: first.barrier2Bps, venue: "parlay-rolling",
  });
  return rec;
}

/** Claim a parlay once every leg market is resolved on-chain. */
export async function claimParlay(rec: LedgerParlay, conn?: Connection): Promise<{ sig: string; allYes: boolean }> {
  const c = conn ?? connection();
  const state = readChainState()!;
  const house = houseKeypair();
  const allYes = rec.legs.every((l) => ledger.markets.find((m) => m.key === l.marketKey)?.status === "yes");
  const winnerOwner = allYes ? new PublicKey(rec.bettor) : house.publicKey;
  const winnerAta = await ensureAta(c, new PublicKey(state.usdcMint), winnerOwner);
  const w = getWallet(rec.sessionId);
  const claimant = w?.keypair ?? house;
  const parlay = new PublicKey(rec.key);
  const { program } = loadProgram(c, house);
  const sig = await program.methods.claimParlay()
    .accounts({
      claimant: claimant.publicKey, parlay, vault: parlayVaultPda(parlay),
      winnerToken: winnerAta, tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(rec.legs.map((l) => ({ pubkey: new PublicKey(l.marketKey), isWritable: false, isSigner: false })))
    .signers([claimant]).rpc();
  rec.claimed = true;
  rec.outcome = allYes ? "yes" : "no";
  saveLedger(ledger);
  return { sig, allYes };
}

export function listParlays(sessionId?: string): LedgerParlay[] {
  const all = ledger.parlays ?? [];
  return sessionId ? all.filter((p) => p.sessionId === sessionId) : all;
}

export { SIDE_IDX };
