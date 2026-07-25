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

/** Keep the demo payer comfortably above market/vault rent; devnet SOL has no real-world value. */
export const HOUSE_SOL_RESERVE_LAMPORTS = Math.floor(0.1 * LAMPORTS_PER_SOL);
export const HOUSE_SOL_TARGET_LAMPORTS = 2 * LAMPORTS_PER_SOL;
/** Covers a parlay account + vault (~0.0048 SOL) with room for another placement. */
export const SESSION_SOL_TARGET_LAMPORTS = Math.floor(0.01 * LAMPORTS_PER_SOL);

let houseSolRefill: Promise<number> | null = null;

export function houseAirdropLamports(balance: number, minimum: number): number {
  if (balance >= minimum) return 0;
  return Math.max(1, Math.ceil(Math.max(HOUSE_SOL_TARGET_LAMPORTS, minimum) - balance));
}

export function recyclableSessionLamports(balance: number): number {
  return Math.max(0, balance - SESSION_SOL_TARGET_LAMPORTS);
}

/**
 * The server owns every demo session keypair and originally funded them from the house. If the
 * public faucet is rate-limited, return their unused excess to the shared payer in small batches.
 */
async function recycleSessionSol(c: Connection, house: Keypair): Promise<number> {
  const wallets = Object.values(store).map((w) => Keypair.fromSecretKey(Uint8Array.from(w.secret)));
  const infos = await c.getMultipleAccountsInfo(wallets.map((w) => w.publicKey), "confirmed");
  const donors = wallets.flatMap((wallet, i) => {
    const lamports = recyclableSessionLamports(infos[i]?.lamports ?? 0);
    return lamports > 0 ? [{ wallet, lamports }] : [];
  });

  // Three transfer authorities per transaction stays comfortably below Solana's packet limit.
  for (let i = 0; i < donors.length; i += 3) {
    const batch = donors.slice(i, i + 3);
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: house.publicKey, blockhash, lastValidBlockHeight });
    for (const donor of batch) {
      tx.add(SystemProgram.transfer({
        fromPubkey: donor.wallet.publicKey,
        toPubkey: house.publicKey,
        lamports: donor.lamports,
      }));
    }
    await sendAndConfirmTransaction(
      c, tx, [house, ...batch.map((d) => d.wallet)], { commitment: "confirmed" },
    );
  }
  return c.getBalance(house.publicKey, "confirmed");
}

/**
 * Refill the house from the devnet faucet before it pays transaction fees, account rent, or funds
 * a custodial session. Calls share one in-flight airdrop so concurrent bot/user placements cannot
 * trigger an airdrop storm.
 */
export async function ensureHouseSol(
  minimum = HOUSE_SOL_RESERVE_LAMPORTS, conn?: Connection,
): Promise<number> {
  const c = conn ?? connection();
  const house = houseKeypair();
  const current = await c.getBalance(house.publicKey, "confirmed");
  if (current >= minimum) return current;

  if (!houseSolRefill) {
    houseSolRefill = (async () => {
      const before = await c.getBalance(house.publicKey, "confirmed");
      const amount = houseAirdropLamports(before, minimum);
      if (amount === 0) return before;
      try {
        const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
        const signature = await c.requestAirdrop(house.publicKey, amount);
        const confirmation = await c.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight }, "confirmed",
        );
        if (confirmation.value.err) {
          throw new Error(`airdrop transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }
        return c.getBalance(house.publicKey, "confirmed");
      } catch (airdropError) {
        const recycled = await recycleSessionSol(c, house);
        if (recycled >= minimum) return recycled;
        throw new Error(
          `devnet payer refill failed (${String(airdropError)}); only `
          + `${(recycled / LAMPORTS_PER_SOL).toFixed(4)} SOL could be recycled`,
        );
      }
    })();
  }

  try {
    const funded = await houseSolRefill;
    if (funded < minimum) {
      throw new Error(
        `devnet house wallet has only ${(funded / LAMPORTS_PER_SOL).toFixed(4)} SOL after refill`,
      );
    }
    return funded;
  } finally {
    houseSolRefill = null;
  }
}

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
  await fundSol(kp.publicKey, opts.solLamports ?? SESSION_SOL_TARGET_LAMPORTS, conn);
  return toSession(id, store[id]!);
}

/** Send SOL from the house to a wallet (devnet airdrop is unreliable; house funds instead). */
export async function fundSol(to: PublicKey, lamports: number, conn?: Connection): Promise<void> {
  const c = conn ?? connection();
  const house = houseKeypair();
  const bal = await c.getBalance(to);
  if (bal >= lamports) return;
  const shortfall = lamports - bal;
  await ensureHouseSol(HOUSE_SOL_RESERVE_LAMPORTS + shortfall + 10_000, c);
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: house.publicKey, blockhash, lastValidBlockHeight })
    .add(SystemProgram.transfer({ fromPubkey: house.publicKey, toPubkey: to, lamports: shortfall }));
  await sendAndConfirmTransaction(c, tx, [house], { commitment: "confirmed" });
}

export function _reset(): void { store = {}; save(store); }
