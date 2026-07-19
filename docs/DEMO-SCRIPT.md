# Touchline — Demo Script (spikes)

The lines worth saying, mapped to the flow timestamps in `DEMO-FLOWS.md`. Each spike ≤ 2 sentences —
say them, don't read them. **Bold** lines are the load-bearing ones; hit those verbatim in spirit.

> Anchor lines that must be in the video (from Mikail):
> - **"Path markets trade the drama, not the result."**
> - **"Polymarket pays you when your team wins. Touchline can pay you when your team breaks your
>   heart — and prove it with one Merkle proof."**
> - **"UMA-style optimism resolves disputes by token-holder vote; ours resolves them by
>   cryptography. The challenge is a Merkle proof — or it's nothing."**
> - **"The fair price of a match's drama is `p(1−p)` — model-free."**

---

## 0:00–0:30 · Cold open (Flow 0 — live final path ticking)

- "This is a live World Cup final, and this line is a probability — the market's real-time belief
  that this team wins."
- "Watch it move. Every tick is TxLINE's de-margined price, and it walks all match — ending at one if
  they win, zero if they don't."
- **"Touchline lets you bet on the journey of that line, not the final score. Path markets trade the
  drama, not the result."**
- **The pivot (say it):** "Judging happens after the tournament — so let me show you the exact same
  pipeline on a match that already finished, replayed tick-by-tick."

## 0:30–1:00 · The problem (Flow 1)

- "A normal market asks 'who wins?' — one number at the final whistle. But the story is in the
  swings: the underdog that clawed to within a whisker, the favourite that wobbled."
- "So we ask a different question: **will this probability ever *touch* a level you pick** — say 60%
  — at any point in the match? The result doesn't matter; the touch does."

## 1:00–1:20 · Home tiles + wallet (Flow 2)

- "Every match in the tournament, tick-for-tick, from TxLINE's feed."
- **Wallet nod (≤3s):** *(open the wallet menu)* "Devnet SOL and USDC — funded, ready." *(close it;
  never mention funds again.)*
- "Pick one — and I'll show you a real bet, settled with a cryptographic proof, on devnet."

## 1:20–1:50 · Into a match · line picker (Flow 3)

- "The graph and score stay pinned up top; everything below is the market."
- ⚠️ "And it's not just win/lose — I can draw the path from any line: the win probability, or 'over
  2.5 goals'. Same math, any question." *(skip if the picker isn't live — stay on 1X2.)*

## 1:50–2:50 · Centerpiece — Simulate live → Heartbreak → the event (Flow 4)

- **The sim framing:** *(click ⚡ Simulate live)* "This match already finished. Watch — we replay the
  real anchored feed tick-by-tick, the exact pipeline a live match runs. **Same feed, same proofs —
  this is the demo.**"
- **The lead spike:** "Polymarket pays you when your team wins. Touchline can pay you when your team
  *breaks your heart* — and prove it with one Merkle proof." *(HEARTBREAK tab, England, barrier 60%.)*
- "The market: England touches 60% *and still loses* — and the England semifinal is exactly that."
- **The touch-theorem one-liner:** "The price isn't guessed. A team at 36% touches 60% about `p over
  B` of the time — and from that summit it still loses `1 minus B`. Multiply them: that's the price."
- **The honesty beat:** "And the `0.87`? We measured it — across 109 matches, touches happen about
  87% as often as the theory's ceiling, because jumps overshoot. We price with the measured number."
- "Ten dollars — Place. A real transaction on Solana devnet, co-signed by the house." *(hit Place,
  then stop clicking.)*
- **The payoff (let the sim run):** *(as the line jumps at ~54′)* "There it is — England touches
  69.7 percent. The thing I predicted just happened, on the replay."
  *(⚠️ if the Heartbreak tab isn't live, do a plain UP touch and use just the `p/B` line.)*

## ~2:20–2:50 · House Hedge Book — narrated over the running sim (Flow 5)

- "Here's the part most prediction markets hand-wave: **who pays if you win?**"
- "The instant I bet, the house hedges it — it buys win-shares in the underlying, sized so the payout
  is covered at the touch."
- **The net-zero beat:** "Look at the book: touched or not touched, the house lands in the same small
  place. **The payout is funded by the hedge, not by the next bettor** — this is a flat book, not a
  Ponzi of pooled stakes."
- "And that's the honest version — there's a small residual either way, plus the overshoot, which
  falls in the house's favour. We show it, we don't hide it."

## 2:50–3:50 · Resolution fires on-chain → Solana Explorer → claim (Flow 6)

- **As it auto-settles:** "It touched — and England lost, one–two. The heartbreak resolves YES. We
  don't ask an oracle to *vote* — we name the exact odds tick that crossed, and prove it."
- **The anchor line:** **"UMA-style optimism resolves disputes by token-holder vote; ours resolves
  them by cryptography. The challenge is a Merkle proof — or it's nothing."**
- **The TxLINE-powered beat:** "That tick is a leaf in a Merkle tree whose daily root TxLINE anchors
  on Solana **mainnet**. We verify against that real mainnet root, and store the evidence on-chain."
- **The Explorer pause** *(open the settlement link → `explorer.solana.com/…?cluster=devnet`, wait
  for it to load)*: **"That's the settlement — on-chain, provable."** *(let it breathe; show the tx,
  then the PDA.)*
- "The touch is proven by the Merkle proof; the loss is the final score. It broke your heart — and we
  proved it. Payout claimed, balance up."

## 3:50–4:20 · White-paper beat (Flow 7)

- "None of this is a slide. It's derived — here's the optional-stopping argument that gives `p/B`."
- "Here's the calibration table that gives the 0.87, fetched live from the corpus as we speak. And
  here's the replication that makes the hedge self-financing."
- **The drama beat:** "And the touch is just one member of a family. The fair price of a whole
  match's *drama* — how much the probability swings — is `p times one-minus-p`. Model-free, exact,
  and only settleable because every tick is provable."
- "The math is real, it's measured, and it's in the app." *(`· how?` → the white paper.)*

## 4:20–4:45 · Parlay (Flow 8) ⚠️

- ⚠️ "Because each leg is a provable touch, I can stack them — a parlay. Combined price is the product
  of the legs; the payout multiplies."
- ⚠️ "And they settle in **one** verification pass — TxLINE's multi-stat proof means multi-leg
  evidence in a single on-chain call." *(cut entirely if parlay isn't finished.)*

## 4:45–5:00 · Net-zero treasury close (Flow 9)

- "So: a market on the drama of the match, priced from a theorem and a measured constant, hedged into
  a flat book, and settled by a proof against mainnet — not a vote."
- "The bots are still trading it autonomously in the background. **That's Touchline: trade the path,
  settle by cryptography.**"

---

## The beats that must survive any edit

If the cut gets brutal, these sentences are the submission:

1. **"Path markets trade the drama, not the result."**
2. **"Polymarket pays you when your team wins; Touchline can pay you when your team breaks your heart
   — and prove it with one Merkle proof."**
3. **"A team at 36% touches 60% about `p over B` of the time — and from the summit still loses
   `1 minus B` of it."**
4. **"We measured the discount: touches happen 87% as often as the bound says — we price with the
   measured number."**
5. **"The payout is funded by the hedge, not the next bettor."**
6. **"UMA resolves disputes by vote; ours by cryptography. The challenge is a Merkle proof — or it's
   nothing."**
7. **"The fair price of a match's drama is `p times one-minus-p` — model-free."**

## Tone notes

- No jargon walls. Say "the market's belief," not "the risk-neutral measure." Say "measured," not
  "empirically calibrated," on first use.
- Let the screen do the proving — pause on the PDA, pause on the hedge-book flip. Silence sells the
  cryptography beat.
- Say "mainnet" every time you mention the anchor, and "devnet" every time you mention our escrow —
  the honesty is a feature (see the cross-cluster note in `TECHNICAL-WRITEUP.md` §6).
- **Sell the sim; don't apologise for it.** "Same feed, same proofs, re-runnable" — never "just a
  demo" or "if this were live." The replay is the product surface judges will test, and the whole
  centerpiece hinges on the predicted event visibly happening on it, then settling on-chain.
