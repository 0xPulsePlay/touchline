# New path instruments — Heartbreak, Comeback, Drama Swaps (ideation handoff)

> Context for another session working on this repo. These are product ideas that extend the
> existing p/B one-touch machinery. Everything below is derived from the same standing assumption
> the whole product rests on: the de-margined outcome probability `M_t` is a martingale that
> terminates in {0,1}, with `M_0 = p`. All quotes get the same empirical-calibration treatment as
> the existing 0.87 discount. Deadline context: NIGHTSHIFT-3.md — demo tonight (Sun Jul 19,
> 19:59 local). Priorities at the bottom.

---

## 1. Heartbreak insurance + Comeback markets — **build tonight** (rides the B1 type tabs)

**The market:** "England touches 60% *and still loses*." Pays out precisely when it hurts the
most. Mirror product (Comeback): "England drops to 15% *and still wins*."

### Pricing — optional stopping applied twice

Stop at the first touch τ of barrier `B > p`: `P(touch B) = p/B` (existing theorem). On the touch
event, restart the martingale at `M_τ ≈ B`: the probability the team *loses* from there is
`1 − B`. Therefore:

```
P(touch B, then lose) = (p/B) · (1 − B)                   — HEARTBREAK, B > p
```

Comeback derivation: `1 − M_t` is a martingale from `1 − p`. Touching down to `A`
means `1 − M` touches `1 − A`, so `P(touch A) = (1−p)/(1−A)`. From the touch, `M_τ ≈ A`, so
`P(win | touched A) = A`. Hence:

```
P(touch A, then win) = A · (1−p)/(1−A)                    — COMEBACK, A < p
```

Sanity check on the launch example (England semifinal): `p = 0.36`, `B = 0.60` →
heartbreak bound = `0.60 × 0.40 / 0.60`… i.e. `(0.36/0.60)·(0.40) = 0.24` before discount.
England touched 69.7% at 54′ and lost 1–2 — **the launch example IS a heartbreak that resolved
YES.** The README's best anecdote is literally this product.

### Why the bound is one-sided (same house-favorable structure as p/B)

Jump overshoot means `M_τ ≥ B`, which *cuts* `P(touch)` below `p/B` AND *cuts* `P(lose | touch)`
below `1 − B`. Both biases favor the house, so `(p/B)(1−B)` is an upper bound, exactly like the
existing quote. Don't multiply the two discounts independently — measure the heartbreak frequency
**directly** from the corpus: across the 109 finished matches / 327 paths, count paths that
touched B and ended at 0, per barrier bucket. That's a second calibration table from data we
already have (`calibration.ts` pattern applies verbatim).

### Settlement — everything already exists

- YES = one touch-tick Merkle proof (existing `touch.ts` + `proofs.ts` machinery) **AND** final
  result = loss (the home tiles already compute true winners from the scores feed, including
  ET/pens).
- NO = optimistic-with-cryptographic-challenge, same as today's NO-side.

### Hedge — a two-phase version of the existing hedge (slots into `hedge.ts`)

For payout `P`:

1. **Pre-touch:** hold `P·(1−B)/B` win-shares (cost `P·(1−B)/B · p = P·(p/B)(1−B)` = the fair
   premium — self-financing at inception).
2. **At the touch:** the shares are worth exactly `P·(1−B)/B · B = P(1−B)`. Sell them; buy `P`
   NO-shares at price `(1−B)` each — cost `P(1−B)`. **Exactly self-financing at the switch.**
   The NO-shares then pay `P` iff the team loses, funding the payout.
3. **Never touches:** a path that never touches B cannot reach 1, so the team lost — but the
   heartbreak claim pays 0, and the win-shares expire worthless. Net zero.

Comeback hedge is the mirror (NO-shares pre-touch, switch to win-shares at the touch).
Implementation: record it as a two-phase lot in the hedge ledger; the `venue` seam is unchanged.

### Effort estimate

Small marginal cost **given B1 (type tabs) is being built anyway**: two more entries in the type
picker, two one-line pricing functions, winner-determination reuse, a two-phase hedge lot.
Narrative payoff is the largest of anything on the board.

**Demo line:** *"Polymarket pays you when your team wins. Touchline can pay you when your team
breaks your heart — and prove it with one Merkle proof."*

Optional naming if "Heartbreak/Comeback" feels off-brand: **Icarus** (flew to 69.7%, fell) /
**Lazarus**.

---

## 2. Drama Swaps — realized-variance markets (**theorem → white paper tonight; market → roadmap**)

**The market:** trade the total *excitement* of a match, defined as the realized quadratic
variation of the anchored probability path: `Σ (ΔM)²` summed over ticks. A dull
favorite-holds match ≈ 0; a comeback thriller is huge.

### The one-line theorem (as clean as p/B)

For any martingale ending in {0,1} starting at `p` (since `M_T² = M_T` and `M² − [M]` is a
martingale):

```
E[ Σ(ΔM)² ] = E[M_T²] − p² = p − p² = p(1−p)
```

- **The fair price of a match's drama is `p(1−p)`** — model-free, exact, no discount needed in
  expectation.
- **In-play:** expected *remaining* drama is `M_t(1−M_t)` — the current uncertainty, updating
  live.
- **Whole match (all three 1X2 lines):** total fair drama = `Σ_o p_o(1−p_o) = 1 − Σ p_o²` — the
  **Gini impurity of the kickoff probability vector**. A three-way coin-flip match carries
  maximal drama (2/3) by construction; a foregone conclusion carries almost none.

### The hedge is EXACT, not approximate (stronger than the touch hedge)

Discrete algebraic identity — no Itô, no discretization error:

```
Σᵢ (M_{i+1} − M_i)²  =  M_T² − M_0² − 2 Σᵢ M_i·(M_{i+1} − M_i)
                     =  M_T − p² − 2 Σᵢ M_i·ΔM_i          (using M_T² = M_T)
```

So the house replicates a drama payout **pathwise**: hold 1 win-share, plus a dynamic position of
`−2M_t` win-shares rebalanced at each tick, plus `−p²` cash. Since `M` only moves at ticks,
rebalancing per tick makes the replication exact. This is a *stronger* replication result than
the touch hedge and belongs in the white paper as its own section.

### Honest caveats (write these down, they're part of the brand)

1. **Settlement proof burden:** `Σ(ΔM)²` over every tick = thousands of proofs. Options:
   (a) the validateStatV3 **multiproof** story (already referenced in NIGHTSHIFT-3 §B5),
   (b) define the settlement variable on a minute-sampled grid (~100 proofs, tractable),
   (c) optimistic resolution where the challenge is a set of tick proofs that changes the sum.
2. **Microstructure noise:** tick-level bid flutter inflates realized vs. theoretical variance.
   Measurable from the corpus — the 0.87 calibration methodology extends verbatim (measure
   corpus-wide `observed Σ(ΔM)² / p(1−p)` ratio; also consider capping per-tick contribution or
   minute-sampling to resist feed noise).

### What's feasible TONIGHT (don't build the tradable market)

- **(a) White paper section** — "the instrument family": the theorem + exact replication
  identity. Shows p/B one-touch is one member of a *class* of instruments only a proof-carrying
  odds feed can settle. This alone upgrades the differentiation argument.
- **(b) Live "remaining drama" gauge** on the chart: render `M_t(1−M_t)` — trivial.
- **(c) Drama leaderboard** (~1h): server computes `Σ(ΔM)²` per finished fixture from the corpus;
  home tiles get sortable drama scores. Real data, zero settlement burden, instantly legible in
  the 5-minute video ("this number says the semifinal was the most dramatic match of the
  tournament — and every term in the sum is Merkle-anchored").

---

## 3. Smaller garnishes (descending value-per-hour)

- **Peak ladder (lookback):** "Where will England's probability peak?" The max's distribution is
  just differences of touch quotes you already have:
  `P(peak ∈ [B₁, B₂)) = touch(B₁) − touch(B₂)`. A parimutuel ladder needs **zero new pricing**;
  rungs render naturally on the existing chart. Settlement: one tick proof ≥ B₁ + NO-style
  challenge for anything above B₂.
- **Time-boxed touches:** "touches 60% *before the 60th minute*." No closed form, but the corpus
  gives the empirical first-passage-time distribution across 327 paths — showcases that the
  calibration engine prices what theory can't. Settlement is trivial (tick timestamp).
- **Occupation time** ("minutes of hope" above B): payout ∝ time spent above the barrier. No
  closed form, settlement is path-segment-heavy — white-paper future-work mention only.

---

## Priority call (given tonight's deadline)

1. **Heartbreak + Comeback as bet types** riding the B1 tab refactor — smallest marginal cost,
   biggest narrative payoff; the launch example already is one.
2. **Drama theorem + exact replication identity into the white paper**; **remaining-drama gauge**
   on the chart.
3. **Drama leaderboard** on home if an hour is spare.
4. Everything else (tradable Drama Swaps, peak ladder, time-boxed touches) → technical write-up
   roadmap section: "the instrument family only a proof-carrying odds feed can settle."
