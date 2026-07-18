import { verifyOddsProofOnChain, type OddsProofVerification } from "@txline/verify";
import type { OddsProof } from "@txline/verify";
import { txlineGet } from "./creds.js";
import { config } from "./config.js";

export interface ProofReceipt {
  /** whether the proof chained all the way to the Solana-anchored root */
  verified: boolean;
  fetchedAt: number;
  /** which tick this receipt attests */
  messageId: string;
  ts: number;
  verification: OddsProofVerification | null;
  /** raw proof (kept so the UI can render the full Merkle chain) */
  proof: OddsProof | null;
  error: string | null;
}

/**
 * Fetch the Merkle proof for one odds tick from TxLINE and verify it client-side against the
 * mainnet `daily_batch_roots` PDA (read-only RPC). This is the market's settlement evidence.
 */
export async function receiptForTick(messageId: string, ts: number): Promise<ProofReceipt> {
  const base: Omit<ProofReceipt, "verification" | "proof" | "error" | "verified"> = {
    fetchedAt: Date.now(),
    messageId,
    ts,
  };
  try {
    const proof = (await txlineGet(
      `/api/odds/validation?messageId=${encodeURIComponent(messageId)}&ts=${ts}`,
    )) as OddsProof;
    if (!proof || !proof.odds || !proof.summary) {
      return { ...base, verified: false, verification: null, proof: null, error: "empty proof response" };
    }
    const verification = await verifyOddsProofOnChain(config.rpcUrl, proof);
    return { ...base, verified: verification.verified, verification, proof, error: null };
  } catch (e) {
    return {
      ...base,
      verified: false,
      verification: null,
      proof: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
