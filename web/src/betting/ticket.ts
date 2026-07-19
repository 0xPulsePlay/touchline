import type { BetKind, Side } from "../api.js";

/** A parlay ticket leg — persisted in localStorage so legs survive navigating between matches. */
export interface TicketLeg {
  fixtureId: number;
  fixtureName: string;
  side: Side;
  sideName: string;
  kind: BetKind;
  barrier: number;
  barrier2?: number;
}

const KEY = "touchline.ticket";

export function readTicket(): TicketLeg[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as TicketLeg[]; } catch { return []; }
}

export function writeTicket(legs: TicketLeg[]): void {
  localStorage.setItem(KEY, JSON.stringify(legs.slice(0, 4)));
}

export function addLeg(leg: TicketLeg): TicketLeg[] {
  const legs = readTicket();
  // one leg per (fixture, side, kind, barrier) — replace duplicates
  const dedup = legs.filter((l) => !(l.fixtureId === leg.fixtureId && l.side === leg.side && l.kind === leg.kind && l.barrier === leg.barrier));
  const next = [...dedup, leg].slice(-4);
  writeTicket(next);
  return next;
}

export function removeLeg(i: number): TicketLeg[] {
  const legs = readTicket();
  legs.splice(i, 1);
  writeTicket(legs);
  return legs;
}

export function clearTicket(): TicketLeg[] {
  writeTicket([]);
  return [];
}
