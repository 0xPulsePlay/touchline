# Night-shift #3 handoff — DEMO DAY (Sun Jul 19 · deadline 23:59 UTC = 19:59 local)

## ⏰ Your schedule today

1. **Morning**: review this + the docs → record the ≤5-min demo video (flows + script below).
2. **You deploy** (your call from last night — everything runs localhost right now).
3. **15:00 local — THE FINAL (Spain v Argentina), the last live-capture window.** The ingestion
   worker is up and self-healing: in-play odds will stream live. Capture footage.
4. **Submit before 19:59 local.** Checklist: repo public (push is yours), video link, deployed
   link, technical doc (docs/TECHNICAL-WRITEUP.md), feedback section (in it).

## TL;DR — everything you asked for last night is built and proven on devnet

1. **Five instruments, one theorem** — the bet-type tabs: **↗ Touch up** (p/B·δ) · **↘ Touch down**
   ((1−p)/(1−A)·δ) · **⇅ Race** ("hits U before L", gambler's-ruin (p−L)/(U−L), EXACT, no discount)
   · **💔 Heartbreak** ("touches B and still loses", (p/B)(1−B)·δ) · **🔄 Comeback** (the mirror).
   All priced in dealer.ts, all hedged with self-financing replicating positions, all with
   kind-aware Merkle resolution. **69 tests green.**
2. **THE demo moment works** (browser-proven): place a heartbreak on England semifinal (21.1% →
   4.73×) → ⚡ Simulate live → the touch trips the watcher → **auto-resolves on devnet with the
   mainnet-verified Merkle proof** → settlement card with explorer links (settlement tx, bet tx,
   mainnet anchor PDA) → payout claimed (95 → 118.66) → **house hedge net +$3.23 vs −$18.66
   unhedged**. Heartbreak/comeback wait for the sim's full-time whistle before settling.
3. **Parlays are real on-chain** — new `place_parlay`/`claim_parlay` instructions (redeployed to
   devnet), 2–4 legs, one fully-collateralized escrow, ALL-legs-YES to win. Proven: 2-leg $5 at
   5.04× → both legs Merkle-resolved → claim paid $25.20 exactly. UI: "＋ Parlay leg" on any
   market builds a cross-match ticket (localStorage).
4. **Probability lines beyond 1X2** — line picker on the chart: Match odds ↔ **Over/Under 2.5
   goals** (same martingale, same theorem, same hedges — the point writes itself).
5. **Faucet is off the betting page** — AppBar wallet menu with SOL/USDC rows styled like a real
   wallet; "Get devnet funds" lives in the popover. Freeform stake + chips. Explorer links
   everywhere.
6. **White paper upgraded** (`/#/paper`): instrument-family pricing table, per-kind replication
   table, **the drama theorem** (E[Σ(ΔM)²] = p(1−p), remaining-drama gauge live on the chart,
   exact pathwise replication — "the family only a proof-carrying feed can settle"), and the
   §4 worked example now pulls a **real settled ticket from the live hedge ledger**.
7. **Docs for you**: `docs/DEMO-FLOWS.md` (recording order + pre-flight checklist),
   `docs/DEMO-SCRIPT.md` (the spikes: *"Path markets trade the drama, not the result"* · *"UMA
   resolves disputes by token-holder vote; ours by cryptography — the challenge is a Merkle
   proof, or it's nothing"* · the heartbreak line), `docs/TECHNICAL-WRITEUP.md` (full math incl.
   liquidity/hedging across all markets, endpoints used, feedback section, CPI honesty note).

## Overnight bug war stories (all fixed)

- **Bots went broke** (fauceted once, never topped up) → "Simulation failed: insufficient funds";
  now solvent + varied (sides/barriers/jitter/dedupe) so the feed reads like a market.
- **Program validates side ≤ 2** — kind encoding moved into fixture_id's high bits
  (fid = fixtureId | line<<32 | epoch<<40 | kind<<48). No program change needed for kinds/lines.
- **Legacy-era PDA collision** (old-mint market on devnet → WrongMint) → mint-era byte folded
  into every market PDA; fresh chain state can never collide again; epoch bump = re-runnable
  markets for repeated demo takes.
- **Public devnet RPC 429s** → singleton connection, bots at 45s cadence, sparse solvency checks,
  client polls at 30s, retry-with-backoff on bet placement, quote re-poll (no dead buttons).
- **"Touch either edge" band is degenerate** (a {0,1}-terminal martingale always exits any
  interior band) → replaced with the RACE, which is strictly better: exact closed form, exact
  hedge, and even the NO side settles cryptographically (first tick out the bottom).

## How to run (everything currently UP)

- platform :3001 + ingestion worker (self-healing gap-check) · touchline API :4617 (devnet,
  bots on) · web :4618. Program `6kZYYdZLJcsU2ZBKKthc7BpddUiYdTbAtGigS2bJc53K` live on devnet
  (authority ~9.4 SOL).
- Restart API: `cd server && TOUCHLINE_BOTS=1 pnpm start` · web: `cd web && pnpm dev` ·
  worker: `pnpm --filter @txline/api worker` (in txline-explorer).
- Demo reset: bump epoch (the market-era system means you can re-run the same barrier by
  passing `epoch` in the bet body; fresh session id = fresh wallet).

## Honest state / open items

- **Codex UI pass** (your GPT restyle of home hero + betting card) may still be merging when you
  read this — check `git log`. If absent, the current UI is the functional version.
- Parlay hedge is leg-1 rolling (documented approximation); per-leg roll-forward is roadmap.
- Heartbreak δ uses the touch discount (direct heartbreak calibration from the corpus is a
  30-min job if you want the second table).
- AH line + drama leaderboard + on-graph bet columns: not built (time-boxed out).
- Devnet RPC latency: bets take 5–15s; the loading states cover it, but record with patience.
- Non-custodial signing remains roadmap (custodial session wallets + Phantom identity).
