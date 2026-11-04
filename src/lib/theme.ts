/**
 * The theme: dark unless the visitor chose light. Pure, so it can be tested. The DOM
 * glue is src/scripts/settings.ts, and public/theme-init.js applies a saved light
 * theme before first paint (tests/theme.test.mjs keeps the two in step).
 */

export const THEME_KEY = "theme";
export type Theme = "dark" | "light";

/** Anything but a stored "light" means dark, so a missing, blocked or corrupt value is safe. */
export function parseTheme(raw: string | null | undefined): Theme {
  return raw === "light" ? "light" : "dark";
}

/** The page background of each theme, for the theme-color meta (the same as --bg in tokens.css). */
export const THEME_COLOR: Record<Theme, string> = { dark: "#16161e", light: "#e1e2e7" };
