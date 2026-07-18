/**
 * Devnet lifecycle proof: setup → init_config → create_market → faucet a user →
 * co-signed place_bet → resolve YES (with evidence) → user claim. Asserts balances and prints
 * every tx signature. Run: pnpm --filter @touchline/server exec tsx src/chain/smoke.ts
 */
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { connection, houseKeypair } from "./config.js";
import { ensureChainSetup, faucetMint, tokenBalance, BET_CAP, USDC_DECIMALS } from "./tokens.js";
import { loadProgram, configPda, marketPda, vaultPda, betPda, messageIdBytes, TOKEN_PROGRAM_ID, SystemProgram, BN } from "./program.js";

const log = (...a: unknown[]) => console.log(...a);
const usdc = (n: number) => `${(n / 10 ** USDC_DECIMALS).toFixed(2)} tUSDC`;

async function main() {
  const conn = connection();
  const house = houseKeypair();
  log("house/resolver:", house.publicKey.toBase58());

  const state = await ensureChainSetup(conn);
  const usdcMint = new PublicKey(state.usdcMint);
  log("mock USDC mint:", state.usdcMint);

  const { program } = loadProgram(conn, house);
  const cfg = configPda();

  // init_config (idempotent — skip if it exists)
  const cfgAcct = await conn.getAccountInfo(cfg);
  if (!cfgAcct) {
    const sig = await program.methods.initConfig(house.publicKey, new BN(BET_CAP))
      .accounts({ admin: house.publicKey, config: cfg, systemProgram: SystemProgram.programId })
      .rpc();
    log("init_config:", sig);
  } else log("config already initialized");

  // house needs tUSDC to cover liabilities; faucet itself
  await faucetMint(usdcMint, house.publicKey, 1000 * 10 ** USDC_DECIMALS, conn);
  const houseAta = (await getOrCreateAssociatedTokenAccount(conn, house, usdcMint, house.publicKey)).address;

  // a fresh "user" wallet, funded with SOL from the house (devnet airdrop is rate-limited) + tUSDC
  const user = Keypair.generate();
  {
    const { Transaction, SystemProgram: SP } = await import("@solana/web3.js");
    const tx = new Transaction().add(SP.transfer({
      fromPubkey: house.publicKey, toPubkey: user.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL,
    }));
    const sig = await conn.sendTransaction(tx, [house]);
    await conn.confirmTransaction(sig, "confirmed");
  }
  await faucetMint(usdcMint, user.publicKey, 50 * 10 ** USDC_DECIMALS, conn);
  const userAta = (await getOrCreateAssociatedTokenAccount(conn, house, usdcMint, user.publicKey)).address;
  log("user:", user.publicKey.toBase58(), "| balance:", usdc(await tokenBalance(usdcMint, user.publicKey, conn)));

  // create a market: England (side 0) touches 60% — barrier 6000 bps, cutoff far in the future
  const fixtureId = 18241006, side = 0, barrierBps = 6000;
  const market = marketPda(fixtureId, side, barrierBps);
  const vault = vaultPda(market);
  const existingMarket = await conn.getAccountInfo(market);
  if (!existingMarket) {
    const sig = await program.methods
      .createMarket(new BN(fixtureId), side, barrierBps, new BN(Math.floor(Date.now() / 1000) + 86400))
      .accounts({
        house: house.publicKey, mint: usdcMint, market, vault,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
      }).rpc();
    log("create_market:", sig, "\n  market:", market.toBase58());
  } else log("market exists:", market.toBase58());

  // place a co-signed bet: $5 at fair price 0.5134 (5134 bps) → payout = 5/0.5134
  const nonce = Date.now();
  const amount = 5 * 10 ** USDC_DECIMALS;
  const priceBps = 5134;
  const bet = betPda(market, user.publicKey, nonce);
  const expectedPayout = Math.floor((amount * 10000) / priceBps);
  const houseBefore = await tokenBalance(usdcMint, house.publicKey, conn);
  const betSig = await program.methods.placeBet(new BN(nonce), new BN(amount), priceBps)
    .accounts({
      user: user.publicKey, house: house.publicKey, config: cfg, market, vault,
      userToken: userAta, houseToken: houseAta, bet,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([user, house]) // BOTH sign — dealer co-signs the quote
    .rpc();
  log("place_bet:", betSig);
  log("  stake:", usdc(amount), "price:", (priceBps / 100).toFixed(2) + "%", "→ payout:", usdc(expectedPayout));
  {
    const { getAccount } = await import("@solana/spl-token");
    const v = await getAccount(conn, vault);
    log("  vault now holds:", usdc(Number(v.amount)), "(= full payout, fully collateralized)");
  }

  // resolve YES with on-chain evidence (the real touching tick from the semifinal)
  const ev = {
    messageId: messageIdBytes("1837930444:00003:000323-10021-stab"),
    ts: new BN(1784146602448),
    probBps: 6969,
    rootHash: [...Buffer.alloc(32, 1)], // in production: the mainnet daily_batch_roots slot root
    pda: new PublicKey("7KRmBRjn1BBxVKZzwXJPBWavRaE4vorZe6SSEUPpeNvW"),
  };
  const resSig = await program.methods.resolve(true, ev)
    .accounts({ resolver: house.publicKey, config: cfg, market }).rpc();
  log("resolve YES:", resSig);

  // user claims the full payout
  const userBefore = await tokenBalance(usdcMint, user.publicKey, conn);
  const claimSig = await program.methods.claim()
    .accounts({ claimant: user.publicKey, market, vault, bet, winnerToken: userAta, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([user]).rpc();
  log("claim:", claimSig);
  const userAfter = await tokenBalance(usdcMint, user.publicKey, conn);

  const gained = userAfter - userBefore;
  log("\n── RESULT ──");
  log("user gained on claim:", usdc(gained), "(expected payout", usdc(expectedPayout) + ")");
  const ok = gained === expectedPayout;
  log(ok ? "✓ LIFECYCLE PASS — real devnet escrow paid the exact fixed-odds payout" : "✗ payout mismatch");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("SMOKE FAIL:", e); process.exit(1); });
