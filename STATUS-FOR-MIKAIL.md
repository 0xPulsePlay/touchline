# Night-shift handoff — the hedge leg + the white paper (2026-07-18, shift #2)

## TL;DR

Tonight's three asks are **done and browser-verified**:

1. **One-click betting.** No more "create a market, then bet." Pick a side, drag the barrier, hit
   **Bet $2/$5/$10** — the market is created, priced, co-signed, escrowed, and hedged in one action.
2. **The real hedge leg.** Every ticket is now offset by a live **win-share replication** recorded in
   a hedge ledger, with settlement accounting that shows the house's P&L is *outcome-independent* —
   the same small residual whether the barrier is touched or not, plus the jump-overshoot upside.
   There's a **House Hedge Book** panel on the market page that shows it live and settles in front of you.
3. **The white paper.** A new in-app page at **`/#/paper`** derives the whole mechanism — the `p/B`
   touch bound, the empirically-measured discount (live calibration table), the net-zero hedge
   replication (state table + worked example + honest leaks), and on-chain settlement. Linked from
   the home hero ("Read the math →") and from every quote ("· how?").

Everything from shift #1 still stands: real Anchor program, mock-USDC escrow, mainnet-verified Merkle
settlement, autonomous bots. Still on a **local validator** — the devnet deploy remains blocked on
~0.75 SOL (see §Blocker); that's a 2-minute you-only step.

## The hedge leg — what it actually does (this is the story to tell)

When the house writes a "touches B" ticket owing payout **P**, it immediately buys **P/B win-shares**
at the current win price **p** (cost `P·(p/B)`). A win-share pays 1 if the team wins and trades at the
win probability meanwhile, so:

- **Touch** → at the touch the win price is B, the shares are worth `(P/B)·B = P` → they fund the payout.
- **No touch** → the team never won, shares expire worthless → the house owes nothing.

Either way the big directional risk is gone. **Proven live in the browser** on England–Argentina:

| | this bet |
|---|---|
| Stake / payout | $10 → $18.91 if it touches |
| Hedge taken | 31.5 win-shares @ 35¢ = **$11.16** |
| **Unhedged**, if it touches | **−$8.91** (pay $18.91, keep $10) |
| **Hedged**, touch *or* no-touch | **−$1.16** either way (outcome-independent) |
| **Actually settled** — line jumped to **69.7%** | shares liquidated at $21.96 → **+$1.89** |

The hedge converted an **$8.91 loss into a $1.89 gain**, captured entirely from the jump overshoot —
the exact "one-sided residual in the house's favour" the discount is priced against. Settlement was
from a **mainnet-verified Merkle proof** (PDA 7KRmBRjn…), payout claimed (balance 100 → 90 → 108.91).

**Honest framing (also in the paper):** the hedged residual is *slightly negative before overshoot*
(the 0.87 discount gives users better-than-fair odds, a cost of carry ≈ 11.5% of premium), and is
recovered by jump overshoot on real touches. So the claim is **"≈ 0 / outcome-independent," not
"provably = 0."** The white paper's §4 says exactly this, including the three leaks (jump overshoot,
execution slippage, settlement-variable mismatch) and the venue-proxy caveat.

**Venue price.** The hedge is sized/priced off the TxLINE de-margined win price today (efficient-market
proxy). `hedge.ts` marks the source in a `venue` field so a real Polymarket/Kalshi adapter drops in
per-market without touching the accounting.

## What's new tonight (files)

```
server/src/chain/hedge.ts        NEW — replication engine + hedge ledger + treasury + settlement realize
server/src/chain/hedge.test.ts   NEW — 6 tests proving the replication identity (self-financing, overshoot, no-touch)
server/src/chain/service.ts      placeBet now records a hedge lot on every bet (stake, venue p, shares, cost)
server/src/chain/routes.ts       realizeHedge on resolve; /api/treasury/:key + /api/treasury; treasury folded into /api/onchain/markets
server/src/chain/bots.ts         bots pass their real win price so their lots hedge correctly
web/src/paper/WhitePaper.tsx     NEW — the in-app mechanism paper (live calibration fetch)
web/src/paper/paper.css          NEW — paper styling (theme-aware, mobile-first)
web/src/router.tsx               new #/paper route
web/src/betting/BettingPanel.tsx one-click picker + the House Hedge Book panel + "· how?" paper link
web/src/App.tsx                  removed dead parimutuel code (unused quote/markets state + handlers + their fetches)
web/src/Home.tsx                 "Read the math →" hero link
```

## What works, proven in the browser (updated)

Full loop on `/#/m/18241006`, verified live tonight:
1. **Faucet** 0 → 100 tUSDC.
2. **One-click bet** — side selector + gated barrier slider + `52.9% → 1.89×` quote with the
   `p/B 35.4%/60 = 59.0% × 0.87` decomposition and a "· how?" link to the paper. Bet $10 → on-chain, co-signed, escrowed.
3. **House Hedge Book** appears instantly: "buys 31.5 win-shares @ 35¢ (cost $11.16)… unhedged a touch
   costs −$8.91; hedged −$1.16 either way + overshoot."
4. **Settle & claim** — "Resolved YES — mainnet-verified Merkle proof (PDA 7KRmBRjn…)"; the hedge book
   updates to the settled line "unhedged −$8.91; hedged +$1.89 (premiums $10 − hedge $11.16 + liquidation $21.96 − payout $18.91)."
5. **White paper** at `/#/paper` renders all six sections with the live 109-match / 327-path calibration table.
6. **Bots** trade autonomously into the same hedge book.

## The blocker (needs you: ~2 minutes) — unchanged from shift #1

Program + stack run on a **local `solana-test-validator`**. Devnet deploy needs ~2 SOL for the upgrade
buffer; the devnet wallet `5nBA87pXc63mM2i2uFfyMKa3uwRagg499xecGhpKjCyJ` is short and the CLI faucet was
rate-limited all night.

1. Fund `5nBA87…` with ~3 devnet SOL at <https://faucet.solana.com>.
2. `cd onchain && ./deploy-devnet.sh`
3. `rm server/.data/{chain,wallets,onchain-ledger,hedge-ledger}.json`  (note the new hedge-ledger)
4. Restart the API on devnet: `cd server && TOUCHLINE_BOTS=1 pnpm dev` (drop the local-RPC override).

## How to run the demo right now (local validator, fully working)

The validator (:8899), API (:4617, bots on), and web (:4618) are currently running. To restart clean:
```bash
cd onchain && solana-test-validator --reset --quiet --ledger test-ledger &
solana airdrop 50 5nBA87pXc63mM2i2uFfyMKa3uwRagg499xecGhpKjCyJ --url http://127.0.0.1:8899
solana program deploy target/deploy/touchline_market.so \
  --program-id target/deploy/touchline_market-keypair.json \
  --keypair ~/.config/solana/pulseplay-deploy-authority.json --url http://127.0.0.1:8899
rm -f server/.data/{chain,wallets,onchain-ledger,hedge-ledger}.json
cd server && TOUCHLINE_DEVNET_RPC=http://127.0.0.1:8899 TOUCHLINE_BOTS=1 pnpm dev
cd web && pnpm dev    # → http://localhost:4618
```
Then: home → England–Argentina → Faucet 100 → Bet $10 → watch the hedge book → Settle & claim. Also visit `/#/paper`.

## What's left / rough edges (honest)

1. **Devnet deploy** — the one real blocker above.
2. **On-graph bet columns** ("Couchy-style" rising columns on the chart) — the activity feed + hedge
   book are panels; the on-chart column viz isn't done. Data (`/api/onchain/markets` now carries
   per-market `treasury`) is ready.
3. **Custodial session wallets** — demo-appropriate, not the non-custodial ideal (server-held keypairs
   funded by the house; connected Phantom is identity only).
4. **Market re-runnability** — market PDAs are deterministic per (fixture, side, barrier); a resolved
   market can't reopen. For repeated demos, vary the barrier or reset the validator.
5. **Hedge venue is a proxy** — sizes off the TxLINE win price; a production build routes to a live win
   market and eats its spread (the `venue` seam is in place).
6. **The paper's worked example** ($6 → +$4.40) is from an earlier settle; the browser run above netted
   $10 → +$1.89. Both real, both illustrative — left as-is since it's a "typical" figure, not a live tie-out.

## Verification state

`pnpm -r typecheck` clean · `pnpm --filter @touchline/server test` = **39 passing** (pricing, touch,
markets, dealer gating, phases, **+6 new hedge replication tests**) · full on-chain lifecycle + hedge
record→realize proven via the browser UI · white paper renders with live calibration · bots trading and
auto-hedging. Commits are clean and incremental.

## Suggested first moves when you wake

1. Read `/#/paper` — it's the pitch, and it's honest. Skim §4 (the hedge) so the "outcome-independent,
   overshoot-funded" framing is in your head for the demo.
2. Run the betting flow and watch the House Hedge Book settle — that's the money shot for the video.
3. Top up devnet SOL + `./deploy-devnet.sh` → the whole thing is on real devnet (judge-testable).
4. Decide whether the on-graph columns are worth the last polish before recording.
