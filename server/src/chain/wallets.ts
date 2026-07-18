import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, dirname as dn } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { houseKeypair, connection, DATA_DIR } from "./config.js";

/**
 * Custodial session wallets — DEVNET MOCK DEMO ONLY. To make the browser flow frictionless (users
 * don't need devnet SOL or to approve every escrow tx), each session/bot gets a server-held keypair
 * funded from the house. The connected Phantom pubkey is recorded as identity; the on-chain actor
 * is this funded session wallet. Zero real value — mock SPL tokens on devnet.
 */
const FILE = resolve(DATA_DIR, "wallets.json");

interface StoredWallet { label: string; pubkey: string; secret: number[]; bot: boolean; createdAt: number }

function load(): Record<string, StoredWallet> {
  try { return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, StoredWallet>; } catch { return {}; }
}
function save(all: Record<string, StoredWallet>): void {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(all, null, 2), "utf8");
}

let store = load();

export interface SessionWallet { id: string; label: string; keypair: Keypair; bot: boolean }

function toSession(id: string, w: StoredWallet): SessionWallet {
  return { id, label: w.label, keypair: Keypair.fromSecretKey(Uint8Array.from(w.secret)), bot: w.bot };
}

export function getWallet(id: string): SessionWallet | undefined {
  const w = store[id];
  return w ? toSession(id, w) : undefined;
}

export function listWallets(): SessionWallet[] {
  return Object.entries(store).map(([id, w]) => toSession(id, w));
}

/** Create (or return) a session wallet by id, funding it with SOL so it can pay bet-account rent. */
export async function ensureWallet(id: string, label: string, opts: { bot?: boolean; solLamports?: number } = {}, conn?: Connection): Promise<SessionWallet> {
  const existing = store[id];
  if (existing) return toSession(id, existing);
  const kp = Keypair.generate();
  store[id] = { label, pubkey: kp.publicKey.toBase58(), secret: [...kp.secretKey], bot: !!opts.bot, createdAt: Date.now() };
  save(store);
  await fundSol(kp.publicKey, opts.solLamports ?? Math.floor(0.03 * LAMPORTS_PER_SOL), conn);
  return toSession(id, store[id]!);
}

/** Send SOL from the house to a wallet (devnet airdrop is unreliable; house funds instead). */
export async function fundSol(to: PublicKey, lamports: number, conn?: Connection): Promise<void> {
  const c = conn ?? connection();
  const house = houseKeypair();
  const bal = await c.getBalance(to);
  if (bal >= lamports) return;
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: house.publicKey, blockhash, lastValidBlockHeight })
    .add(SystemProgram.transfer({ fromPubkey: house.publicKey, toPubkey: to, lamports: lamports - bal }));
  await sendAndConfirmTransaction(c, tx, [house], { commitment: "confirmed" });
}

export function _reset(): void { store = {}; save(store); }
