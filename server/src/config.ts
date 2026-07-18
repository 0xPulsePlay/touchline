import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Touchline reads the txline-explorer engine's corpus READ-ONLY and reuses its cached TxLINE
 * credentials READ-ONLY. It never writes to either — Touchline's own state lives in server/.data.
 */
const ENGINE_ROOT = resolve(here, "../../../txline-explorer");

function firstExisting(paths: string[]): string {
  for (const p of paths) if (existsSync(p)) return p;
  throw new Error(`none of the candidate paths exist:\n  ${paths.join("\n  ")}`);
}

export const config = {
  port: Number(process.env.TOUCHLINE_PORT ?? 4617),

  /** Engine SQLite corpus (117 fixtures / 5.5M odds ticks). Opened with {readonly: true}. */
  corpusDb: firstExisting([
    process.env.TOUCHLINE_CORPUS ?? "",
    resolve(ENGINE_ROOT, "apps/api/.data/txline.db"),
  ].filter(Boolean)),

  /** Cached TxLINE credentials (apiToken) — read-only reuse; guest JWT is refreshed per run. */
  tokenCache: resolve(ENGINE_ROOT, "apps/api/.cache/token.json"),

  txlineApiBase: process.env.TXLINE_API_BASE ?? "https://txline.txodds.com",

  /** Mainnet RPC for verifying odds proofs against the daily_batch_roots PDA (read-only). */
  rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",

  /** Touchline's own persistence (markets, calibration cache). */
  dataDir: resolve(here, "../.data"),
} as const;
