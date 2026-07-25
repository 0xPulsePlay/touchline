import { describe, expect, it } from "vitest";
import { MARKET_REUSE_BUFFER_SECONDS, marketCanAcceptBets } from "./service.js";
import {
  HOUSE_SOL_RESERVE_LAMPORTS,
  HOUSE_SOL_TARGET_LAMPORTS,
  SESSION_SOL_TARGET_LAMPORTS,
  houseAirdropLamports,
  recyclableSessionLamports,
} from "./wallets.js";

describe("market reuse", () => {
  const now = 1_800_000_000;

  it("reuses an open on-chain market with enough placement time remaining", () => {
    expect(marketCanAcceptBets(0, now + MARKET_REUSE_BUFFER_SECONDS + 1, now)).toBe(true);
  });

  it("does not trust an open ledger row after the on-chain cutoff", () => {
    expect(marketCanAcceptBets(0, now - 1, now)).toBe(false);
  });

  it("does not reuse a market too close to cutoff", () => {
    expect(marketCanAcceptBets(0, now + MARKET_REUSE_BUFFER_SECONDS, now)).toBe(false);
  });

  it("does not reuse a resolved market or a market from another mint/house era", () => {
    expect(marketCanAcceptBets(1, now + 86_400, now)).toBe(false);
    expect(marketCanAcceptBets(2, now + 86_400, now)).toBe(false);
    expect(marketCanAcceptBets(0, now + 86_400, now, false)).toBe(false);
  });
});

describe("devnet house funding", () => {
  it("does not request an airdrop while the rent reserve is healthy", () => {
    expect(houseAirdropLamports(HOUSE_SOL_RESERVE_LAMPORTS, HOUSE_SOL_RESERVE_LAMPORTS)).toBe(0);
  });

  it("refills a depleted payer to the target balance", () => {
    const balance = 2_193_120;
    expect(houseAirdropLamports(balance, HOUSE_SOL_RESERVE_LAMPORTS))
      .toBe(HOUSE_SOL_TARGET_LAMPORTS - balance);
  });

  it("recycles only the SOL above a session's placement reserve", () => {
    expect(recyclableSessionLamports(SESSION_SOL_TARGET_LAMPORTS)).toBe(0);
    expect(recyclableSessionLamports(48_357_440)).toBe(48_357_440 - SESSION_SOL_TARGET_LAMPORTS);
  });
});
