import { readFileSync } from "node:fs";
import { config } from "./config.js";

/**
 * TxLINE auth: the long-lived opaque apiToken is reused from the engine's cache (READ-ONLY —
 * Touchline never writes that file); the short-lived guest JWT is fetched fresh and kept in
 * memory. 401 handling: refresh the JWT once and retry — the apiToken itself has no reliable
 * client-side expiry (live-verified in the engine project).
 */

interface Cached {
  jwt: string;
  expMs: number;
}

let guest: Cached | null = null;

function apiToken(): string {
  const raw = JSON.parse(readFileSync(config.tokenCache, "utf8")) as { apiToken: string };
  if (!raw.apiToken) throw new Error("no apiToken in engine token cache");
  return raw.apiToken;
}

function jwtExpMs(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : Date.now() + 30 * 60_000;
  } catch {
    return Date.now() + 30 * 60_000;
  }
}

async function freshGuestJwt(): Promise<string> {
  const r = await fetch(`${config.txlineApiBase}/auth/guest/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`guest/start ${r.status}`);
  const body = (await r.json()) as string | { token?: string };
  const jwt = typeof body === "string" ? body : body.token;
  if (!jwt) throw new Error("guest/start returned no token");
  guest = { jwt, expMs: jwtExpMs(jwt) };
  return jwt;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const jwt = guest && Date.now() < guest.expMs - 60_000 ? guest.jwt : await freshGuestJwt();
  return { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken() };
}

/** GET a TxLINE API path with auth; one automatic JWT refresh on 401. */
export async function txlineGet(path: string): Promise<unknown> {
  let r = await fetch(`${config.txlineApiBase}${path}`, { headers: await authHeaders() });
  if (r.status === 401) {
    await freshGuestJwt();
    r = await fetch(`${config.txlineApiBase}${path}`, { headers: await authHeaders() });
  }
  if (!r.ok) throw new Error(`txline GET ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
