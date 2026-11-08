/**
 * The ASCII field shared by the build-time static frame and the runtime canvas.
 *
 * Ported from the portfolio prototype: rings radiate from just above the bottom
 * centre of the band, cubed so they read as soft arcs, each cell shimmers with its
 * own phase, and a cursor brightens nearby cells and turns the core into cycling
 * hex digits. Pure and deterministic: a cell's symbol depends only on
 * (col, row, t, pointer). It never reads the viewport, an array index, Math.random
 * or the clock, so the HTML frame (t = 0) and the canvas at t = 0 are identical.
 *
 * Coordinates are "frame space": column 0 / row 0 is the top-left cell of the
 * static frame. The canvas extends past it with negative and over-large columns.
 */

export const RAMP = " .:-=+xX#8@";
export const HEX = "0123456789ABCDEF";
const LAST = RAMP.length - 1;

/**
 * The prototype fades each of the ten levels separately. The static frame is plain
 * text, so it ships as three stacked layers, one opacity each, and the canvas uses
 * the same three steps: dim (levels 1-3), mid (4-6) and bright (7-10). The CSS in
 * global.css repeats these numbers, and a test keeps the two in step.
 */
export const TIER_ALPHA = [0.18, 0.42, 0.8] as const;

/** Which layer a level belongs to: 0, 1 or 2, or -1 for a space. */
export function tierOf(level: number): number {
  if (level <= 0) return -1;
  return level <= 3 ? 0 : level <= 6 ? 1 : 2;
}

/** Opacity per ramp level. Level 0 is a space and is never drawn. */
export const ALPHA: readonly number[] = Array.from(
  { length: RAMP.length },
  (_, level) => TIER_ALPHA[tierOf(level)] ?? 0,
);
/** Opacity of the hex digits under the cursor. */
export const HEX_ALPHA = 0.95;

/** Pixel size of one cell of the static frame (0.8rem JetBrains Mono, line-height 1.25). */
export const CELL_W = 7.68;
export const CELL_H = 16;

const V_STRETCH = 1.7; // vertical distance counts 1.7x, which makes the rings elliptical
const RING_K = (Math.PI * 2) / 60; // one ring every 60 px
const RING_SPEED = 1.15; // radians per second, so rings drift outward
const SHIMMER_SPEED = 1.7;
const FALL = 512; // px: how far the rings reach before fading out
const ORIGIN_RISE = 62; // px: the ring origin sits this far above the bottom edge

export const POINTER_RADIUS = 150; // px
export const HEX_TICKS_PER_SECOND = 8;

export interface Geometry {
  cols: number;
  rows: number;
}

/** The band shipped in the HTML. The canvas uses the same numbers. */
export const FRAME: Geometry = { cols: 100, rows: 30 };

/** How many columns the static frame's soft left and right edge takes (12ch in global.css). */
export const EDGE_COLS = 12;

/**
 * How visible a column of the static frame is: 0 outside the frame's columns, a
 * linear ramp over its outer EDGE_COLS on each side, 1 in the middle. global.css
 * masks the static frame with the same ramp so it does not hard-clip.
 */
export function bandMask(col: number, cols = FRAME.cols): number {
  if (col < 0 || col >= cols) return 0;
  const fromEdge = Math.min(col + 0.5, cols - col - 0.5);
  return Math.max(0, Math.min(1, fromEdge / EDGE_COLS));
}

/**
 * Opacity of a canvas column as the outer columns fade in (`edge` 0 to 1). At 0 it is
 * exactly the static frame's soft-edged band, so the swap changes nothing; at 1 the
 * field is unmasked and runs the full width. Columns beyond the frame go 0 to 1.
 */
export function columnAlpha(col: number, edge: number, cols = FRAME.cols): number {
  const mask = bandMask(col, cols);
  return mask + (1 - mask) * Math.max(0, Math.min(1, edge));
}

/** Cheap integer hash mapped to [0, 1). Exact in every engine, unlike a sin-based hash. */
export function grain(col: number, row: number): number {
  let h = Math.imul(col + 1, 374761393) ^ Math.imul(row + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Brightness of a cell from the rings and shimmer alone (about 0 to 1.2). */
export function ambient(
  col: number,
  row: number,
  t: number,
  { cols, rows }: Geometry = FRAME,
): number {
  const dx = (col + 0.5 - cols / 2) * CELL_W;
  const dy = ((row + 0.5) * CELL_H - (rows * CELL_H - ORIGIN_RISE)) * V_STRETCH;
  const distance = Math.hypot(dx, dy);
  const ring = (0.5 + 0.5 * Math.cos(distance * RING_K - t * RING_SPEED)) ** 3;
  const shimmer = 0.82 + 0.18 * Math.sin(t * SHIMMER_SPEED + grain(col, row) * Math.PI * 2);
  return (ring * 1.15 + 0.07) * Math.exp(-distance / FALL) * shimmer;
}

/** Brightness to a ramp level, 0 (space) to 10 (@). */
export function levelOf(brightness: number): number {
  return Math.max(0, Math.min(LAST, Math.floor(brightness * (LAST + 0.99))));
}

/** The ambient symbol of a cell. */
export function symbolAt(col: number, row: number, t: number, geometry: Geometry = FRAME): string {
  return RAMP.charAt(levelOf(ambient(col, row, t, geometry)));
}

/**
 * The columns, in frame space, needed to cover a canvas of `canvasWidth` px when
 * frame column 0 starts `frameLeft` px from its left edge. Both ends are inclusive.
 */
export function columnRange(
  canvasWidth: number,
  frameLeft: number,
  cellWidth: number,
): { first: number; last: number } {
  return {
    first: Math.floor(-frameLeft / cellWidth) || 0,
    last: Math.ceil((canvasWidth - frameLeft) / cellWidth) - 1,
  };
}

/**
 * The y of the alphabetic baseline that puts a glyph where CSS would, for a line
 * box `rowHeight` tall: the half-leading above the font's ascent, rounded down as
 * Blink does (so a line box of 15.98px around a 17px font starts 1px high, not 0.5).
 * Falls back to a typical ratio if the browser cannot report the font's bounding box.
 */
export function textBaseline(rowHeight: number, ascent: number, descent: number): number {
  if (!(Number.isFinite(ascent) && Number.isFinite(descent))) return rowHeight * 0.78;
  return Math.floor((rowHeight - (ascent + descent)) / 2) + ascent;
}

/** Distance in px from a cell's centre to a point in frame space. */
export function pointerDistance(col: number, row: number, x: number, y: number): number {
  return Math.hypot((col + 0.5) * CELL_W - x, (row + 0.5) * CELL_H - y);
}

/** Extra brightness from the cursor: 0 outside the radius, 0.85 * strength at its centre. */
export function pointerBoost(distance: number, strength: number): number {
  if (strength <= 0 || distance >= POINTER_RADIUS) return 0;
  const falloff = 1 - distance / POINTER_RADIUS;
  return falloff * falloff * 0.85 * strength;
}

/** The core of the cursor's reach, where cells turn into hex digits. It grows with strength. */
export function inHexCore(distance: number, strength: number): boolean {
  return strength > 0.01 && distance < POINTER_RADIUS * 0.5 * strength;
}

/** A hex digit that cycles over time and differs from cell to cell. */
export function hexChar(col: number, row: number, t: number): string {
  const tick = Math.floor(t * HEX_TICKS_PER_SECOND);
  const index = Math.floor(grain(col, row) * 97 + tick + col);
  return HEX.charAt(((index % 16) + 16) % 16);
}
