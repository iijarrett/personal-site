/**
 * The accent colours the footer game hands out, one for each wave cleared. Purple, the site's own
 * accent, is the home colour and is not listed here: it comes from the stylesheet. Each entry says
 * what the accent tokens become on the dark theme and on the light one. The light values are
 * darker where they carry text or edges, so every colour keeps its contrast on both themes;
 * tests/accents.test.mjs holds each one to the same limits as the purple.
 *
 * No DOM here. ../scripts/arcade.ts is the only file that imports this one.
 */

export interface Accent {
  name: string;
  /** The dark theme: one bright colour serves the accent, its text, the tile glow and the ring. */
  dark: string;
  light: {
    /** Decoration only. */
    accent: string;
    /** Links, text and the ring: 4.6:1 on the light surface. */
    text: string;
    /** A pale tint for the tile glow, so tile text stays readable over it. */
    glow: string;
  };
}

export const ACCENTS: readonly Accent[] = [
  { name: "Cyan", dark: "#7dcfff", light: { accent: "#007197", text: "#005f7a", glow: "#d6eef6" } },
  {
    name: "Green",
    dark: "#9ece6a",
    light: { accent: "#587539", text: "#41602a", glow: "#e3efd8" },
  },
  {
    name: "Yellow",
    dark: "#e0af68",
    light: { accent: "#8c6c3e", text: "#73552b", glow: "#f5e7cf" },
  },
  { name: "Pink", dark: "#f7768e", light: { accent: "#f52a65", text: "#b02040", glow: "#fbdde4" } },
];

/** The custom properties an accent sets on the page, and the home colour's name. */
export const ACCENT_VARS = ["--accent", "--accent-text", "--glow", "--ring"] as const;
export const HOME_NAME = "Purple";

/** The next colour after `index` (-1 is the home purple): round the list and back home. */
export const nextAccent = (index: number): number => (index + 1 >= ACCENTS.length ? -1 : index + 1);

/** What each token is for an accent on a theme, in the order of ACCENT_VARS. */
export function accentValues(a: Accent, light: boolean): string[] {
  return light
    ? [a.light.accent, a.light.text, a.light.glow, a.light.text]
    : [a.dark, a.dark, a.dark, a.dark];
}
