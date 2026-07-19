# Using Touchline

## Prerequisites

- The `txline-explorer` engine corpus at `../txline-explorer/apps/api/.data/txline.db`
  (opened strictly read-only).
- Cached TxLINE credentials at `../txline-explorer/apps/api/.cache/token.json` (present).
- The built `@txline/verify` package in `../txline-explorer-validation-lab` (present).
- Node 20+, pnpm.

## Start

```bash
cd ~/Desktop/PulsePlay/touchline
pnpm install
pnpm dev        # api on :4617, web on :4618
```

Open **http://localhost:4618**.

## Demo walkthrough

1. **Pick the semifinal** (England — Argentina, 1–2) from the left rail — it's preselected.
2. **Watch the path**: press ▶ to replay 37k ticks; England's line rockets through the 60% barrier
   at the 54′ goal (the `TOUCHED` ring), then collapses as Argentina come back.
3. **Quote a market**: side = England, barrier slider = 60% → the card shows
   `bound p/B = 35.4/60 = 59.0% × 0.87 measured → 51.3%`. That ×0.87 is measured from 109 real
   matches (Calibration panel at the bottom).
4. **Open market → +25 YES → Resolve from anchored path.** The server finds the first touching
   tick at full precision, fetches its Merkle proof from TxLINE, and verifies it against the
   mainnet `daily_batch_roots` PDA. The green receipt shows every step: leaf → sub-tree root →
   slot root (computed hash == on-chain hash) → PDA address, with a Solscan link.
5. Punchline: **the market paid YES on a match England lost** — and you can hand anyone the
   cryptographic receipt.

## API quick reference (port 4617)

```
GET  /health
GET  /api/fixtures
GET  /api/fixtures/:id/path?every=4
GET  /api/fixtures/:id/quote?side=part1|draw|part2&barrier=60
GET  /api/markets?fixtureId=...
POST /api/markets                     {fixtureId, side, barrier}
POST /api/markets/:id/stake           {bettor, side: "yes"|"no", amount}
POST /api/markets/:id/resolve
GET  /api/calibration
POST /api/calibration/refresh
```

## Notes

- Ports 4617/4618 were chosen to avoid clashing with the data platform (3001/3002) and the explorer
  web (3000).
- Touchline's own state lives in `server/.data/` (gitignored). Deleting it resets all markets.
- Upcoming fixtures (the final, 3rd-place match, friendlies) already stream pre-match ticks into
  the corpus — you can open markets on them today; resolution activates once the path exists.
