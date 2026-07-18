import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { Home } from "./Home.js";
import { useHashRoute } from "./router.js";
import "./styles.css";

function Root() {
  const route = useHashRoute();
  return route.name === "market" ? <App fixtureId={route.fixtureId} /> : <Home />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
