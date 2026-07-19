# Touchline — options on the probability path

> "Will England's win probability ever touch 60%?" — a new class of market: **path options** on
> TxLINE's de-margined win probabilities, priced by a one-line theorem and **settled by a Merkle
> proof of a single odds tick, verified against the Solana-anchored daily batch root.**

Built for the TxODDS World Cup hackathon (Prediction Markets & Settlement track).

## Why this is a different kind of market

Every existing venue settles on *what happened* (final scores). TxLINE anchors **every odds tick**
on Solana — so markets can settle on **the journey**: barrier touches, drawdowns, "did the draw
lead at half-time". These are path-dependent claims that no oracle-committee platform can offer,
because resolving them requires a provable price history. Here, resolution evidence is a single
tick plus its Merkle chain to an on-chain root.

The launch example writes its own ad copy: in the semifinal, England opened ~36%, **touched 69.7%
at 54′ — and lost 1–2.** "England touches 60%" resolved YES on a match England lost. Path markets
trade the drama, not the result.

## The math (the demo's napkin moment)

A de-margined probability `M_t` is a martingale that terminates in {0,1}. For barrier `B > p`,
stop at the first touch τ. Optional stopping: `E[M_τ] = p`. A path that never touches B cannot
reach 1, so it ends at 0:

```
p = B·P(touch) + 0·P(never)   ⟹   P(touch B) = p / B
```

Goals make the path jump (`M_τ ≥ B`), so `p/B` is an **upper bound**. Touchline measures the
actual discount empirically: across **109 finished World Cup matches (327 outcome paths)**,
observed touch rates run at **~87% of the bound** — that 0.87 is applied to every quote, and the
full observed-vs-bound table ships in the UI (Calibration panel).

## What settlement looks like

1. A one-touch market resolves YES when any recorded tick reaches the barrier.
2. The server pulls that exact tick's Merkle proof: `GET /api/odds/validation?messageId&ts`.
3. `@txline/verify` reconstructs both tree levels client-side and compares against the
   **on-chain** `daily_batch_roots` PDA (read-only mainnet RPC, zero cost):
   - odds-tick leaf → odds sub-tree root ✓
   - batch-summary leaf → 5-minute slot root ✓ (computed root == on-chain bytes)
   - PDA epoch-day check ✓
4. The UI renders the receipt: every hash, the PDA address, epochDay/slot, and a link to the
   anchor account. **No committee, no dispute vote — the proof is the resolution.**

NO-side resolution is optimistic-with-cryptographic-challenges: at full time with no touching
tick, NO pays; any pretender YES can only be defeated —or proven— by a tick proof, never a vote.

Liquidity is parimutuel per market (zero LP risk), seeded at the fair quote so pool-implied odds
open "already correct".

## Architecture

```
touchline/
  server/   Fastify (port 4617)
    corpus.ts       read-only SQLite on the txline-explorer engine corpus (117 fixtures, 5.5M ticks)
    pricing.ts      p/B bound + discount quoting, parimutuel math
    touch.ts        first-crossing detection over the full-precision tick path
    markets.ts      market lifecycle + JSON persistence (server/.data)
    proofs.ts       TxLINE proof fetch → @txline/verify → mainnet PDA comparison
    calibration.ts  the corpus-wide touch study (observed vs bound per barrier)
  web/      Vite + React (port 4618)
    PathChart.tsx   replayable probability path with barrier + touch marker
    App.tsx         fixture rail, market builder, parimutuel cards, proof receipt, calibration
```

Upstream (read-only, never modified): the `txline-explorer` engine corpus + cached TxLINE
credentials, and the `@txline/verify` package (a local `file:` dependency).

## TxLINE endpoints used

- `GET /api/odds/validation?messageId&ts` — the Merkle proof per odds tick (settlement evidence)
- `POST /auth/guest/start` — guest JWT refresh
- Corpus (ingested upstream by our engine): `GET /api/odds/updates/{epochDay}/{hour}/{interval}`,
  `GET /api/odds/snapshot/{fixtureId}?asOf`, `GET /api/scores/updates/{fixtureId}` (SSE-framed),
  `GET /api/fixtures/snapshot`
- On-chain: `daily_batch_roots` PDA reads on mainnet program
  `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`

## Run it

See `USAGE.md`. TL;DR: `pnpm install && pnpm dev` → http://localhost:4618.

## Tests

`pnpm test` — 19 hermetic tests (pricing bounds, touch detection incl. jump-overshoot, market
lifecycle, parimutuel payouts). Test runs never touch the on-disk market store.
