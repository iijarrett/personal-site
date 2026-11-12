/**
 * The accent colours the footer game hands out, one for each wave cleared. Purple, the site's own
 * accent, is the home colour and is not listed here: it comes from the stylesheet. Each entry says
 * what the accent tokens become on the dark theme and on the light one. The light values are
 * darker where they carry text or edges, so every colour keeps its contrast on both themes;
 * tests/accents.test.mjs holds each one to the same limits as the purple.
 *
 * A colour won is kept for the tab (sessionStorage) and put back before first paint on every
 * page by public/theme-init.js, so it follows the visitor from page to page and goes when the tab
 * closes. The page wears it through four custom properties, --x0 to --x3, that global.css turns
 * into the accent tokens for whichever theme is showing; switching theme needs no script.
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

/** The custom properties an accent sets on <html>, the storage key, and the home colour's name. */
export const ACCENT_VARS = ["--x0", "--x1", "--x2", "--x3"] as const;
export const ACCENT_KEY = "accent";
export const HOME_NAME = "Purple";

/** The next colour after `index` (-1 is the home purple): round the list and back home. */
export const nextAccent = (index: number): number => (index + 1 >= ACCENTS.length ? -1 : index + 1);

/**
 * The four values an accent puts on the page, in the order of ACCENT_VARS: the dark theme's
 * colour (it serves the accent, its text, the glow and the ring), then the light theme's accent,
 * text and glow. global.css says which token takes which.
 */
export function accentValues(a: Accent): string[] {
  return [a.dark, a.light.accent, a.light.text, a.light.glow];
}

/** What is kept in storage: the lower-case name, then the four values, comma separated. */
export function accentRecord(a: Accent): string {
  return [a.name.toLowerCase(), ...accentValues(a)].join(",");
}

/** The ACCENTS index a stored record names, or -1 (home purple) for none, or for anything else. */
export function accentIndex(raw: string | null | undefined): number {
  const name = raw?.split(",")[0];
  return ACCENTS.findIndex((a) => a.name.toLowerCase() === name);
}
