import { useEffect, useState } from "react";

/** Minimal hash routing — no library. '#/' = home, '#/m/<fixtureId>' = market view. */
export type Route = { name: "home" } | { name: "market"; fixtureId: number };

export function parseHash(hash: string): Route {
  const m = hash.replace(/^#/, "").match(/^\/m\/(\d+)/);
  return m ? { name: "market", fixtureId: Number(m[1]) } : { name: "home" };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(to: string) {
  window.location.hash = to;
}
