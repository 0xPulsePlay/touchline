# Touchline — Technical Documentation

One-touch prediction markets on de-margined win-probability paths, settled by cryptographic proof
against TxLINE's on-chain odds anchors.

**TxLINE track:** Track 1 — Prediction Markets & Settlement.
**Program (devnet):** `6kZYYdZLJcsU2ZBKKthc7BpddUiYdTbAtGigS2bJc53K`
**Resolver / house / mint authority:** `5nBA87pXc63mM2i2uFfyMKa3uwRagg499xecGhpKjCyJ`

---

## 1 · Core idea and what's novel

A bookmaker quotes three prices on a match — home / draw / away. Strip the margin (normalise the
implied probabilities to sum to 1) and each side has a **de-margined win probability** that walks
between kickoff and full time, ending at **1** if the side wins and **0** if it doesn't. TxLINE
publishes that number tick-by-tick as `Pct`, and — this is the part almost nobody uses — it
**anchors every tick in a Merkle tree whose daily root lives on Solana.**

Touchline turns that path into a market. You don't bet the result; you bet the **journey**: *will
this probability ever touch a barrier B you choose?* We price the touch from a martingale bound
(`p/B`), correct it with a discount we **measured** on the corpus (δ ≈ 0.87), hedge every ticket
into a near-flat book, and settle each market on the **single odds tick** that crossed the barrier —
proven with a Merkle proof verified against the mainnet anchor, with the evidence stored on-chain
for anyone to re-verify.

What's novel, specifically:

- **Path-dependent settlement on odds, not scores.** Most TxLINE settlement ideas resolve on a
  final scoreline. We resolve on an *intermediate odds tick* — only possible because
  `/api/odds/validation` makes individual ticks provable. The "did it ever touch?" question is
  unanswerable without per-tick proofs.
- **A price with a measured constant in it.** `p/B` is a theorem; the 0.87 is not invented, it's the
  observed touch rate divided by the mean bound across 109 matches. We price with the number the
  data gives us.
- **Every ticket is hedged by construction.** The one-touch is replicated by the underlying win
  contract (§4). The payout is funded by the hedge, not the next bettor — the book is
  outcome-independent, not a pool that pays winners out of losers.
- **Cryptographic dispute resolution.** UMA-style optimism resolves disputes by token-holder vote;
  ours resolves them by a Merkle proof, or nothing (§6).
- **An instrument *family*, not a single bet.** The same martingale that prices the touch prices
  **heartbreak** (`(p/B)(1−B)` — "touched the summit and still lost"), **comeback**, and a match's
  total **drama** (`p(1−p)`) — a class of path-dependent instruments *only a proof-carrying odds feed
  can settle* (§3, §5). The product's own launch anecdote — England touched 69.7% and lost the
  semifinal — *is* a heartbreak that resolves YES.

---

## 2 · The instrument

A **one-touch ticket** pays a fixed multiple if a chosen probability path reaches a barrier before
the match ends. A pure touch settles the instant the line prints past the barrier — the eventual
result is irrelevant. Two variants (**heartbreak / comeback**) deliberately *condition on the
result*: they combine a touch with the opposite ending, which is what makes them the emotional core
of the product — a market that pays out precisely when it hurts most.

| Type | Question | Bound (fair, pre-δ) |
|------|----------|---------------------|
| **UP touch** | Does `p` rise to touch **B > p**? | `p / B` |
| **DOWN touch** | Does `p` fall to touch **b < p**? | `(1 − p) / (1 − b)` |
| **BAND** (UI: *Race*) | Does `p` hit the upper edge **U** before the lower **L**? | `(p−L)/(U−L)` — gambler's ruin, **exact**, no δ |
| **HEARTBREAK** | Touches **B > p** *and still loses* | `(p/B)·(1 − B)` |
| **COMEBACK** | Drops to **A < p** *and still wins* | `A·(1 − p)/(1 − A)` |
| **Parlay** | Do **2–4** legs *all* touch? | `∏ legᵢ` |

All five kinds are live in the dealer today (`dealerQuoteKind`, `server/src/dealer.ts`; kind-aware
hedges in `hedge.ts`). The five kinds — plus the chosen line and a re-run epoch — are **encoded into
the existing on-chain market PDA seeds** with no program change (see §7), so the whole family ships
on the deployed devnet program.

The **line** the path is drawn from is itself selectable: the classic 1X2 win probability
(`1X2_PARTICIPANT_RESULT`), or an over/under goals probability (`OVERUNDER_PARTICIPANT_GOALS`, ~5.6k
ticks/match), or Asian handicap (`ASIANHANDICAP_PARTICIPANT_GOALS`, if time). Every one of these is
a bounded martingale terminating in {0, 1}, so the same `p/B` theorem and the same hedge apply
without modification.

**The barrier gate.** A quote is only offered for a barrier strictly beyond the current level plus a
minimum step (`MIN_STEP_BPS = 100`, i.e. +1.0 pt). You cannot buy a touch of a level the line has
already cleared — that would be a settled bet, not a prediction. Betting closes at a per-market
cutoff and the per-bet stake is capped (`$10`, mock USDC).

---

## 3 · Pricing

### 3.1 The `p/B` touch bound (UP)

The de-margined probability `Mₜ` is, to a good approximation, a **martingale**. Fix a barrier
`B > p` and stop at `τ` = the first touch of `B` or full time. By the **optional stopping theorem**,
`E[M_τ] = p`. A path that never touches `B` cannot end at 1 (it can't reach 1 without crossing any
`B < 1` first), so on "no touch" it terminates at 0. Therefore:

```
p = B·P(touch) + 0·P(no touch)   ⟹   P(touch B) = p / B
```

Real paths **jump** (a goal reprices the line in a step), so at the crossing `M_τ ≥ B` — an
overshoot — which pushes the true touch probability *below* `p/B`. Hence **`p/B` is an upper
bound**, corrected downward by the measured discount.

### 3.2 DOWN symmetry

`1 − Mₜ` is also a martingale terminating in {0, 1}. Re-running the argument for a downward barrier
`b < p` gives:

```
P(touch down to b) = (1 − p) / (1 − b)
```

`pricing.ts` implements both (`touchBound`, `touchDownBound`), and the DOWN dealer path and UI are live.

### 3.3 Band and parlay

- **Band `[L, U]`** (UI: *Race*): does the line hit **U before L**? Priced by the classic
  gambler's-ruin identity, `(p−L)/(U−L)` — **exact** by optional stopping at the first exit, so no
  empirical discount is applied (spread only). We dropped "touches either edge" deliberately: a
  martingale that terminates in {0,1} always exits any interior band, so that product is
  probability ≈ 1 — degenerate. The race also gives the only market where **the NO side settles
  cryptographically too**: the first tick at-or-below L is itself a Merkle-provable resolution.
- **Parlay**: independent-leg approximation, price `= ∏ᵢ priceᵢ`, payout `= stake × ∏ᵢ multᵢ`.
  Legs may be cross-fixture (near-independent) or cross-line within a fixture (correlated — shown
  with a correlation disclaimer; the product price is then conservative for positively-correlated
  legs and generous for negatively-correlated ones).

### 3.4 The measured discount δ

We measured the gap directly. Across **109 matches** and **327 sampled paths**, for a grid of
barriers, we compared how often the path *actually* touched against the mean `p/B` the bound
predicted:

```
price = (p / B) · δ ,   δ = (observed touch rate) / (mean p/B) ≈ 0.87
```

δ hovers around 0.87 — touches happen ~87% as often as the frictionless bound says. It drifts toward
1 for high barriers (a path that reaches 90% had to pass smoothly through most of the way) and dips
for mid-barriers where goal-jumps overshoot hardest. The live per-barrier table is fetched from
`GET /api/calibration` and rendered in the in-app white paper (`/#/paper`, §3) and — reframed as
"why the price has a 0.87 in it" — attached to every quote's `× δ` term. The house adds a small
symmetric spread (`3%`) on top of the fair price.

The full derivation, the live δ table, and the honest caveats live in
`web/src/paper/WhitePaper.tsx` (rendered at `/#/paper`) — it is the pitch, and it is honest.

### 3.5 Heartbreak and comeback (result-conditioned)

These condition a touch on the *opposite* ending. Apply optional stopping **twice**. Stop at the
first touch `τ` of `B > p`: `P(touch) = p/B`. Restart the martingale at `M_τ ≈ B`; the probability
the team then **loses** is `1 − B`. Compounding:

```
HEARTBREAK   P(touch B, then lose)  =  (p/B)·(1 − B)          (B > p)
COMEBACK     P(touch A, then win)   =  A·(1 − p)/(1 − A)      (A < p, mirror via 1 − M)
```

Both are **one-sided upper bounds in the house's favour** — more strongly than the plain touch,
because jump overshoot (`M_τ ≥ B`) cuts *both* factors: it lowers `P(touch)` below `p/B` **and**
lowers `P(lose | touch)` below `1 − B`. We therefore do **not** multiply two independent discounts;
the heartbreak/comeback frequency is **measured directly** from the corpus (count paths that touched
`B` and ended at 0, per barrier bucket, across the 109 matches / 327 paths — the `calibration.ts`
pattern applies verbatim as a second empirical table).

**The launch example is itself a heartbreak that resolved YES.** England opened the semifinal near
`p = 36%`, its win probability touched **69.7%** at 54′, and England still lost 1–2. Bound before
discount: `(0.36/0.60)·(1 − 0.60) = 0.24`. Both prices are live today
(`dealerQuoteKind(..., "heartbreak" | "comeback", ...)`), each gated like its parent touch (UP gate
on `B` for heartbreak, DOWN gate on `A` for comeback).

---

## 4 · Liquidity and hedging (all market types)

Pricing says what's *fair*; it doesn't guarantee the house survives a run of winners. So every
ticket is **replicated** by an offsetting position in the underlying, sized so the book lands in the
same small place whether the barrier is touched or not.

### 4.1 Replication table

For a ticket owing payout **P** on a touch of barrier **B**, at current level **p**:

| Type | Hedge instrument | Position taken | Funds the payout because… |
|------|------------------|----------------|---------------------------|
| **UP touch B** | win-shares | buy **P/B** at price `p` | at the touch the win price is `B`, so `(P/B)·B = P` |
| **DOWN touch b** | NO-shares (1 − win) | buy **P/(1−b)** at price `(1−p)` | at the touch the NO price is `(1−b)`, so `(P/(1−b))·(1−b) = P` |
| **BAND [L,U]** | race (first-exit) | **P/(U−L)** win-shares at `p` plus a **−P·L/(U−L)** cash leg (net cost `P(p−L)/(U−L)` = the fair premium) | worth exactly `P` at a U-exit and `0` at an L-exit — **exact replication**, overshoot house-favourable |
| **HEARTBREAK B** | two-phase: win → NO | pre-touch **P(1−B)/B** win-shares at `p`; at the touch swap into **P** NO-shares at `(1−B)` | self-financing at inception *and* the switch; NO-shares pay `P` iff the team then loses — §4.5 |
| **COMEBACK A** | two-phase: NO → win | mirror of heartbreak (pre-touch NO-shares, swap to win-shares at the touch) | §4.5 |
| **O/U line** | the O/U contract itself | hold the goals-line probability contract | same bounded-martingale identity — hedge is the line |
| **Parlay** | rolling, leg-by-leg | hedge each leg as the prior legs survive YES | product replication; unwound as legs resolve |

Every lot is written to a **hedge ledger** (`server/src/chain/hedge.ts`): stake, venue price `p`,
shares, cost, venue tag. `treasury()` rolls the lots for a market into the **House Hedge Book**
panel; `realizeHedge()` books the settled P&L; `bookSummary()` gives the platform-wide roll-up. The
ledger records **every type**.

### 4.2 Self-financing identity

At the fair price the premium collected is exactly the cost of the shares:

```
premium  =  P · (p/B)         (what the user pays)
hedge cost =  (P/B) · p       (what the shares cost)   ⟹  premium − hedge cost = 0
```

So the hedge is self-financing at the fair price; the 3% spread and the overshoot are the house's
residual. This is the same replication that prices a barrier option, specialised to a market whose
underlying *is* a probability.

### 4.3 The three honest leaks

The book is **≈ 0 / outcome-independent**, not provably `= 0`. Three residuals, stated plainly:

1. **Jump overshoot** — the line stops *above* `B`, so the hedge is usually worth a little more than
   the payout. One-sided, in the house's favour; it is the flip side of the 0.87 discount and is the
   cost-of-carry (≈ 11.5% of premium) the discount hands back to users as better-than-fair odds.
2. **Execution slippage** — real venue fills aren't at the mid; the hedge eats a spread.
3. **Settlement-variable mismatch** — the ticket settles on the *touch of the de-margined line*; the
   win-share settles on the *match result*. They agree in the limit, not tick-for-tick.

**Worked example (from the live hedge ledger).** England–Argentina, one ticket:

| | value |
|---|---|
| Premiums collected | `$6.00` |
| Win-shares bought (P/B) at `p = 35¢` | cost `$6.70` |
| **Unhedged**, if it touches | **−$2.08** |
| Hedged, if it touches at B (no overshoot) | `−$0.70` |
| Hedged, if it never touches | `−$0.70` |
| **Actually settled** — a goal jumped the line to **69.7%** | **+$4.40** |

The win-shares bought at 35¢ liquidated at 69.7¢, turning a position *designed* to break even into a
`+$4.40` gain against the `−$2.08` the same outcome costs unhedged. That gap is the overshoot working
for the house. (A second settled ticket netted `$10 → +$1.89`. The white paper's worked example pulls
a genuinely-settled market from the hedge ledger rather than a fixed figure.)

### 4.4 Venue seam

The hedge is sized and priced off the **TxLINE de-margined win price** today — a defensible
efficient-market proxy: for a liquid match, a real win venue and the de-margined line agree, which is
the whole premise. The `venue` field on every hedge lot marks the source, so a **Polymarket / Kalshi
adapter** drops in per-market without touching the accounting. A **simulated venue with a
spread/slippage model** is added so hedge costs read realistically in the demo and the seam is
exercised end-to-end. Interface (conceptual):

```
interface HedgeVenue {
  price(marketRef): Promise<number>;          // current win/line probability p
  buy(shares, marketRef): Promise<Fill>;      // returns fill price incl. spread
  liquidate(shares, marketRef): Promise<Fill>;
}
```

### 4.5 The two-phase hedge (heartbreak / comeback)

Heartbreak's hedge is the win-share hedge with **one rebalance at the touch**. For payout `P` on
"touch `B` then lose":

1. **Pre-touch** — hold `P·(1−B)/B` win-shares. Cost `P·(1−B)/B · p = P·(p/B)(1−B)` — exactly the
   fair premium, so **self-financing at inception**.
2. **At the touch** — the shares are worth `P·(1−B)/B · B = P(1−B)`. Sell them and buy `P`
   **NO-shares** at price `(1−B)` — cost `P(1−B)`. **Exactly self-financing at the switch.** The
   NO-shares then pay `P` iff the team loses — funding the payout precisely when the heartbreak
   triggers.
3. **Never touches** — a path that never reaches `B` never reached 1, so the team lost; but the
   heartbreak claim pays 0 and the win-shares expire worthless. **Net zero.**

Comeback is the mirror (NO-shares pre-touch, swap into win-shares at the touch). Each is recorded as
a two-phase lot in the hedge ledger (`HedgeLot.kind`; `positionFor` / `lotValueAtSettlement` in
`hedge.ts`, with tests pinning `cost = P(p/B)(1−B)` and settlement `= P` at an exact-`B` touch). The
self-financing here is *exact at both inception and the switch* — a cleaner replication than the
plain touch, whose only residual is the overshoot.

---

## 5 · The instrument family — drama & realized variance

The touch is one member of a *class* of path instruments that only a proof-carrying odds feed can
settle. The unifying object is the **realized quadratic variation** of the anchored probability
path, `Σ (ΔM)²` summed over ticks — the total "excitement" of a match. A favourite-holds match is
near 0; a comeback thriller is large.

### 5.1 The drama theorem

For any martingale ending in {0, 1} from `M₀ = p` (using `M_T² = M_T`, and that `M² − [M]` is a
martingale):

```
E[ Σ(ΔM)² ]  =  E[M_T²] − p²  =  p − p²  =  p(1 − p)
```

- **The fair price of a match's drama is `p(1 − p)`** — model-free, exact, no discount in
  expectation.
- **In-play**, expected *remaining* drama is `M_t(1 − M_t)` — the current uncertainty, updating live
  (rendered as a "remaining-drama" gauge on the chart).
- **Whole match** (all three 1X2 lines): total fair drama `= Σ_o p_o(1 − p_o) = 1 − Σ_o p_o²` — the
  **Gini impurity of the kickoff probability vector**. A three-way coin-flip carries maximal drama
  (2/3); a foregone conclusion almost none.

### 5.2 The replication is *exact* (stronger than the touch hedge)

A discrete algebraic identity — no Itô, no discretisation error:

```
Σᵢ (M_{i+1} − M_i)²  =  M_T² − M₀² − 2 Σᵢ M_i·(M_{i+1} − M_i)
                     =  M_T − p² − 2 Σᵢ M_i·ΔM_i           (using M_T² = M_T)
```

So the house replicates a drama payout **pathwise**: hold **1 win-share**, a **dynamic `−2M_t`**
win-shares rebalanced each tick, and **`−p²` cash**. Because `M` moves *only* at ticks, per-tick
rebalancing makes the replication exact — a stronger result than the touch hedge, and it has its own
section in the white paper.

### 5.3 Honest caveats

1. **Proof burden.** `Σ(ΔM)²` over every tick is thousands of proofs. Three tractable settlements:
   (a) the `validateStatV3` **multiproof** (many ticks, one on-chain call); (b) a **minute-sampled**
   settlement variable (~100 proofs); (c) **optimistic** resolution where the challenge is a set of
   tick proofs that changes the sum.
2. **Microstructure noise.** Tick-level bid flutter inflates realized vs. theoretical variance —
   measurable from the corpus, so the 0.87 methodology extends verbatim (measure corpus-wide
   `observed Σ(ΔM)² / p(1−p)`; cap per-tick contribution or minute-sample to resist feed noise).

### 5.4 What's shipped vs. roadmap

- **Shipped**: this theorem and the exact-replication identity as a white-paper section, and the live
  **remaining-drama gauge** `M_t(1−M_t)` on the chart.
- **Roadmap**: a **drama leaderboard** on home — the server computes `Σ(ΔM)²` per finished fixture from
  the corpus and ranks the tournament's most dramatic matches (real data, zero settlement burden, every
  term in the sum Merkle-anchored); tradable **Drama Swaps** (realized-variance markets); a **peak
  ladder** (lookback) — `P(peak ∈ [B₁,B₂)) = touch(B₁) − touch(B₂)`, zero new pricing; **time-boxed
  touches** ("touches 60% before the 60th minute"), priced from the corpus's empirical first-passage
  distribution; and **occupation time** ("minutes of hope" above a barrier). Each is a path claim
  settleable *only* because individual odds ticks are provable — the family thesis: **the instrument
  family only a proof-carrying odds feed can settle.**

---

## 6 · Settlement and verification

A market resolves **YES** the moment a single odds tick prints **≥ B**. That one tick is the entire
evidence, and it is verifiable end-to-end:

1. Every odds tick in the corpus is a **leaf** in a Merkle tree; the **daily batch root** is anchored
   on Solana in a program-derived account (`daily_batch_roots` PDA), keyed by epoch-day and
   five-minute slot.
2. To settle, the resolver names the touching tick and fetches its **Merkle proof** from
   `GET /api/odds/validation?messageId&ts` — the sibling hashes from leaf to root.
3. The client recomputes the root from the proof and checks it against the on-chain PDA via
   `@txline/verify` (`verifyOddsProofOnChain`, a read-only mainnet RPC call). Match ⟹ the tick is
   real, unaltered, and was published before settlement.
4. The on-chain `resolve` instruction stores that evidence — `message_id` (48 bytes), `ts`,
   `prob_bps`, `root_hash` (the mainnet root), `pda` — alongside the resolution. **Nothing about the
   outcome is asserted by Touchline;** it is proven against data anchored independently by TxLINE, so
   anyone can re-run the check.

The UI surfaces the whole receipt: a settlement card shows the outcome, a `verified` badge, the
touching tick's probability, and rows that link the **bet transaction** and the **mainnet
`daily_batch_roots` PDA** out to **Solana Explorer** — the proof trail is clickable and independently
re-verifiable by anyone. During a sim/replay the
resolution can also **auto-fire** the moment the revealed path trips the barrier (up/down/band at the
trip; heartbreak/comeback wait for full time, since the result is part of the claim) — the on-chain
verification moment happens on its own.

Escrow is **fully collateralised at placement**: `place_bet` co-signs a transaction that moves the
user's stake **and** the house's liability into a per-market vault, so the full payout exists on
chain before the whistle. `resolve` sets the outcome; `claim` moves what's already locked — YES pays
the user, NO returns the escrow to the house. All wagering, escrow, and collateral is denominated in
a **mock USDC SPL token** — the TxLINE `TxL` credit token is used **only** for data authorisation, as
Track 1 requires, never for P2P value.

### UMA contrast

> **UMA-style optimism resolves disputes by token-holder vote; ours resolves them by cryptography.
> The challenge is a Merkle proof — or it's nothing.** There is no bond, no liveness window, no
> dispute quorum. Either the named tick chains to the mainnet-anchored root or the settlement is
> rejected.

### CPI honesty note (the cross-cluster seam)

Track 1 asks for a **CPI into TxLINE's `validate_stat`** from the settlement program. We do **not**
do a CPI, and here is the honest reason: **TxLINE anchors its roots on Solana mainnet; our program
is deployed on devnet. Cross-cluster CPI is impossible** — a devnet program cannot invoke a mainnet
account. So we do the economically-equivalent thing that *is* possible today:

- verify the proof **client-side against the real mainnet `daily_batch_roots` PDA** (read-only RPC,
  the same root a CPI would read), and
- **store the verified evidence on-chain** (devnet) so the settlement is independently re-verifiable
  by anyone with the mainnet RPC.

A **mainnet deployment would CPI directly** into `validate_stat` / `validateStatV3` at resolve time,
replacing the client-side check with an on-chain one — the resolver code already isolates the exact
call site (`server/src/proofs.ts` → `resolveMarketOnChain`). The `validateStatV3` multiproof is also
the natural fit for **parlay** settlement: multiple legs verified in **one** on-chain call.

---

## 7 · Architecture

pnpm monorepo at `~/Desktop/PulsePlay/touchline`:

```
touchline/
├─ server/   Fastify API (:4617)  — dealer, resolver, hedge ledger, bots
│            reads via @txline/client-sdk → txline-explorer platform (:3001) → SQLite corpus
│            verifies proofs via @txline/verify → Solana MAINNET RPC (read-only)
├─ web/      Vite + React SPA (:4618) — proxies /api → :4617
└─ onchain/  Anchor 1.1.2 program `touchline-market` (devnet)
```

- **Data layer** (`server/src/platform.ts`) — every product-path read goes through
  `@txline/client-sdk` against the running txline-explorer **platform** at `:3001`, which itself
  ingests TxLINE and serves a SQLite corpus (**117 fixtures, ~5.5M odds ticks**). Touchline reads
  that corpus and the platform's cached TxLINE credentials **read-only**; its own state lives in
  `server/.data`. The `asOf` seam truncates ticks/timeline to an observation instant so live and
  simulated (replay) consumers never see the future.
- **Proof layer** (`server/src/proofs.ts`, `creds.ts`) — fetches the odds Merkle proof directly from
  TxLINE (`txline.txodds.com`) with a guest JWT + cached apiToken, verifies against the mainnet PDA.
- **On-chain** (`onchain/programs/touchline-market`) — instructions `init_config`, `set_resolver`,
  `create_market`, `place_bet` (co-signed, fully collateralised), `resolve` (evidence-attested),
  `claim`. Parlay adds `place_parlay` / `claim_parlay` (payout escrow across leg market pubkeys;
  claim requires all legs resolved YES).
- **Market identity & re-runnability** — the five bet kinds, the probability line, and a re-run
  *epoch* are **encoded into the existing PDA seeds** with no program change: `side = kind·3 + side`,
  `fixture_id = fixtureId | line<<32 | epoch<<40` (`server/src/chain/service.ts`). The ledger keeps
  the decoded fields while the chain sees stable unique seeds, so bumping the epoch mints a fresh
  market and a resolved demo re-runs without a validator reset. Band markets carry the lower
  edge in the ledger; the chain's `barrier` is the upper edge.
- **Bots** (`server/src/chain/bots.ts`) — four autonomous strategies (NearLine, Momentum, LongShot,
  Quant), each with its own funded session wallet, trading deterministically against the dealer so
  the activity feed and hedge book show a live market. Zero manual intervention once started.
- **Wallets** — **custodial session wallets** (server-held keypairs, funded by the house) for the
  devnet demo; the connected Phantom wallet is **identity/display only** (non-custodial signing —
  the user signs each bet in Phantom — is a roadmap item).

---

## 8 · TxLINE endpoints used

### 8.1 Platform SDK calls (`@txline/client-sdk` → txline-explorer platform, `:3001`)

The platform is TxLINE-derived: it ingests the upstream feed (§8.2) and re-serves it as a clean,
`asOf`-aware, corpus-backed API. Touchline consumes it through the typed SDK.

| SDK method | Platform route | Used for |
|------------|----------------|----------|
| `fixtures({ limit })` | `GET /v1/fixtures` | fixture list (home tiles) |
| `fixture(id)` | `GET /v1/fixtures/{id}` | fixture detail + **timeline** (status phases, minute-stamped events, scoreline) |
| `oddsRaw(id, { market, asOf, limit })` | `GET /v1/fixtures/{id}/odds?raw=1` | full-precision tick path per market (1X2 and O/U); `market` selects the line, `asOf` time-travels |
| `stream({ fixtureId } \| "odds" \| "scores")` | `GET /v1/stream/…` (resumable SSE, `Last-Event-ID`) | live tick push for the final capture |

Also available on the SDK and used incidentally / for validation: `odds()` (downsampled OHLC for
charts), `state()`, `markets()`, `coverage()`, `worker()` (feed heartbeat/lag),
`validateOdds/validateScores/validateFixture` (`/v1/validation/*`).

### 8.2 Upstream TxLINE endpoints (`txline.txodds.com`, ingested by the platform)

Auth on every data call: `Authorization: Bearer <guest JWT>` + `X-Api-Token: <apiToken>`.

| Endpoint | Purpose |
|----------|---------|
| `POST /auth/guest/start` | short-lived **guest JWT** (no chain, free) |
| `GET /api/fixtures/snapshot?competitionId&startEpochDay` | forward 30-day fixture window |
| `GET /api/scores/updates/{fixtureId}` | full ordered per-fixture score sequence (**SSE-framed**) |
| `GET /api/scores/updates/{epochDay}/{hourOfDay}/{interval}?fixtureId` | historical 5-min score slice |
| `GET /api/odds/updates/{epochDay}/{hourOfDay}/{interval}?fixtureId` | historical 5-min **odds** slice (in-play odds only via intervals) |
| `GET /api/odds/snapshot/{fixtureId}?asOf` | latest odds per market, time-travel via `asOf` |
| `GET /api/odds/validation?messageId&ts` | **Merkle proof for one odds tick** — Touchline's settlement evidence |
| `GET /api/scores/stat-validation?fixtureId&seq&statKey(s)` | stat Merkle proof (V1 single / V2 multi-stat) |
| `GET /api/fixtures/validation?fixtureId&timestamp` | fixture-update Merkle proof |
| `daily_batch_roots` **PDA reads** (Solana **mainnet** RPC, via `@txline/verify`) | the anchored root each proof chains to |

---

## 9 · Feedback on the TxLINE API

We used TxLINE as the **primary live input** for both the probability path and the settlement proofs,
so we exercised a lot of the surface. Honest notes:

### Friction

- **SSE framing changed mid-tournament.** The live stream's frame format shifted — we had to tolerate
  **both** standard `data:` SSE lines **and** the legacy `Message:` prefix the earlier docs described.
  Our parser sniffs per body (`frameToRecords`).
- **Mixed content type regardless of `Accept`.** The same list endpoints return sometimes a JSON
  array, sometimes an SSE dump, independent of the `Accept` header — so every list call has to
  content-sniff (`parseRecords`) rather than trust a declared type.
- **PascalCase vs camelCase within one API.** Odds-tick fields are PascalCase (`Pct`, `PriceNames`,
  `Ts`, `MessageId`, `MarketPeriod`); fixture/REST fields are camelCase. Mixed casing in one payload
  set is a persistent foot-gun.
- **`weeks=1` rejected.** A documented query parameter was refused by the server; we worked around it
  with epoch-day windows.
- **Opaque token-expiry semantics.** The `apiToken` has no reliable client-side expiry signal; the
  guest JWT's `exp` is parseable but the practical contract is "refresh on 401 and retry," which we
  had to build defensively (`creds.ts`).
- **`/historical` window limits.** In-play data is only addressable in **5-minute interval** slices —
  no arbitrary time window — so backfilling a full match means iterating intervals.
- **Odds have no per-fixture backfill.** Scores expose `GET /api/scores/updates/{fixtureId}` (whole
  sequence in one call), but odds only via `…/{epochDay}/{hourOfDay}/{interval}`. That asymmetry made
  path reconstruction more code than it should be.
- **~40s publish latency** measured on the live feed, and a **~73s suspension → step-reopen**
  microstructure — worth documenting so consumers don't treat the feed as instantaneous.
- **Namespace quirk in fixture proofs** — fixture proofs echo the `FixtureId` in a high-bits
  namespaced form (`0x3000000000000 | fixtureId`); undocumented, found by inspection.

### What we liked

- **De-margined `Pct` = true probabilities.** The sponsor's own thesis, and the foundation of the
  whole product — we could price a martingale directly instead of un-vigging a book ourselves.
- **Provable odds ticks.** `/api/odds/validation` makes *individual ticks* Merkle-provable, not just
  final scores — which is the only reason a path-dependent "did it ever touch?" claim is settleable
  trustlessly.
- **Sub-second tick feed.** Rich enough paths (millions of ticks across the corpus) that the touch
  statistics — and the whole replay-demo strategy — actually work.
- **The anchoring design.** Daily roots on Solana mean settlement re-verification needs *only* a
  public RPC and the proof — no trust in Touchline, no trust in TxLINE's servers at claim time.
- **`validateStatV2/V3` multiproofs.** Multiple stats/legs verifiable in one on-chain call — a clean
  path from our parlay product to single-call multi-leg settlement.

---

## 10 · Devnet deployment and how to run

**Deployed artifacts**

| Item | Value |
|------|-------|
| Program (devnet) | `6kZYYdZLJcsU2ZBKKthc7BpddUiYdTbAtGigS2bJc53K` |
| Deploy authority / house / resolver / mint authority | `5nBA87pXc63mM2i2uFfyMKa3uwRagg499xecGhpKjCyJ` |
| Collateral | mock USDC SPL mint (zero real value), **$10** per-bet cap |
| Proof-verification RPC | Solana **mainnet-beta** (read-only, `daily_batch_roots`) |

The program is live on **real devnet** (redeploy required `solana program extend … 10240` first —
the CLI's auto-extend was below devnet's 10 KB minimum). The API was repointed at devnet and
re-provisioned a fresh mock-USDC mint.

**Run the stack** (the txline-explorer platform must be up at `:3001` first, with its corpus DB and
token cache present):

```bash
# 1. platform (dependency) — in txline-explorer:  pnpm --filter @txline/api dev   # :3001

# 2. Touchline API on devnet (bots on), from touchline/:
cd server && TOUCHLINE_BOTS=1 pnpm start          # :4617, no RPC override = real devnet

# 3. web:
cd web && pnpm dev                                # :4618  (proxies /api → :4617)
```

Then: home → a match (`/#/m/<fixtureId>`) → **Faucet 100** → **Bet** → watch the **House Hedge
Book** → **Settle & claim** (mainnet-verified Merkle receipt). White paper at `/#/paper`.

**State.** Type-checking is clean across the workspace (`pnpm -r typecheck`), and the server test
suite runs green — 39 hermetic tests covering pricing bounds, touch detection, market lifecycle,
dealer gating, phase derivation, and hedge replication. The full on-chain lifecycle (place → resolve →
claim) and the hedge record-to-realize path run end-to-end; the white paper renders live calibration
from the corpus; and the bot fleet trades and auto-hedges on devnet.

**Environment knobs:** `TOUCHLINE_DEVNET_RPC` (override the cluster; unset = devnet),
`TOUCHLINE_BOTS=1` (start the bot fleet), `TOUCHLINE_HOUSE_KEYPAIR` (house/resolver key),
`SOLANA_RPC_URL` (mainnet RPC for proofs), `TXLINE_PLATFORM_URL` (default `http://localhost:3001`),
`TXLINE_API_BASE` (default `https://txline.txodds.com`).
