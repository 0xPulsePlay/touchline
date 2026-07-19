# Night Shift #3 — Requirements (full coverage) → Demo-ready by Sun Jul 19

**Hard constraints (from HACKATHON-MUST-INCLUDES.md):**
- **Deadline: TONIGHT — Sun Jul 19, 23:59 UTC = 19:59 local.**
- **The final (Spain v Argentina, 15:00 local / 19:00 UTC) is the LAST live-demo window** — the
  ingestion worker is fixed + running, so in-play odds will stream live during it. Capture footage.
- Demo video ≤ 5 min is an absolute screening requirement. Judging happens after the tournament —
  the demo must carry everything on its own (replay engine = our weapon).
- **"Working deployed link" is a must-include** — everything is currently localhost. See §F.

Priorities: **P0 = demo breaks without it · P1 = the story we're telling · P2 = only if time.**
Everything traces to Mikail's review transcript, the written notes, or STATUS rough edges.

---

## A. Demo-blocking bugs (P0)

| # | Item | Notes / acceptance |
|---|------|--------------------|
| A1 | **Faucet button broken in browser** | Worked via curl after the devnet switch — likely hit mid-restart, but devnet txs are slow: add loading state + surfaced errors + retry. Accept: click → spinner → balance visibly updates. |
| A2 | **Bet buttons disabled** | Downstream of balance=0 (faucet) + quote validity. Accept: after faucet, Bet buttons enable; a bet lands on devnet from the browser. |
| A3 | **Connect wallet doesn't open Phantom** | Fix `wallet.ts` connect flow (provider detection / deep link). Accept: click → Phantom popup → pubkey pill shown. |
| A4 | **Wallet balance must be visible** | tUSDC balance prominent; refresh after faucet/bet/claim (already partial — make it obvious and correct on devnet latency). |
| A5 | **Devnet latency UX** | Every on-chain action gets optimistic/loading affordances; no dead buttons while a tx confirms. |

## B. Market expansion (P1 — "the betting card should give more dynamic options")

| # | Item | Notes / acceptance |
|---|------|--------------------|
| B1 | **Bet-type picker: UP / DOWN / BAND** | UP touch = `p/B·δ` (exists). DOWN touch = symmetric bound `(1−p)/(1−B)·δ` (1−X is also a martingale). BAND = touches either edge (price ≈ min(1, up+down)·δ, capped). Each type is a **sub-page/tab** on the match page (`#/m/<id>` → type tabs); **graph + score always pinned on top**; activity feed scoped to the selected type. |
| B2 | **More probability lines than 1X2** | Corpus has `OVERUNDER_PARTICIPANT_GOALS` (~5.6k ticks/match) + `ASIANHANDICAP_PARTICIPANT_GOALS` (~5.9k). Add a **line picker** (e.g. "England win", "Draw", "Over 2.5 goals"); the chosen line drives the top graph AND the bet. O/U prob is a bounded martingale ending in {0,1} → same p/B theorem, same hedge. AH if time allows. |
| B3 | **Stake control** | Freeform amount input (respecting the $10 on-chain cap) + quick chips. Card layout cleaned up (see D). |
| B4 | **Market re-runnability** | Epoch/nonce seed in the market PDA so a resolved market can be re-demoed without validator resets — matters for multiple demo takes today. |

## C. Hedging economics — surfaced + honest (P1)

| # | Item | Notes / acceptance |
|---|------|--------------------|
| C1 | **Hedge across ALL market types** | DOWN-touch hedge = hold payout/(1−B) NO-shares bought at (1−p) (elegant symmetry). O/U-line hedge = the O/U contract itself. Band = both legs. Hedge ledger + treasury must record every type. |
| C2 | **Venue interface** | Keep TxLINE-win-price proxy but formalize the pluggable venue seam; add a simulated venue with spread/slippage so hedge costs read realistic. Documented honestly. |
| C3 | **White-paper worked example = a REAL booked market** | The §4 worked example must pull live from the hedge ledger (an actually settled market), not hardcoded numbers. "We need something booked that happens." |
| C4 | **Hedge book placement** | House Hedge Book panel stays; ensure it reads per market-type sub-page and the roll-up is coherent. |

## D. UI overhaul (P1 — "less vibe-coded, more prediction-markets platform")

| # | Item | Notes / acceptance |
|---|------|--------------------|
| D1 | **Codex GPT UI pass** | `codex` CLI v0.144.5 is installed — run a scoped `codex exec` sub-session over `web/src` for layout/typography/hierarchy. **Keep**: fixture tiles, sparklines, graphs. **Fix**: home hero ("Pick a path…" block), betting card, activity feed layout. Review + hand-merge its diff — nothing lands unreviewed. |
| D2 | **Live Market Activity realism** | Real-time (SSE or fast poll with entry animations), believable participant identities (pubkey-style handles > fake bot names), scoped per market type, denser/cleaner rows. |
| D3 | **Calibration made relevant** | Reframe as "why the price has a 0.87 in it" — attach it to the quote (the `× δ` links to it) or collapse it into a compact evidence strip; not an orphan section. |
| D4 | **Probability graph always on top** | Chosen line renders as the hero series; score + phase in the header (already mostly true — preserve through the tab refactor). |

## B5. Parlay / multi-leg (P1 — CONFIRMED in scope tonight)

- Ticket builder: combine 2–4 touch legs (cross-fixture, or cross-line within a fixture with a
  correlation disclaimer); combined price = product of leg prices; payout = stake × ∏ mult.
- On-chain: new `place_parlay` / `claim_parlay` instructions (legs = market pubkeys, fully
  collateralized payout escrow, claim requires ALL legs resolved YES) → program change + devnet
  redeploy (authority has ~9 SOL, enough).
- Hedge: leg-by-leg rolling replication (documented honestly in the write-up); ties to the
  **validateStatV3 multiproof** story — multi-leg evidence in one verification pass.

## E. Stretch (P2 — only if the above is green)

- E1 On-graph bet columns ("Couchy-style" rising columns under the path).
- E2 Non-custodial signing (user signs each bet in Phantom). Custodial demo wallets stay for today
  (CONFIRMED); Phantom = identity + display (A3/A4). Roadmap item in the write-up.

## F. Submission compliance (P0 — auto-DQ avoidance)

| # | Item | Notes |
|---|------|-------|
| F1 | **Deployed link** | **Mikail handles deployment himself (CONFIRMED)** — night shift spends the time on features/polish instead. Note: web/API/platform are all localhost today; the devnet program (`6kZYYdZL…`) is the only public artifact until deployed. |
| F2 | **Demo video ≤ 5 min** | Recording is Mikail; flows + script below (§G). |
| F3 | **Public GitHub repo** | Mikail pushes (user-only per standing rule). Repo hygiene pass tonight: README, LICENSE, .env.example. |
| F4 | **Tech doc: endpoints used + feedback section** | Fold into the technical write-up (§G3) — list of TxLINE endpoints + our API-friction feedback (SSE format change, PascalCase, token expiry, /historical window…). |
| F5 | **CPI honesty note** | Track-1 asks for CPI into `validate_stat`. Our program is devnet; TxLINE anchors are mainnet — **cross-cluster CPI is impossible**, so we verify client-side against the real mainnet PDA and store the evidence on-chain. Write-up addresses this head-on + the mainnet roadmap (direct CPI). |

## G. Parallel documentation (I produce these while implementation runs)

1. **`docs/DEMO-FLOWS.md`** — the highest-value flows, in demo order (draft: cold-open on the live
   final ticking → home tiles → pick match → pick line → pick UP 60% → one-click bet → hedge book
   appears → settle & claim with the Merkle receipt → white paper beat → treasury/net-zero close).
2. **`docs/DEMO-SCRIPT.md`** — script spikes, including (from the transcript):
   - **"Path markets trade the drama, not the result."**
   - **"UMA-style optimism resolves disputes by token-holder vote; ours resolves them by
     cryptography. The challenge is a Merkle proof — or it's nothing."**
   - The touch theorem beat (p/B graph), the 0.87 discount as measured honesty, the net-zero hedge
     state table, and the live-final capture moment.
3. **`docs/TECHNICAL-WRITEUP.md`** — full: the instrument; pricing (p/B + δ); **liquidity & hedging
   across ALL market types** (up/down/band/O-U — the replication table per type); settlement
   (Merkle → on-chain evidence, UMA contrast, F5 honesty note); TxLINE endpoints used; feedback
   section; architecture map.

## Sequencing (tonight → deadline)

1. **P0 bugs (A)** — nothing else matters if the demo can't click.
2. **B1 type tabs + B3 stake input** (the betting-card rework), then **B2 O/U line picker**.
3. **B5 parlay** (program change + devnet redeploy early, while risk-absorbable; UI after B1).
4. **C1–C3 hedging generalization** (the story).
5. **D1 Codex pass + D2/D3** (polish lands last so it doesn't churn under the refactor).
6. **G docs continuously**; STATUS updated at hand-back.
7. Morning: Mikail reviews → deploys (his own) → records demo → **15:00 local: capture the live
   final** → submit before **19:59 local**.
