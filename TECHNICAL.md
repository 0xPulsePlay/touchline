# Touchline — Technical Documentation

> Markets on the **path** of a win probability, not the final result. Priced by a one-line
> martingale theorem, hedged into a flat book, and settled by a **Merkle proof of a single odds
> tick** verified against TxLINE's Solana-anchored daily root.

**TxODDS World Cup Hackathon — Track 1 (Prediction Markets & Settlement).**
Live app: **https://touchline.gershwin.dev** · Repo: **https://github.com/0xPulsePlay/touchline** ·
Demo video: **[DEMO VIDEO LINK]** · TxLINE data layer: **https://txline-api.gershwin.dev** ·
Explorer: **https://txline-explorer.gershwin.dev**

The full derivation, hedging math, and an honest API-feedback section live in
[`docs/TECHNICAL-WRITEUP.md`](docs/TECHNICAL-WRITEUP.md). This page is the short version.

---

## 1 · Core idea

A bookmaker quotes home / draw / away. Strip the margin and each side has a **de-margined win
probability** that walks from kickoff to full time, ending at **1** if the side wins and **0** if it
doesn't. TxLINE publishes that number tick-by-tick as `Pct` — and, uniquely, **anchors every tick in
a Merkle tree whose daily root lives on Solana.**

Every other venue settles on *what happened* (the final score). Touchline settles on **the journey**:
*will this probability ever touch a barrier `B` you pick?* That question is unanswerable without
per-tick proofs — which is exactly what TxLINE's odds anchoring provides. The launch example writes
its own copy: in the semifinal, England's win probability opened ~36%, **touched 69.7% at 54′, and
England lost 1–2.** "England touches 60%" resolves YES on a match England lost. Path markets trade
the drama, not the result.

## 2 · Technical highlights

**An instrument family from one theorem.** The de-margined probability `M_t` is a martingale
terminating in {0,1}. Optional stopping at the first touch of `B > p` gives `P(touch) = p/B`. That
single identity yields five live instruments (`server/src/dealer.ts`, `dealerQuoteKind`):

| Kind | Question | Fair price (pre-discount) |
|------|----------|---------------------------|
| **Touch up** | rises to touch `B > p`? | `p/B` |
| **Touch down** | falls to touch `b < p`? | `(1−p)/(1−b)` |
| **Race** (band) | hits `U` before `L`? | `(p−L)/(U−L)` — gambler's ruin, **exact** |
| **Heartbreak** | touches `B` *and still loses*? | `(p/B)·(1−B)` |
| **Comeback** | drops to `A` *and still wins*? | `A·(1−p)/(1−A)` |

Plus **parlays** (2–4 legs, price = product of legs). Markets can be built on either the 1X2 win
line or the Over/Under 2.5-goals line — both are bounded martingales, so the same theorem, gates, and
hedges apply unchanged.

**A price with a measured constant.** `p/B` is an upper bound: goals make the line *jump* past the
barrier, cutting the true touch rate below `p/B`. We measured the gap across **109 finished matches /
327 outcome paths** (`server/src/calibration.ts`): touches happen at **≈ 0.87** of the bound. Every
quote is `(p/B) · 0.87`, and the live per-barrier table is fetched from `GET /api/calibration` and
rendered in the in-app white paper (`/#/paper`).

**Every ticket is hedged, not pooled** (`server/src/chain/hedge.ts`). The instant a bet is written,
the house takes the offsetting position in the underlying — for an up-touch, `P/B` win-shares at the
current price `p`, worth exactly `P` at the touch (a win-share trades at the win probability, which
equals `B` there). The payout is funded by the hedge, **outcome-independent**, not paid out of the
next bettor's stake. Heartbreak/comeback use a self-financing two-phase hedge (win-shares → NO-shares
at the touch). Every lot is booked to a hedge ledger and rolled into the **House Hedge Book** panel;
`realizeHedge()` books settled P&L. Real settled example from the ledger: a heartbreak ticket netted
**+$3.23 hedged vs −$18.66 unhedged**.

**On-chain program** (`onchain/programs/touchline-market`, Anchor, **deployed on devnet**). Six
instructions: `init_config`, `create_market`, `place_bet` (user + house co-sign; fully
collateralized — the vault holds the entire payout at placement), `resolve` (writes settlement
evidence on-chain), `claim`, plus `place_parlay` / `claim_parlay` (one escrow across 2–4 leg markets;
pays only if every leg resolves YES). The five bet kinds, the probability line, and a re-run epoch are
**encoded into the market PDA seeds** (`fixture_id = fixtureId | line<<32 | epoch<<40 | kind<<48`,
`server/src/chain/service.ts`), so the whole family ships on the deployed program with no per-kind
program change. Autonomous bots (`server/src/chain/bots.ts`) trade four strategies against the dealer
so the activity feed and hedge book stay live.

```
touchline/
├─ server/   Fastify API (:4617) — dealer, resolver, hedge ledger, bots
│            reads via @txline/client-sdk → txline-explorer platform (:3001)
│            verifies proofs via @txline/verify → Solana MAINNET RPC (read-only)
├─ web/      Vite + React SPA (:4618) — path chart, five-instrument ticket, receipts
└─ onchain/  Anchor program `touchline-market` (devnet)
```

## 3 · The specific TxLINE endpoints used

TxLINE is the **primary live input** for both the probability path (the tradable underlying) and the
settlement proof (the resolution evidence). It arrives in three layers:

**A. Direct upstream calls Touchline's server makes to `https://txline.txodds.com`**
(`TXLINE_API_BASE`, `server/src/config.ts`):

| Endpoint | Purpose | Code |
|----------|---------|------|
| `POST /auth/guest/start` | short-lived guest JWT (paired with the cached `apiToken`) | `server/src/creds.ts` |
| `GET /api/odds/validation?messageId&ts` | **Merkle proof for one odds tick — the settlement evidence** | `server/src/proofs.ts` |

**B. TxLINE data consumed through the platform SDK** (`@txline/client-sdk` → the txline-explorer
platform at `:3001`, which ingests the TxLINE feed and re-serves it `asOf`-aware; `server/src/platform.ts`):

| SDK call | Platform route | Used for |
|----------|----------------|----------|
| `fixtures({ limit })` | `GET /v1/fixtures` | fixture list (home tiles) |
| `fixture(id)` | `GET /v1/fixtures/{id}` | timeline: status phases, minute-stamped events, scoreline |
| `oddsRaw(id, { market, asOf, limit })` | `GET /v1/fixtures/{id}/odds?raw=1` | full-precision tick path (1X2 / O/U); `asOf` time-travels for live + sim |
| `stream({ fixtureId })` | `GET /v1/stream/…` (resumable SSE) | live tick push |

The upstream TxLINE endpoints the platform itself ingests (`/api/fixtures/snapshot`,
`/api/scores/updates/{fixtureId}` SSE, `/api/odds/updates/{epochDay}/{hour}/{interval}`,
`/api/odds/snapshot/{fixtureId}?asOf`, `/api/scores/stat-validation`, `/api/fixtures/validation`) are
documented in [`docs/TECHNICAL-WRITEUP.md`](docs/TECHNICAL-WRITEUP.md) §8.2.

**C. On-chain verification** (`@txline/verify` → Solana **mainnet** RPC, read-only, zero cost):
`daily_batch_roots` **PDA reads** on the TxODDS oracle program
`9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` — the anchored root each odds-tick proof chains to.

## 4 · How resolution works, and why it's deterministic

A market resolves **YES** the moment a single recorded odds tick prints past the barrier. That one
tick is the entire evidence (`server/src/chain/routes.ts` → `/api/market/:key/resolve`):

1. The resolver scans the **full-precision** path for the first tick that crosses `B` (kind-aware:
   up `≥ B`, down `≤ B`, race = first tick out of `[L, U]`, heartbreak/comeback = a touch **plus**
   the final result). This is a pure function of the recorded path and the final score — the same
   inputs always produce the same outcome.
2. It fetches that tick's **Merkle proof** from `GET /api/odds/validation?messageId&ts` and verifies
   it with `@txline/verify` (`verifyOddsProofOnChain`): recompute the odds-tick leaf → odds sub-tree
   root → 5-minute slot root, and check the computed root **byte-for-byte against the on-chain
   `daily_batch_roots` PDA** on mainnet. A match proves the tick is real, unaltered, and was
   published before settlement.
3. The `resolve` instruction stores that evidence on devnet — `message_id`, `ts`, `prob_bps`, the
   mainnet `root_hash`, and the `pda` — so **anyone** can independently re-run the check.
4. The UI renders the receipt: outcome, a "Merkle-verified against mainnet" badge, the settlement tx,
   the bet tx, the mainnet anchor PDA, the deciding tick, and the validation method — each linking out
   to Solana Explorer. Parlays show a per-leg receipt.

**Why deterministic:** resolution asserts nothing. It names a specific anchored tick and either that
tick chains to the mainnet root or the settlement is rejected. There is no oracle vote, no bond, no
liveness window. *UMA-style optimism resolves disputes by token-holder ballot; Touchline resolves
them by cryptography — the challenge is a Merkle proof, or it's nothing.*

**Honest note on CPI (the cross-cluster seam).** Track 1 asks for a CPI into TxLINE's `validate_stat`
from the settlement program. TxODDS anchors on **mainnet**; our escrow program is on **devnet**, and a
devnet program cannot invoke a mainnet account — cross-cluster CPI is impossible. So we do the
economically-equivalent thing that *is* possible today: verify each proof **client-side against the
real mainnet `daily_batch_roots` PDA** (the same root a CPI would read) and **store the verified
evidence on-chain** for public re-verification. The resolver isolates the exact call site
(`server/src/proofs.ts`), so a mainnet deployment would swap the client-side check for an on-chain
`validate_stat` / `validateStatV3` CPI at resolve time — and the multiproof is the natural fit for
one-call multi-leg parlay settlement.

**Escrow currency.** All wagering, escrow, and collateral use a **mock USDC SPL token** (devnet, zero
real value; `$10` per-bet cap). The TxLINE `TxL` credit token is used **only** for data authorization,
never for P2P value.

## 5 · Run it locally

Prerequisites: the txline-explorer platform running at `:3001` (with its corpus DB + cached TxLINE
token), Node 20+, pnpm.

```bash
# 1. platform dependency (in txline-explorer):  pnpm --filter @txline/api dev      # :3001
# 2. Touchline API on devnet, bots on (in touchline/):
cd server && TOUCHLINE_BOTS=1 pnpm start                                            # :4617
# 3. web:
cd web && pnpm dev                                                                  # :4618
```

Open **http://localhost:4618** → a match → fund from the wallet menu → **⚡ Simulate live** → place a
Heartbreak on England 60% → watch it touch 69.7% and auto-settle on devnet with the mainnet-verified
receipt. `pnpm test` runs the hermetic suite (pricing bounds, touch detection incl. jump-overshoot,
market lifecycle, parimutuel payouts, hedge replication).

**Deployed artifacts (devnet):** program `6kZYYdZLJcsU2ZBKKthc7BpddUiYdTbAtGigS2bJc53K` · house /
resolver / mint authority `5nBA87pXc63mM2i2uFfyMKa3uwRagg499xecGhpKjCyJ` · mock USDC mint
`J7dHuMNR4G3tWYBQJCrzRnMJkX4wkYzwAs8UrivPGDjV`. Proof verification RPC: Solana **mainnet-beta**
(read-only).
