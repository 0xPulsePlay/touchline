/** A stable per-browser session id — the custodial demo wallet key on the server. */
export function sessionId(): string {
  let s = localStorage.getItem("touchline.session");
  if (!s) { s = "web-" + Math.random().toString(36).slice(2, 10); localStorage.setItem("touchline.session", s); }
  return s;
}
