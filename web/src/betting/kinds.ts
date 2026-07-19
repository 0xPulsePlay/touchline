import type { BetKind } from "../api.js";

/** The five instruments, their glyphs, short labels, and question templates.
 *  Shared by the placement ticket (BettingPanel) and the market list (MarketCard),
 *  so a card's question always reads the same as the ticket it opens. */
export const KIND_META: Record<BetKind, { icon: string; label: string; blurb: (name: string, U: number, L: number) => string }> = {
  up: { icon: "↗", label: "Touch up", blurb: (n, U) => `${n} touches ${U}%?` },
  down: { icon: "↘", label: "Touch down", blurb: (n, U) => `${n} drops to ${U}%?` },
  band: { icon: "⇅", label: "Race", blurb: (n, U, L) => `${n} hits ${U}% before ${L}%?` },
  heartbreak: { icon: "💔", label: "Heartbreak", blurb: (n, U) => `${n} touches ${U}% — and still loses?` },
  comeback: { icon: "🔄", label: "Comeback", blurb: (n, U) => `${n} drops to ${U}% — and still wins?` },
};

export const KIND_ORDER: BetKind[] = ["up", "down", "band", "heartbreak", "comeback"];
