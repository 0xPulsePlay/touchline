import { flag } from "../flags.js";
import { teamHue } from "./teamHue.js";

export interface ScoreboardHeroProps {
  part1: string;
  part2: string;
  /** current win probability 0–100 for each side, or null before any data */
  win1: number | null;
  win2: number | null;
  /** running/final score line, e.g. "4 : 5"; falsey → show a neutral divider */
  score: string | null;
  statusLabel: string;   // LIVE MARKET · FULL TIME · SCHEDULED · PRE-MATCH
  kickoffLabel: string;  // KICKOFF JUL 18, 9:00 PM
  clockLabel: string;    // 95:14 / 53' / ""
  live: boolean;
  competition: string;
  compact?: boolean;
}

const pct1 = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

/** Trading-terminal scoreboard: team names left/right, a boxed score display in the
 *  centre, WIN x.x% in each side's colour, a green match-clock chip, and a backdrop
 *  faintly tinted by the two teams' hues (CSS only — no images). */
export function ScoreboardHero({
  part1, part2, win1, win2, score, statusLabel, kickoffLabel, clockLabel, live, competition, compact,
}: ScoreboardHeroProps) {
  const h1 = teamHue(part1), h2 = teamHue(part2);
  const banner = `linear-gradient(105deg,
    hsl(${h1} 55% 45% / 0.20) 0%,
    hsl(${h1} 55% 45% / 0.05) 26%,
    transparent 44%, transparent 56%,
    hsl(${h2} 60% 48% / 0.05) 74%,
    hsl(${h2} 60% 48% / 0.22) 100%)`;

  return (
    <div className={`tl-hero-sb${compact ? " compact" : ""}`}>
      <div className="tl-hero-banner" style={{ background: banner }} aria-hidden="true" />
      <div className="tl-hero-topbar mono">
        <span className="tl-hero-status">{statusLabel}</span>
        <span className="tl-hero-sep" aria-hidden="true">/</span>
        <span className="tl-hero-kick">{kickoffLabel}</span>
      </div>

      <div className="tl-hero-row">
        <div className="tl-hero-team left">
          <span className="tl-hero-name"><span className="tl-hero-flag" aria-hidden="true">{flag(part1)}</span>{part1}</span>
          <span className="tl-hero-win mono w1">WIN {pct1(win1)}</span>
        </div>

        <div className="tl-hero-center">
          <div className="tl-hero-score mono">{score ?? "– : –"}</div>
          {clockLabel && <div className={`tl-hero-clock mono${live ? " live" : ""}`}>{clockLabel}</div>}
          <div className="tl-hero-comp mono">{competition}</div>
        </div>

        <div className="tl-hero-team right">
          <span className="tl-hero-name"><span className="tl-hero-flag" aria-hidden="true">{flag(part2)}</span>{part2}</span>
          <span className="tl-hero-win mono w2">WIN {pct1(win2)}</span>
        </div>
      </div>
    </div>
  );
}
