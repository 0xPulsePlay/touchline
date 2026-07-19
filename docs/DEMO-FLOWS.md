# Touchline — Demo Flows (recording plan)

The ≤ 5-minute demo video, shot in order, with what to click, what must be on screen, and the
fallback when something hiccups. **Judging happens after the tournament, so there are no live matches
during review — the *simulation* is the demo.** **⚡ Simulate live** replays a finished match
tick-by-tick from the real anchored TxLINE feed: same pipeline, same proofs, same on-chain
settlement a live match runs — just re-runnable on demand. Say that confidently; don't apologise for
it. The live final (Flow 0) is a ~20-second credibility shot, nothing more.

> **Legend.** ⚠️ = built during the Jul 19 night shift — **check it's live before you record.**
> Local URLs: home `http://localhost:4618/#/`, match `…/#/m/<fixtureId>`, white paper `…/#/paper`.
> Reliable replay fixture: **England–Argentina semifinal `18241006`** (rich path, bots trade it) —
> and it is the **heartbreak hero**: England's win probability touched **69.7%** at 54′ and England
> still lost 1–2, so a HEARTBREAK market on it settles **YES**. Live capture: **the final, Spain v
> Argentina** (15:00 local kickoff). Bet types: **UP · DOWN · BAND · HEARTBREAK · COMEBACK** ⚠️.
> Centerpiece control: **⚡ Simulate live** (finished match → tick-by-tick replay). Funding lives in
> the **AppBar wallet menu** ⚠️ (top-right), done once before recording — the faucet is **not** on the
> bet card.

---

## Pre-recording checklist (do all of this before hitting record)

**Services (in order):**
- [ ] txline-explorer **platform** up at `:3001` (`pnpm --filter @txline/api dev`) — Touchline reads
      it; nothing works without it. Confirm `curl localhost:3001/v1/fixtures` returns fixtures.
- [ ] Touchline **API** on devnet with bots: `cd server && TOUCHLINE_BOTS=1 pnpm start` (:4617).
      Watch the log for `[bots] N bots funded; trading loop starting`.
- [ ] Touchline **web**: `cd web && pnpm dev` (:4618). Open it and hard-refresh.

**Chain / wallet:**
- [ ] `GET /api/chain/state` shows `cluster: "devnet"`, `ready: true`, a non-null `usdcMint`.
- [ ] Deploy authority `5nBA87…` has SOL for fees (a few devnet SOL is plenty).
- [ ] ⚠️ **Fund the wallet from the AppBar wallet menu BEFORE recording** — open the wallet pill
      (top-right), grab devnet funds, confirm the balances read like real **SOL** and **USDC**. The
      faucet must never appear mid-demo; you want a funded wallet from frame one.
- [ ] ⚠️ **Phantom connects** and shows a pubkey pill (A3 fix). If flaky, the custodial session
      wallet still shows balances + funds — the loop is unaffected.

**Markets fresh / re-runnable:**
- [ ] ⚠️ **Bump the epoch for a fresh market** (B4: the PDA seeds carry a re-run `epoch`), so the
      exact heartbreak-60% demo re-runs clean between takes without a validator reset. Confirm a
      fresh-epoch market opens `open` (not `already yes`) before each take.
- [ ] Confirm the replay fixture `18241006` still has a touching tick for your chosen barrier (drag
      the slider to ~60% for `part1` — it settles YES).
- [ ] ⚠️ **Heartbreak hero:** a HEARTBREAK bet on England `part1` touch **60%** on `18241006`
      resolves **YES** (touched 69.7%, lost 1–2). Test it once before recording — it is the
      emotional center of the demo.
- [ ] ⚠️ The bet-type tabs show **five** kinds (UP/DOWN/BAND/HEARTBREAK/COMEBACK) and each quote
      decomposes on screen (heartbreak = `p/B × (1−B) × δ`).
- [ ] ⚠️ If sim-time auto-settlement (task #28) is on, the market may resolve itself as the replay
      clock passes the touch — decide whether you're clicking **Settle** or narrating the auto-fire.
- [ ] Bots are visibly trading: the **Live market activity** feed shows 🤖 rows within ~12s.

**Capture:**
- [ ] 1080p, browser at comfortable zoom (the quote decomposition text must be legible).
- [ ] ⚠️ **Sim speed = 180×** — it reads well on screen (a full match resolves in a demo-friendly
      window without feeling static). Confirm the speed control before recording.
- [ ] ⚠️ **Solana Explorer tab pre-loaded** at `explorer.solana.com` with **`?cluster=devnet`**
      already set (signed in / not rate-limited), so the settlement link opens instantly to the right
      cluster mid-demo.
- [ ] Have `/#/paper` open in a second tab, pre-scrolled to the `p/B` bound, the hedge, and ⚠️ the
      new **drama** section (`p(1−p)`).
- [ ] Cold-open live-final tab ready (Flow 0), with the `18241006` replay as the instant fallback if
      the live feed lags.

---

## Flow 0 — Cold open on the live final (0:00–0:30)

**Goal:** open on a real probability *moving*, not a static screen.

- **Show:** the match page for the live final (`/#/m/<final-id>`), the probability graph as the hero
  series, score + phase in the header, the line **ticking** as play happens. ⚠️ live tick push via
  the SDK `stream()` seam — if not wired, poll `/api/fixtures/:id/path` fast (the chart already
  refreshes).
- **Clicks:** none — let it breathe for a beat, then cursor rests on the rising/falling line.
- **Pivot to the sim (say it):** "judging happens after the tournament, so let me show you the exact
  same pipeline on a match that already finished — replayed tick-by-tick." This licenses the whole
  sim centerpiece and reframes replay as a *feature*, not a fallback.
- **What can go wrong / fallback:** live feed lags (~40s publish latency is normal) or the final
  isn't underway → **cold-open on the replay** of `18241006` instead, scrubbing the path so it
  visibly moves. The story ("watch this number walk") is identical; only the "live" label changes.

---

## Flow 1 — The problem (0:30–1:00)

**Goal:** frame why a *path* market is different from a result market.

- **Show:** the same graph, now with a barrier line implied. Gesture at the journey — the near-misses,
  the swings — not the final score.
- **Clicks:** none (or hover the peak of the path to highlight "it almost got here").
- **Fallback:** none needed — this is narration over Flow 0's screen.

---

## Flow 2 — Home tiles (1:00–1:20)

**Goal:** show it's a real product with a market surface, not one hard-coded match.

- **Clicks:** navigate to home (`/#/`). Let the **fixture tiles** render — flags, sparklines,
  finished-match badges, the winner-accented spark.
- **Show:** the "Read the math →" hero link; the density of tiles (the corpus is real).
- ⚠️ **Wallet nod (≤3s, optional):** open the **AppBar wallet menu** once — "devnet SOL and USDC,
  already funded" — then close it and never touch it again. It's pre-funded per the checklist; this
  is just to show real balances, **not** a faucet moment.
- ⚠️ **Optional (stretch):** if the **drama leaderboard** shipped, sort tiles by drama score and land
  the line — "this number says the semifinal was the most dramatic match of the tournament, and every
  term in the sum is Merkle-anchored" — then open the top one.
- **What can go wrong / fallback:** a tile's sparkline is empty for a no-feed fixture (handled — it
  renders pre-match odds). Pick a tile with a visible path. Click into `18241006` (the heartbreak hero).

---

## Flow 3 — Into a match · line picker (1:20–1:50)

**Goal:** the path is selectable — 1X2 today, and more.

- **Clicks:** on the match page, the **graph + score are pinned on top** (they survive every tab
  switch). ⚠️ Use the **line picker** to switch the hero series — e.g. "England win" → "Over 2.5
  goals" — and watch the graph redraw to the chosen probability line.
- **Show:** the chosen line drives the graph *and* the bet below. ⚠️ the **five bet-type tabs**
  (UP / DOWN / BAND / HEARTBREAK / COMEBACK) sit above the card. ⚠️ optional: a **remaining-drama
  gauge** on the chart shows `M_t(1−M_t)` — the live uncertainty, highest at a coin-flip.
- **What can go wrong / fallback:** ⚠️ if the O/U line or a given tab isn't finished, **stay on 1X2**
  and whichever tabs are live — the flow still works end-to-end; just don't demo what isn't built.
  (Mark this the moment you test the build.)

---

## Flow 4 — Centerpiece: Simulate live → place the Heartbreak → the event happens (1:50–2:50)

**Goal:** the whole thesis in one continuous take — hit **⚡ Simulate live**, place a real on-chain
prediction, and watch the predicted moment *happen* on the replayed path. **This is the video.**

- **Setup:** on `/#/m/18241006` (England semifinal — a *finished* match), **HEARTBREAK** tab, side
  **England `part1`**. Wallet already funded (checklist).
- **Clicks:**
  1. **⚡ Simulate live** — say: "this match already finished; watch — we replay the real anchored
     feed tick-by-tick, the exact pipeline a live match runs." The path starts advancing from
     kickoff (⚠️ ~180× speed; the reveal edge sweeps right).
  2. Drag the **barrier slider** to **60%** — "England touches 60% *and still loses*." Read the
     **quote decomposition** `p/B 36%/60 = 60% × (1−0.60) × 0.87` and teach it: a team at 36% reaches
     60% about `p/B` of the time, and from the summit still loses `1−B` of it.
  3. Enter **$10** in the stake box (or tap a quick chip) and hit **Place** →
     `Position live on-chain — $10 → $… if it hits.`
  4. **Now stop clicking.** Let the sim run. As the replay clock reaches ~54′ the line **jumps to
     69.7%** — the predicted touch *happens on screen*. Point at it: "there it is — the touch."
- **Show:** the moving path, the barrier line, the trigger marker firing as the path crosses, the
  live reveal edge. The prediction and the event share one screen — the core idea, made visible.
- **What can go wrong / fallback:**
  - ⚠️ Heartbreak tab not live → plain **UP** touch at 60% (teach just `p/B`); the sim beat is
    identical, you only lose the "and still loses" hook. Verify this one early.
  - ⚠️ Sim not wired → use the manual replay scrubber to walk the path across the barrier and narrate
    the same way. (The Flow 6 auto-settlement needs the sim/reveal cursor — verify it together.)
  - Place fails → wallet unfunded (checklist) or barrier below the gate (`pick ≥ X%`); nudge up.
    Devnet can 429 under load — the server retries; just wait for the confirmation line.

---

## Flow 5 — House Hedge Book appears live (narrate over the running sim, ~2:20–2:50)

**Goal:** show the bet is *hedged the instant it's written* — narrate this while the sim keeps
advancing, before the touch fires.

- **Clicks:** none — the moment the bet lands (still mid-sim) the **House hedge book** panel appears
  and refreshes every 4s as bots trade into the same book.
- **Show, in order:**
  - "buys **N win-shares** at `p¢` on the TxLINE win price (cost `$…`)".
  - ⚠️ For the **heartbreak** ticket it is a **two-phase** hedge: pre-touch it holds win-shares; at
    the touch it swaps into NO-shares that pay iff the team then loses — self-financing at both steps.
    Line: "the payout is funded by the hedge, precisely when the heartbreak triggers."
  - The three scenario rows: **unhedged a touch would cost `−$…`**; **hedged, touches 60% → net `≈$…`
    + jump overshoot**; **never touches → net `≈$…`**. The point: hedged net is the same small number
    either way.
  - Premiums-in / Payout-if-touches / Hedge-cost grid.
- **What can go wrong / fallback:** panel needs `treasury.bets > 0` — it only shows after a bet lands.
  If it's blank, the bet didn't confirm; re-place. Bots trading `18241006` keep the book populated
  even before your bet.

---

## Flow 6 — Resolution fires on-chain → Solana Explorer → claim (2:50–3:50)

**Goal:** the climax — the predicted event just happened, and the settlement resolves itself on
devnet, provably, in front of the judge. **This is the on-chain verification moment.**

- **Clicks / what happens:**
  1. As the sim passes the touch (and, for heartbreak, runs to full time — the *loss* is part of the
     claim), **resolution auto-fires** ⚠️ (task #28): the **settlement panel** appears —
     `Resolved YES`, a `verified` badge, the touching probability (69.7%), the **devnet transaction
     signature**, and the **Merkle receipt PDA** with the **root match**. (If auto-settle isn't on,
     click **Settle & claim →** — identical result.)
  2. **Open the Solana Explorer link** from the panel — it opens
     `explorer.solana.com/tx/…?cluster=devnet`. **Pause here.** Let it load, then say:
     **"that's the settlement — on-chain, provable."** Show the tx, then click through to the PDA
     address (the mainnet root the tick was checked against).
  3. Back in the app the payout is **claimed** (auto on YES) and the **balance ticks up**.
- **Say it (the heartbreak close):** "the *touch* is proven by one Merkle proof against mainnet; the
  *loss* is the final score. It broke your heart — and we proved it, on-chain."
- **Show:** the settlement panel, the Explorer page (real devnet tx + PDA), the balance increase, and
  the hedge book flipping to its settled line (`premiums − hedge + liquidation − payout`).
- **What can go wrong / fallback:**
  - Auto-settle didn't fire → click **Settle & claim →** manually; identical result. (409 mid-sim is
    normal *before* the trigger — for heartbreak it stays pending until it has *also* lost.)
  - Explorer slow / rate-limited → you pre-loaded the `?cluster=devnet` tab (checklist); worst case,
    show the panel's PDA + root-match and say "the same evidence is stored in our program —
    re-checkable by anyone." Pre-record one clean Explorer take as insurance.
  - Proof fetch/verify hiccup (upstream TxLINE or mainnet RPC) → the settle still resolves on the
    tick; the receipt may read `verified: false`. Re-run once, or narrate a prior clean take.
  - Market `already yes` → bump the epoch for a fresh market (checklist).

---

## Flow 7 — White-paper beat (3:50–4:20)

**Goal:** the math is real and measured, in one screen.

- **Clicks:** the **`· how?`** link on the quote (or the hero "Read the math →") → `/#/paper`.
- **Show:** the `P(touch B) ≤ p/B` hero equation; the **live calibration table** (109 matches / 327
  paths, δ ≈ 0.87) — emphasise these are *measured*, fetched live; the net-zero replication table +
  worked example (⚠️ C3 pulls a genuinely-settled market from the ledger); and ⚠️ the **drama
  section** — "the fair price of a match's drama is `p(1−p)`, model-free" — the instrument family
  only a proof-carrying odds feed can settle.
- **Fallback:** the table loads from `/api/calibration`; if it says "loading…", the platform/DB isn't
  up — but you checked that in the pre-flight. Pre-scroll in the second tab to avoid dead air.

---

## Flow 8 — Parlay ticket (4:20–4:45) ⚠️

**Goal:** multi-leg, one verification pass.

- **Clicks:** ⚠️ open the **parlay / ticket builder**, add **2–3 legs** (cross-fixture, or
  cross-line with the correlation disclaimer), watch the **combined price = product of legs** and the
  stacked payout multiple. Place it (fully-collateralised `place_parlay`).
- **Show:** the leg list, the multiplied odds, "all legs must resolve YES", the single settlement
  path (ties to `validateStatV3` multiproof — multi-leg evidence in one on-chain call).
- **What can go wrong / fallback:** ⚠️ if parlay isn't finished at record time, **cut this flow** and
  give the freed ~25s back to Flows 5–6 (hedge + proof are the stronger beats). Do not demo a
  half-built builder.

---

## Flow 9 — Net-zero treasury close (4:45–5:00)

**Goal:** land the thesis — the house runs a flat book, the payout is funded by the hedge.

- **Show:** the settled hedge book (or the platform-wide roll-up from `/api/treasury`) — premiums in,
  hedge cost, liquidation, payout, and the small outcome-independent residual. The bots' activity
  feed still ticking underneath (autonomous, live).
- **Clicks:** none — closing narration over the settled book.
- **Fallback:** if the roll-up view isn't surfaced, close on the single settled market's hedge-book
  line from Flow 6 — it makes the same point.

---

## If you have to cut for time (priority order)

The spine is one continuous sim take: **Flow 4 (Simulate live + heartbreak + the event happening) →
Flow 6 (resolution fires on-chain + Solana Explorer + claim)**, with **Flow 5 (hedge)** narrated over
it and **Flow 0 (live-final credibility)** in front. Keep those. First to cut: the ⚠️ **drama
gauge/leaderboard** garnishes, then **Flow 8 (parlay)** if ⚠️, then Flow 1, then **Flow 7** trimmed to
the `p/B` + drama lines, then Flow 9 (collapse into Flow 6). **Never cut the sim → event →
on-chain-settlement → Explorer sequence — that IS the submission.**
