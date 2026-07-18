import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { CHAIN_STATE, type ChainState, houseKeypair, connection, PROGRAM_ID } from "./config.js";
import { configPda } from "./program.js";

export const USDC_DECIMALS = 6;
export const SOL_DECIMALS = 9;
/** $10 cap in USDC base units (6dp). */
export const BET_CAP = 10 * 10 ** USDC_DECIMALS;

export function readChainState(): ChainState | null {
  try { return JSON.parse(readFileSync(CHAIN_STATE, "utf8")) as ChainState; } catch { return null; }
}
function writeChainState(s: ChainState): void {
  mkdirSync(dirname(CHAIN_STATE), { recursive: true });
  writeFileSync(CHAIN_STATE, JSON.stringify(s, null, 2), "utf8");
}

/**
 * One-time devnet setup: create mock USDC + SOL mints (mint authority = house, so the faucet has
 * unlimited supply), then persist addresses. Idempotent — reuses existing mints if present.
 */
export async function ensureChainSetup(conn?: Connection): Promise<ChainState> {
  const existing = readChainState();
  if (existing) return existing;
  const c = conn ?? connection();
  const house = houseKeypair();

  const usdcMint = await createMint(c, house, house.publicKey, null, USDC_DECIMALS);
  const solMint = await createMint(c, house, house.publicKey, null, SOL_DECIMALS);

  const state: ChainState = {
    programId: PROGRAM_ID.toBase58(),
    house: house.publicKey.toBase58(),
    usdcMint: usdcMint.toBase58(),
    solMint: solMint.toBase58(),
    configPda: configPda().toBase58(),
    betCap: BET_CAP,
  };
  writeChainState(state);
  return state;
}

/** Mint `amount` (base units) of a mock token to `owner`'s ATA — the faucet. Unlimited supply. */
export async function faucetMint(mint: PublicKey, owner: PublicKey, amount: number, conn?: Connection): Promise<string> {
  const c = conn ?? connection();
  const house = houseKeypair();
  const ata = await getOrCreateAssociatedTokenAccount(c, house, mint, owner);
  const sig = await mintTo(c, house, mint, ata.address, house, amount);
  return sig;
}

export async function tokenBalance(mint: PublicKey, owner: PublicKey, conn?: Connection): Promise<number> {
  const c = conn ?? connection();
  const house = houseKeypair();
  try {
    const ata = await getOrCreateAssociatedTokenAccount(c, house, mint, owner);
    const acct = await getAccount(c, ata.address);
    return Number(acct.amount);
  } catch { return 0; }
}

export { TOKEN_PROGRAM_ID };
