// WCAG contrast maths and token lookup for the tests that hold the palette to its numbers.

import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const tokens = read("../../src/styles/tokens.css");
const lightStart = tokens.indexOf('html[data-theme="light"]');

/** The two theme blocks of tokens.css: the dark :root and html[data-theme="light"]. */
export const themes = { dark: tokens.slice(0, lightStart), light: tokens.slice(lightStart) };

export const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

/** The colour a token has in a theme block, as [r, g, b]. */
export function colour(block, name) {
  const match = block.match(new RegExp(`^\\s*${name}:\\s*(#[0-9a-fA-F]{6})`, "m"));
  if (!match) throw new Error(`${name} is missing`);
  return rgb(match[1]);
}

const linear = (channel) => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A percentage token such as --glow-hover: 20%, as a fraction. */
export function percent(block, name) {
  const match = block.match(new RegExp(`^\\s*${name}:\\s*(\\d+)%`, "m"));
  if (!match) throw new Error(`${name} is missing`);
  return Number.parseInt(match[1], 10) / 100;
}

/** `base` with `tint` laid over it at `amount` (0 to 1), as [r, g, b]. */
export const mix = (base, tint, amount) => base.map((v, i) => v * (1 - amount) + tint[i] * amount);
