import { useEffect, useState } from "react";
import type { BetKind, Side } from "../api.js";
import { KIND_ORDER } from "../betting/kinds.js";

/** A selected market, encoded in the hash sub-route so back/forward + deep-links work.
 *  #/m/<id>                                       → market list (ticketSel = null)
 *  #/m/<id>/t/<kind>/<side>/<barrier>             → placement ticket
 *  #/m/<id>/t/band/<side>/<upper>/<lower>         → band (two barriers)
 *  …/t/…?line=1                                   → built on an alternate probability line */
export interface TicketSel {
  kind: BetKind;
  side: Side;
  barrier: number;
  barrier2?: number;
  line: number;
}

const SIDES: Side[] = ["part1", "part2", "draw"];

export function parseTicket(hash: string, fixtureId: number): TicketSel | null {
  const parts = hash.replace(/^#/, "").split("?");
  const rawPath = parts[0] ?? "";
  const query = parts[1];
  const m = rawPath.match(/^\/m\/(\d+)\/t\/([a-z]+)\/(part1|part2|draw)\/(\d+)(?:\/(\d+))?\/?$/);
  if (!m || Number(m[1]) !== fixtureId) return null;
  const kind = m[2] as BetKind;
  if (!KIND_ORDER.includes(kind)) return null;
  const side = m[3] as Side;
  if (!SIDES.includes(side)) return null;
  const line = query ? Number(new URLSearchParams(query).get("line") ?? 0) || 0 : 0;
  return {
    kind,
    side,
    barrier: Number(m[4]),
    barrier2: m[5] !== undefined ? Number(m[5]) : undefined,
    line,
  };
}

/** Build the hash for a ticket selection (no leading fixtureId caller responsibility here). */
export function ticketHash(fixtureId: number, sel: { kind: BetKind; side: Side; barrier: number; barrier2?: number; line?: number }): string {
  const tail = sel.barrier2 !== undefined ? `/${sel.barrier2}` : "";
  const q = sel.line ? `?line=${sel.line}` : "";
  return `#/m/${fixtureId}/t/${sel.kind}/${sel.side}/${sel.barrier}${tail}${q}`;
}

/** Reactive read of the ticket sub-route for the current fixture; null = the market list. */
export function useTicketRoute(fixtureId: number): TicketSel | null {
  const [sel, setSel] = useState<TicketSel | null>(() => parseTicket(window.location.hash, fixtureId));
  useEffect(() => {
    const on = () => setSel(parseTicket(window.location.hash, fixtureId));
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [fixtureId]);
  return sel;
}

/** A preset market shown in the list. `sideRef` names which participant this preset is
 *  "about" (part1/part2), resolved to the live name at render time. */
export interface MarketPreset {
  key: string;
  kind: BetKind;
  side: Side;
  barrier: number;
  barrier2?: number;
  line?: number;
}

/** The curated board for a fixture: the five instruments across both sides at sensible
 *  presets. Quotes are fetched per-card, so out-of-range presets simply read "off board". */
export function presetsFor(hasLine1: boolean): MarketPreset[] {
  const base: MarketPreset[] = [
    { key: "up-p1-60", kind: "up", side: "part1", barrier: 60 },
    { key: "up-p2-60", kind: "up", side: "part2", barrier: 60 },
    { key: "hb-p1-60", kind: "heartbreak", side: "part1", barrier: 60 },
    { key: "band-p1-60-20", kind: "band", side: "part1", barrier: 60, barrier2: 20 },
    { key: "down-p1-30", kind: "down", side: "part1", barrier: 30 },
    { key: "cb-p2-30", kind: "comeback", side: "part2", barrier: 30 },
    { key: "up-draw-40", kind: "up", side: "draw", barrier: 40 },
  ];
  if (hasLine1) base.push({ key: "line1-up-p1-50", kind: "up", side: "part1", barrier: 50, line: 1 });
  return base;
}
