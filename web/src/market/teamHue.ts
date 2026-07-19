/** A stable hue (0–360) derived from a team name, for tinting the scoreboard backdrop.
 *  No external images — the hero banner is a CSS gradient between the two team hues. */
export function teamHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
