# Night-shift handoff — real on-chain barrier markets (built while you slept, 2026-07-18)

## TL;DR

Touchline now has a **working end-to-end on-chain prediction market**: an Anchor program that escrows
mock USDC, a dealer that quotes barrier-gated `p/B × 0.87` prices, real co-signed bets, settlement
from a **genuine mainnet-verified Merkle proof**, payout claims, and **autonomous bots** trading in a
live activity feed. Proven end-to-end in the browser. **One blocker**: the final deploy is on a
*local validator*, not devnet, because the devnet wallet is ~0.75 SOL short and the faucet was
rate-limited all night. Topping it up + one deploy command finishes it (see §Blocker).

Your market-mechanism decisions were honored: **dealer/hedging model** (not LMSR — your prose
overrode the sheet, and barrier-pick markets make per-barrier LMSR fragment liquidity), **devnet**,
**$10 stake cap**, mock USDC. The **paper-hedge** display you selected is designed but not yet
surfaced in the UI (noted in §What's left).

## What works, proven in the browser

Full loop on the semifinal market page (`/#/m/18241006`), verified live:
1. **Faucet** — 0 → 100 tUSDC (mock SPL, unlimited supply, house-minted).
2. **Dealer quote** — "England touches 60%? → **52.9% house price → 1.89× payout**", with the
   `p/B 35.4%/60 = 59.0% × 0.87` decomposition shown. Barrier is **gated** to ≥ current prob + 1 pt.
3. **Place bet** — a real on-chain, house-co-signed, fully-collateralized $5 bet (tx surfaced).
4. **Settle & claim** — "Resolved YES — settled from a **mainnet-verified Merkle proof** (PDA
   7KRmBRjn…). Payout claimed." Balance 95 → **104.46** (exact fixed-odds payout).
5. **Bots** — Momentum / Quant / NearLine / LongShot trade autonomously every ~12s; the **live
   activity feed** shows them alongside your bets.

The settlement is the crown jewel: the resolver finds the touching tick, fetches its odds Merkle
proof from TxLINE, **verifies it against the real mainnet `daily_batch_roots` PDA** via
`@txline/verify` (roots match: true), then anchors that evidence (messageId, tick ts, the mainnet
root hash, the PDA) **on-chain** so anyone can independently re-verify.

## Architecture (what's new tonight)

```
touchline/
  onchain/programs/touchline-market/   Anchor program (SPL dealer escrow, barrier markets)
    - init_config / create_market / place_bet (co-signed) / resolve (evidence) / claim
    - deployed: program 6kZYYdZLJcsU2ZBKKthc7BpddUiYdTbAtGigS2bJc53K
  server/src/
    dealer.ts            barrier-gated p/B×0.87 quoting (5 tests)
    chain/config.ts      program id, RPC, house/resolver keypair, shared data dir
    chain/program.ts     anchor client (1.1.2 IDL), PDA derivation, evidence encoding
    chain/tokens.ts      mock USDC/SOL mints, faucet, race-free ATA helper
    chain/wallets.ts     custodial session wallets (devnet mock — see note)
    chain/service.ts     ensureMarket / placeBet / resolveMarketOnChain / claimBet + ledger
    chain/routes.ts      /api/faucet, /api/dealer/quote, /api/bet, /api/market/:k/resolve, /api/claim, /api/activity
    chain/bots.ts        autonomous bot fleet
    chain/smoke.ts       full-lifecycle proof script
  web/src/
    Home.tsx + home/     the path-picker landing (built by a parallel agent — excellent)
    betting/BettingPanel.tsx   faucet + quote + bet + settle + activity feed
```

**Design decision — custodial session wallets.** To make the browser flow frictionless (no devnet
SOL in the user's Phantom, no per-tx approval), each browser session and each bot gets a
server-held keypair, funded by the house. The connected Phantom pubkey is identity; the on-chain
actor is the funded session wallet. This is honest for a **devnet mock-token demo** and is clearly
marked in the code. For a non-custodial version, the bet tx would be built server-side and signed
by the user's wallet — a later upgrade.

## The blocker (needs you: ~2 minutes)

The program + full stack run on a **local `solana-test-validator`** (unlimited local SOL). The
**devnet deploy is blocked**: it needs ~2 SOL for the upgrade buffer, the devnet wallet
(`5nBA87…`) has ~1.25, and the CLI faucet was rate-limited every attempt all night (a background
retry loop is still running — check `solana balance 5nBA87… --url devnet`).

**To move it to devnet:**
1. Fund `5nBA87pXc63mM2i2uFfyMKa3uwRagg499xecGhpKjCyJ` with ~3 devnet SOL at
   <https://faucet.solana.com> (web faucet works when the CLI is throttled).
2. `cd onchain && ./deploy-devnet.sh`  (builds if needed, deploys, prints the program id).
3. Wipe local chain state so mints re-create on devnet: `rm server/.data/{chain,wallets,onchain-ledger}.json`
4. Restart the API pointed at devnet (drop the `TOUCHLINE_DEVNET_RPC` override — it defaults to
   devnet): `pnpm --filter @touchline/server dev` (add `TOUCHLINE_BOTS=1` for bots).

Everything else is identical — the program bytecode is the same one proven locally.

## How to run the demo right now (local validator, fully working)

Three processes are currently running: the local validator, the API (on the validator, bots on),
and the web dev server. If you need to restart from scratch:
```bash
# 1. local validator
cd onchain && solana-test-validator --reset --quiet --ledger test-ledger &
solana airdrop 50 5nBA87pXc63mM2i2uFfyMKa3uwRagg499xecGhpKjCyJ --url http://127.0.0.1:8899
solana program deploy target/deploy/touchline_market.so \
  --program-id target/deploy/touchline_market-keypair.json \
  --keypair ~/.config/solana/pulseplay-deploy-authority.json --url http://127.0.0.1:8899
# 2. wipe stale chain state, start API on the validator + bots
rm -f server/.data/{chain,wallets,onchain-ledger}.json
cd server && TOUCHLINE_DEVNET_RPC=http://127.0.0.1:8899 TOUCHLINE_BOTS=1 pnpm dev
# 3. web
cd web && pnpm dev    # → http://localhost:4618
```
Then: open the home page → click into England–Argentina → Faucet 100 → Bet $5 → Settle & claim.

## What's left / rough edges (honest)

1. **Devnet deploy** — the one real blocker above.
2. **Paper-hedge display** — your decision-sheet pick; the dealer's net-exposure ledger exists in
   the program state (`total_stake`/`total_payout`) but the "here's how the house hedges on
   Polymarket" panel isn't surfaced in the UI yet. ~1–2h.
3. **On-graph bet columns** ("Couchy-style" rising columns on the chart's left) — the activity
   feed is a list; the on-chart column viz isn't done. The data (`/api/onchain/markets`) is ready.
4. **Custodial wallets** — demo-appropriate but not the non-custodial ideal (see design note).
5. **Market re-runnability** — market PDAs are deterministic per (fixture, side, barrier), so a
   resolved market can't reopen. Fine for real use; for repeated demos, reset the validator or vary
   the barrier. (An `epoch` seed would make them re-runnable.)
6. **Resolve NO-side** works but has no optimistic-challenge timer (resolver attests instantly).

## Verification state

`pnpm -r typecheck` clean · `pnpm --filter @touchline/server test` = **33 passing** (pricing, touch,
markets, dealer gating, SSE, phases) · full on-chain lifecycle proven via `smoke.ts` AND via the
browser UI · bots trading live. Commits are clean and incremental (see `git log`).

## Suggested first moves when you wake

1. Top up devnet SOL + `./deploy-devnet.sh` → the whole thing is on real devnet (judge-testable).
2. Glance at the home page and the betting flow — it's demoable as-is.
3. Decide if the paper-hedge panel and on-graph columns are worth the last polish before the demo
   video, or if the current loop is enough to record.
