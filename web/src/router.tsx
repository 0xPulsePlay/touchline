import { useEffect, useState } from "react";
import { App } from "./App.js";
import { Home } from "./Home.js";

/** Minimal hash routing — no library. '#/' = home picker, '#/m/<fixtureId>' = market view. */
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

/** Top-level switch between the home picker and a single-fixture market view.
 *  App is keyed on fixtureId so navigating between matches remounts it with clean state. */
export function AppRouter() {
  const route = useHashRoute();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [route]);
  return route.name === "market"
    ? <App key={route.fixtureId} fixtureId={route.fixtureId} />
    : <Home />;
}
