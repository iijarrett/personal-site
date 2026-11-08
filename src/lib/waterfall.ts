/**
 * The rules of the footer waterfall: which symbol sits in which cell at a given moment. Pure and
 * deterministic, with no DOM, clock or randomness (a fixed integer hash stands in for it), so a
 * frame can be replayed and tested. The strip is a field of thin streaks. Each column carries two,
 * every one with its own speed, length and gap, and a streak is densest at its head and thins out
 * behind it through the same density ramp the hero uses.
 *
 * Only ../scripts/waterfall.ts may import this file: the lazy chunk cannot share code with the page
 * script, so the bundler has to fold it into the chunk (check:dist refuses a chunk that imports).
 * That is also why the ramp is written out here instead of imported from ascii-field.ts. A test
 * keeps the two equal.
 */

/** The hero's density ramp, thinnest to densest. Index 0 is a space and is never drawn. */
export const RAMP = " .:-=+xX#8@";
export const TOP = RAMP.length - 1;

/** Width and height of one cell, in CSS px. */
export const PITCH = 14;

export interface Streak {
  /** Rows per second. */
  speed: number;
  /** Cells from the head back to the thinnest symbol. */
  tail: number;
  /** Rows between one pass of this streak and the next: the screen, the tail and a gap. */
  period: number;
  /** Where in its pass the streak starts, in rows. */
  phase: number;
}

const STREAKS = 2;

/** A 32-bit integer mix, then scaled to [0, 1). The same input always gives the same number. */
export function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The streaks of one column on a strip `rows` high. */
export function streaks(col: number, rows: number): Streak[] {
  const out: Streak[] = [];
  for (let k = 0; k < STREAKS; k++) {
    const seed = (col * STREAKS + k) * 5 + 1;
    const tail = 3 + Math.floor(hash(seed + 1) * 4); // 3 to 6
    const gap = 10 + Math.floor(hash(seed + 2) * 24); // 10 to 33: mostly empty sky, like rain
    const period = rows + tail + gap;
    out.push({
      speed: 3 + hash(seed) * 5, // 3 to 8 rows a second
      tail,
      period,
      phase: hash(seed + 3) * period,
    });
  }
  return out;
}

/**
 * The ramp level (0 to 10) of one cell at time `t` seconds. A streak moves a whole row at a time,
 * like a terminal. The head is level 10, and each step back is thinner until the tail is gone.
 */
export function levelAt(column: readonly Streak[], row: number, t: number): number {
  let best = 0;
  for (const s of column) {
    const head = Math.floor((t * s.speed + s.phase) % s.period);
    const behind = head - row;
    if (behind < 0 || behind >= s.tail) continue;
    const level = Math.round(TOP * (1 - behind / s.tail) ** 1.6);
    if (level > best) best = level;
  }
  return best;
}

/** Opacity for each ramp level: the thin symbols stay faint so the field never competes with text. */
export const ALPHA: readonly number[] = Array.from({ length: RAMP.length }, (_, i) =>
  i === 0 ? 0 : Math.round((0.1 + 0.8 * (i / TOP) ** 1.5) * 100) / 100,
);
