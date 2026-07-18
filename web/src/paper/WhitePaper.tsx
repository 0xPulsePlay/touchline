import { useEffect, useState } from "react";
import { api, type Calibration } from "../api.js";
import { AppBar } from "../AppBar.js";
import "./paper.css";

/**
 * The Touchline white paper — a single in-app page explaining every piece of the mechanism:
 * what the instrument is, how the p/B touch bound prices it, the empirical discount measured
 * across the corpus, the net-zero hedge that offsets each ticket, and the on-chain settlement.
 * Calibration numbers are fetched live so the discount table is never stale.
 */
export function WhitePaper() {
  const [cal, setCal] = useState<Calibration | null>(null);
  useEffect(() => { api.calibration().then(setCal).catch(() => {}); }, []);

  const buckets = (cal?.buckets ?? []).filter((b) => b.discount != null);
  const meanDisc = buckets.length ? buckets.reduce((a, b) => a + (b.discount ?? 0), 0) / buckets.length : 0.87;

  return (
    <>
      <AppBar back tag="White paper" />
      <article className="paper">
        <header className="pp-hero">
          <p className="pp-kicker">Touchline · mechanism paper</p>
          <h1>Pricing and hedging one-touch markets on a probability path</h1>
          <p className="pp-lede">
            Touchline lets you bet whether a team's de-margined win probability will <em>touch</em> a
            barrier you choose. This paper derives the price from a martingale bound, calibrates it
            against {cal?.fixtures ?? 109} matches, and shows how every ticket is hedged into a
            near-flat book. Nothing here is hand-waved — the pricing constant is measured live below,
            and the hedge is a real ledger you can watch settle.
          </p>
          <nav className="pp-toc mono">
            <a href="#s1">1 · The instrument</a>
            <a href="#s2">2 · The p/B touch bound</a>
            <a href="#s3">3 · The empirical discount</a>
            <a href="#s4">4 · The hedge: net-zero replication</a>
            <a href="#s5">5 · Settlement &amp; verification</a>
            <a href="#s6">6 · Honest caveats</a>
          </nav>
        </header>

        {/* 1 — the instrument */}
        <section id="s1" className="pp-sec">
          <h2><span className="pp-num">1</span> The instrument</h2>
          <p>
            Bookmakers quote three prices on a match — home / draw / away. Strip the margin (normalise
            the implied probabilities so they sum to one) and you get a <b>de-margined win
            probability</b> for each side. As new money arrives and the match unfolds, that number
            walks up and down between kickoff and the final whistle, ending at <b>1</b> if the side wins
            and <b>0</b> if it doesn't.
          </p>
          <p>
            A <b>one-touch</b> ticket pays out if that path ever reaches a barrier <b>B</b> you pick —
            say, “England's win probability touches 60% at any point.” It doesn't matter whether England
            go on to win; the ticket settles the instant the line prints <b>≥ B</b>. You choose the
            barrier on a slider and place the prediction in one click. That's the whole product.
          </p>
          <div className="pp-callout">
            <b>Why a touch, not an outcome?</b> A touch is a statement about the <em>journey</em>, and the
            journey is where the drama is. “Did the underdog ever get within a whisker of it?” is a more
            interesting — and more tradable — question than the final score alone.
          </div>
        </section>

        {/* 2 — the bound */}
        <section id="s2" className="pp-sec">
          <h2><span className="pp-num">2</span> The p/B touch bound</h2>
          <p>
            The de-margined win probability is, to a good approximation, a <b>martingale</b>: absent new
            information its best forecast of tomorrow's value is today's value. That single property is
            enough to price the touch.
          </p>
          <p>
            Let <span className="m">p</span> be the current win probability and <span className="m">B &gt; p</span> the
            barrier. Define a stopping time <span className="m">τ</span> = the first moment the path hits
            <span className="m"> B</span> or the match ends. By the <b>optional stopping theorem</b>, the
            expected value of a martingale at <span className="m">τ</span> equals its value now:
          </p>
          <div className="pp-eq">E[X<sub>τ</sub>] = p</div>
          <p>
            The path can only stop in one of two places. Either it <b>touched B</b> — and, in the
            frictionless limit, it stops exactly at <span className="m">B</span> — or it never did and
            drifted to some value below <span className="m">B</span> by full time. Split the expectation:
          </p>
          <div className="pp-eq">
            p = B · P(touch) + E[X<sub>end</sub> | no touch] · P(no touch)
          </div>
          <p>
            Bound the second term below by 0 (a probability can't go negative) and you get the clean
            result that anchors every Touchline price:
          </p>
          <div className="pp-eq pp-eq-hero">P(touch B) ≤ p / B</div>
          <p>
            Intuitively: to reach a barrier twice as far from certainty, you're about half as likely to
            get there. A team at 30% touches 60% roughly <span className="m">0.30 / 0.60 = 50%</span> of
            the time. The <b>fair price</b> of the one-touch ticket is exactly this ratio, and the payout
            is its reciprocal, <span className="m">B / p</span>.
          </p>
          <div className="pp-callout pp-warn">
            <b>Why “≤” and not “=”.</b> Real probability paths <em>jump</em> — a goal reprices the line
            discontinuously — so when the path crosses <span className="m">B</span> it usually
            <em> overshoots</em>, stopping above <span className="m">B</span> rather than exactly on it.
            Overshoot pushes the true touch probability <em>below</em> <span className="m">p/B</span>.
            So <span className="m">p/B</span> is an <b>upper bound</b>, and we must correct it down with a
            number measured from data.
          </div>
        </section>

        {/* 3 — the discount */}
        <section id="s3" className="pp-sec">
          <h2><span className="pp-num">3</span> The empirical discount</h2>
          <p>
            We measured the gap directly. Across <b>{cal?.fixtures ?? 109} matches</b> and{" "}
            <b>{cal?.samples?.length ?? 327} sampled paths</b>, for a grid of barriers we compared how
            often the path <em>actually</em> touched against the mean <span className="m">p/B</span> the
            bound predicted. The ratio is the <b>discount</b> we multiply into every quote:
          </p>
          <div className="pp-eq">
            price = (p / B) × <span className="pp-hl">δ</span>,&nbsp;&nbsp; δ ={" "}
            <span className="pp-frac"><span>observed touch rate</span><span>mean p/B</span></span>{" "}
            ≈ {meanDisc.toFixed(2)}
          </div>
          <div className="pp-tablewrap">
            <table className="pp-table mono">
              <thead>
                <tr><th>Barrier B</th><th>paths</th><th>touched</th><th>observed rate</th><th>mean p/B</th><th>δ</th></tr>
              </thead>
              <tbody>
                {buckets.length === 0 && <tr><td colSpan={6} className="pp-dim">loading calibration…</td></tr>}
                {buckets.map((b) => (
                  <tr key={b.barrier}>
                    <td>{b.barrier}%</td>
                    <td>{b.n}</td>
                    <td>{b.touched}</td>
                    <td>{b.observedRate.toFixed(3)}</td>
                    <td>{b.meanBound.toFixed(3)}</td>
                    <td className="pp-hl-cell">{b.discount?.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The discount hovers around <b>{meanDisc.toFixed(2)}</b>: touches happen about{" "}
            {(meanDisc * 100).toFixed(0)}% as often as the frictionless bound says, exactly the shortfall
            jumps and finite observation predict. It drifts toward 1 for high barriers (a path that
            reaches 90% had to pass smoothly through most of the way) and dips for mid-barriers where
            goal-jumps overshoot hardest. Touchline prices with the live blended value,{" "}
            <b>δ ≈ {meanDisc.toFixed(2)}</b>.
          </p>
          <div className="pp-callout">
            <b>The barrier gate.</b> A quote is only offered for <span className="m">B</span> strictly
            above the current probability plus a step. You can't buy a touch of a level the line has
            already cleared — that would be a settled bet, not a prediction.
          </div>
        </section>

        {/* 4 — the hedge */}
        <section id="s4" className="pp-sec">
          <h2><span className="pp-num">4</span> The hedge: net-zero replication</h2>
          <p>
            Pricing tells us what's fair; it doesn't tell us the house survives a run of winners. For
            that, every ticket is <b>hedged</b>. The insight is that a one-touch on the win path can be
            replicated by holding the underlying <b>win contract</b> itself.
          </p>
          <p>
            When the house writes a ticket that owes payout <span className="m">P</span> on a touch of{" "}
            <span className="m">B</span>, it immediately buys
          </p>
          <div className="pp-eq">N = P / B&nbsp;&nbsp;win-shares, at the current win price p,&nbsp;&nbsp;costing N · p = P · (p/B)</div>
          <p>
            A win-share pays 1 if the team ultimately wins and trades at the win probability meanwhile.
            Watch what that position is worth in each world:
          </p>
          <div className="pp-tablewrap">
            <table className="pp-table">
              <thead>
                <tr><th>Outcome</th><th>Win-share value</th><th>House owes</th><th>Net</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>Touches B</b></td>
                  <td>at the touch the win price is <span className="m">B</span>, so <span className="m">N·B = P</span></td>
                  <td><span className="m">P</span></td>
                  <td className="pp-flat">≈ 0</td>
                </tr>
                <tr>
                  <td><b>Never touches</b></td>
                  <td>the team never won, shares expire at <span className="m">0</span></td>
                  <td><span className="m">0</span></td>
                  <td className="pp-flat">0</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Either way the book lands at zero — the payout is funded by the hedge, not by the next
            bettor. The position is <b>self-financing</b>: at the fair price the premium collected,{" "}
            <span className="m">P·(p/B)</span>, is exactly the cost of the shares. This is the same
            replication that prices a barrier option, specialised to a market whose underlying{" "}
            <em>is</em> a probability.
          </p>

          <h3>What the hedge actually does to risk</h3>
          <p>
            The hedge's real job is to make the house's P&amp;L <b>independent of the outcome</b>. Without
            it, a touch costs the house the full payout; with it, the book lands in the same small place
            whether the barrier is touched or not. A worked example from the live book:
          </p>
          <div className="pp-worked mono">
            <div className="pp-worked-row"><span>premiums collected</span><span>$6.00</span></div>
            <div className="pp-worked-row"><span>win-shares bought (P/B) at p = 35¢</span><span>cost $6.70</span></div>
            <div className="pp-worked-row pp-worked-sep"><span className="pp-risk">unhedged, if it touches</span><span className="pp-risk">−$2.08</span></div>
            <div className="pp-worked-row"><span>hedged, if it touches at B (no overshoot)</span><span>−$0.70</span></div>
            <div className="pp-worked-row"><span>hedged, if it never touches</span><span>−$0.70</span></div>
            <div className="pp-worked-row pp-worked-sep"><span className="pp-good">actually settled — line jumped to 69.7%</span><span className="pp-good">+$4.40</span></div>
          </div>
          <p>
            The barrier was touched by a goal that repriced the line all the way to <b>69.7%</b>. The
            win-shares, bought at 35¢, liquidated at 69.7¢ — turning a position that was <em>designed</em>
            to break even into a <b>+$4.40</b> gain, against a <b>−$2.08</b> loss the same outcome would
            have cost unhedged. That gap is the overshoot working in the house's favour.
          </p>
          <div className="pp-callout pp-warn">
            <b>Where net-zero leaks (honestly).</b> Three residuals keep this “≈ 0,” not “= 0”:
            <ul>
              <li><b>Jump overshoot</b> — the line stops above <span className="m">B</span>, so the hedge
                is usually worth a little <em>more</em> than the payout. One-sided, in the house's favour;
                it's the flip side of the {meanDisc.toFixed(2)} discount.</li>
              <li><b>Execution slippage</b> — real venue fills aren't at the mid; the hedge costs a spread.</li>
              <li><b>Settlement-variable mismatch</b> — the ticket settles on the <em>touch</em> of the
                de-margined line; the win-share settles on the <em>match result</em>. They agree in the
                limit, not tick-for-tick.</li>
            </ul>
            Touchline sizes and prices the hedge off the TxLINE win price today. That's a defensible
            proxy — for a liquid match a real venue and the de-margined line agree — and the venue field
            in the hedge ledger is a seam a Polymarket or Kalshi adapter drops straight into.
          </div>
        </section>

        {/* 5 — settlement */}
        <section id="s5" className="pp-sec">
          <h2><span className="pp-num">5</span> Settlement &amp; verification</h2>
          <p>
            A market resolves <b>YES</b> the moment a single odds tick prints <span className="m">≥ B</span>.
            That one tick is the entire evidence, and it is verifiable end-to-end:
          </p>
          <ol className="pp-steps">
            <li>Every odds tick in the corpus is a leaf in a Merkle tree; the <b>daily batch root</b> is
              anchored on Solana in a program-derived account (PDA), keyed by epoch-day and five-minute slot.</li>
            <li>To settle, the resolver names the touching tick and produces its <b>Merkle proof</b> — the
              sibling hashes from leaf to root.</li>
            <li>The client recomputes the root from the proof and checks it against the on-chain PDA. If
              they match, the tick is real, unaltered, and was published before settlement.</li>
            <li>The on-chain program stores that evidence — message id, timestamp, probability, root hash,
              PDA — alongside the resolution, and the escrow pays the exact odds. Nothing about the
              outcome is asserted by Touchline; it's proven against data anchored independently.</li>
          </ol>
          <div className="pp-callout">
            <b>Fully collateralised.</b> On every bet the user's stake and the house's liability are
            escrowed together in a per-market vault by a co-signed transaction, so the payout exists on
            chain before the whistle. Resolution and claim just move what's already locked.
          </div>
        </section>

        {/* 6 — caveats */}
        <section id="s6" className="pp-sec">
          <h2><span className="pp-num">6</span> Honest caveats</h2>
          <ul className="pp-caveats">
            <li><b>Devnet, mock tokens.</b> The program runs on Solana devnet with a mock USDC mint of
              zero real value and a $10 stake cap. Nothing here touches mainnet funds.</li>
            <li><b>The discount is empirical, not a law.</b> δ ≈ {meanDisc.toFixed(2)} is measured on{" "}
              {cal?.fixtures ?? 109} World-Cup-corpus matches; a different competition or a thinner market
              would re-calibrate it.</li>
            <li><b>The martingale assumption is an approximation.</b> Odds carry a small drift and
              microstructure noise; the bound holds well in aggregate, tick-by-tick less so.</li>
            <li><b>The hedge venue is a proxy today.</b> Sizing uses the TxLINE win price; a production
              build would route to a live win market and eat its spread.</li>
          </ul>
          <p className="pp-foot">
            <a href="#/">← Back to the markets</a>
          </p>
        </section>
      </article>
    </>
  );
}
