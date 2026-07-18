# What happened while you were out (built 2026-07-17, ~07:00–10:30)

## The pick and why

From the deep-dive portfolio I chose **Path Markets** — your own note ("options on the probability
path… will England cross 60%?") — and built it as a working product: **Touchline**. Reasoning: it's
the most intellectually distinctive idea we have, it uses the odds-proof primitive essentially no
other team will touch, the PM track is the biggest prize, and the demo has a one-line theorem plus
a "market pays YES on a match England lost" punchline. I considered pairing a second build
(PitchQuant/Divergence Desk) and chose depth over breadth — one *complete* product beats two halves.

## What works, verified end-to-end (not aspirationally — actually run)

- **Quote**: England touches 60% → `p0 35.4% → bound 59.0% → ×0.87 → fair 51.3%`.
- **Market lifecycle**: open (pool seeded at fair), stake, parimutuel payout math.
- **Resolution**: server finds the exact touching tick (69.686% @ 54′, messageId
  `1837930444:00003:000323-10021-stab`), fetches its Merkle proof from TxLINE, and
  **verifies it against the mainnet `daily_batch_roots` PDA — computed root == on-chain root,
  all three checks green, ~1.1s.** The UI renders the full receipt with a Solscan link.
- **Calibration study** (new research, from our corpus): across 109 finished matches / 327 outcome
  paths, observed touch rates ≈ **87% of the p/B martingale bound** (buckets from 0.84@40% to
  0.96@85%). That number both prices the product and is a tweetable finding on its own.
- **UI**: fixture rail with flags/scores/tick-counts, replayable path chart with barrier + touch
  marker, quote decomposition, market cards, green proof receipt, calibration explorer. Verified
  in a real browser (screenshots taken; only console error was the favicon, now fixed).
- **19 hermetic tests green**, typecheck clean in both packages, 4 clean commits.

## Where things stand vs. the hackathon checklist

Done: functional product · TxLINE data as primary input · verifiable resolution with custom
check gates (the judges' "highly valued" item) · endpoint list + math in README · demo script in
USAGE.md. Missing for submission: demo video, public repo push, deployed link (your platform
deployment blocker applies), and the wallet/Solana sign-in nicety. **I have not pushed, deployed,
or published anything** — all local, per your standing rule.

## Honest rough edges

1. The replay slider has a small dead zone at the start (pre-match tail indexing) — cosmetic.
2. Chart minute labels are wall-clock from kickoff ("+77m"), not match-clock (54′) — labeled
   honestly in the UI; joining the scores feed's Clock would fix it properly.
3. NO-resolution works when a fixture is final; the optimistic challenge window is described in
   the README but not enforced by a timer (prototype resolves instantly server-side).
4. On-chain escrow (USDC pools in a program, CPI settlement) is deliberately absent — the
   cryptographic resolution is real, the money layer is virtual. The deep-dive doc's Anchor
   escrow design is the natural next step if you want it for the submission.

## Suggested next moves (your call)

- Record the 3-minute demo (flow scripted in USAGE.md) — strongest before Sunday.
- Push to a public repo + deploy (the blocker doc's smallest path).
- Optional: barrier markets on the **final** (Spain — Argentina) as the live-demo hook; pre-match
  ticks are already flowing into the corpus.

Everything untouched: your repos, worktrees, wallets, and the battlefield. Touchline reads the
corpus and creds strictly read-only; the only on-chain interaction is free mainnet account reads.
