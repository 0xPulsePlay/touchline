import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const here = dirname(fileURLToPath(import.meta.url));

/** touchline-market devnet program (SPL dealer escrow). SAFETY: devnet + mock tokens only. */
export const PROGRAM_ID = new PublicKey("6kZYYdZLJcsU2ZBKKthc7BpddUiYdTbAtGigS2bJc53K");
export const DEVNET_RPC = process.env.TOUCHLINE_DEVNET_RPC ?? "https://api.devnet.solana.com";

/** The house = resolver = mint authority. Reuses the funded devnet deploy authority (5nBA87…). */
export function houseKeypair(): Keypair {
  const path = process.env.TOUCHLINE_HOUSE_KEYPAIR
    ?? resolve(process.env.HOME ?? "", ".config/solana/pulseplay-deploy-authority.json");
  const secret = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function connection(): Connection {
  return new Connection(DEVNET_RPC, "confirmed");
}

/** Where mint/config addresses are persisted after one-time setup. */
/** Shared writable data dir (verified working) — all chain persistence uses this to avoid path drift. */
export const DATA_DIR = resolve(here, "../../.data");
export const CHAIN_STATE = resolve(DATA_DIR, "chain.json");
/** IDL path (anchor 1.1.2 format, discriminators embedded). */
export const IDL_PATH = resolve(here, "../../../onchain/touchline_market.json");

export interface ChainState {
  programId: string;
  house: string;
  usdcMint: string;
  solMint: string;
  configPda: string;
  betCap: number; // base units of USDC (6dp)
}
