/**
 * The rules for the face on the Me page and the JD mark on the Contact page: a field of code
 * symbols that resolves into a picture, then holds it. No DOM and no clock, so all of it can be
 * tested. The drawing lives in ../scripts/portrait.ts, which is the only file that imports this
 * one, so the bundler folds it into that script.
 */

/** Cell levels, from empty to full. The art in portrait-art.ts is written with these characters. */
export const RAMP = " .,:;-~=+*xX#%&@";
/** The symbols the field is made of. */
export const SYMBOLS = ".:-=+xX#018@:";

export const RESOLVE_START = 0.1; // seconds before the first cell locks in
export const RESOLVE_SPAN = 2.6; // the spread of lock-in times across the picture
export const RESOLVE_FADE = 0.55; // how long one cell takes to settle
/** When the last cell has settled. */
export const RESOLVED = RESOLVE_START + RESOLVE_SPAN + RESOLVE_FADE;
/** The moment shown when nothing moves: past RESOLVED, so the picture is complete. */
export const STILL = 5;

export const TONES = 8; // colour steps from the accent towards the highlight
export const ALPHAS = 12; // opacity steps

export type Tone = "photo" | "mark";

export interface Shape {
  cols: number;
  rows: number;
  tone: Tone;
  /** 0 (empty) to 15 (full) for every cell, row by row. */
  levels: Uint8Array;
  /** Seconds after RESOLVE_START that each cell locks in: a sweep from the left, roughed up. */
  delay: Float32Array;
  /** Where each cell is in its own drift, so the field does not move in step. */
  phase: Float32Array;
  /** The symbol each lit cell settles on. */
  lock: string[];
  /** 1 on the picture, falling to 0 a few cells out and at the edges: the field only fills a halo. */
  halo: Float32Array;
}

const HALO = 5; // how far the field reaches out from the picture, in cells (rows count double)
const EDGE = 3; // the field also fades to nothing over this many cells at the art's edge

/** One drawn cell: the symbol, its opacity (0 to 1) and its colour step (0 to TONES - 1). */
export interface Glyph {
  ch: string;
  alpha: number;
  tone: number;
}

/** A small, fixed scramble of two numbers into 0 up to 1. The same on every engine. */
export function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const pick = (seed: number): string => SYMBOLS.charAt(Math.floor(seed * SYMBOLS.length));

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** Reads the art (one character per cell, cols * rows of them) into per-cell data. */
export function makeShape(cols: number, rows: number, tone: Tone, cells: string): Shape {
  const n = cols * rows;
  const levels = new Uint8Array(n);
  const delay = new Float32Array(n);
  const phase = new Float32Array(n);
  const lock: string[] = [];
  for (let i = 0; i < n; i++) {
    levels[i] = Math.max(0, RAMP.indexOf(cells.charAt(i)));
    const sweep = (i % cols) / cols;
    delay[i] = (sweep * 0.55 + hash(i, 11) * 0.45) * RESOLVE_SPAN;
    phase[i] = hash(i, 5) * 10;
    lock.push(tone === "photo" ? (hash(i, 7) < 0.5 ? "0" : "1") : pick(hash(i, 9)));
  }
  return { cols, rows, tone, levels, delay, phase, lock, halo: makeHalo(cols, rows, levels) };
}

/**
 * How near each cell is to the picture, as a weight from 1 (on it) to 0 (HALO or more away).
 * A cell is about twice as tall as it is wide, so a step up or down counts double.
 */
function makeHalo(cols: number, rows: number, levels: Uint8Array): Float32Array {
  const halo = new Float32Array(cols * rows);
  const reach = Math.ceil(HALO / 2);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let near = HALO;
      for (let dy = -reach; dy <= reach; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -HALO; dx <= HALO; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= cols || !levels[yy * cols + xx]) continue;
          near = Math.min(near, Math.hypot(dx, dy * 2));
        }
      }
      const edge = Math.min(1, Math.min(x, cols - 1 - x, 2 * y, 2 * (rows - 1 - y)) / EDGE);
      halo[y * cols + x] = (1 - near / HALO) ** 1.5 * edge;
    }
  }
  return halo;
}

/** How bright a settled cell is. A photo keeps a deep range; a mark stays bold throughout. */
function target(tone: Tone, level: number): number {
  const l = level / 15;
  return tone === "photo" ? 0.04 + 0.96 * l ** 1.3 : 0.55 + 0.45 * l;
}

/**
 * What cell i shows at second t. `still` freezes the drift (the field and the rare flicker),
 * which is what the Motion switch off and reduced motion get. Returns false for a cell that is
 * too faint to draw; otherwise fills `out`.
 */
export function glyphAt(s: Shape, i: number, t: number, still: boolean, out: Glyph): boolean {
  const cx = i % s.cols;
  const cy = (i - cx) / s.cols;
  const drift = still ? 0 : t * 0.8;
  const ambient =
    (0.08 + 0.2 * (0.5 + 0.5 * Math.sin(cx * 0.19 + cy * 0.33 + drift))) * (s.halo[i] ?? 0);
  const tick = Math.floor(t * 14);
  const level = s.levels[i] ?? 0;
  let ch: string;
  let alpha = ambient;
  let tone = 1;
  const v = level ? smooth((t - RESOLVE_START - (s.delay[i] ?? 0)) / RESOLVE_FADE) : 0;
  if (v >= 0.999) {
    ch = s.lock[i] ?? "0";
    if (!still && hash(i, Math.floor(t * 2.5)) < 0.006) ch = pick(hash(i, tick));
    alpha = target(s.tone, level);
    tone = Math.min(TONES - 1, Math.round((level / 15) * (TONES - 1)));
  } else if (v > 0.001) {
    ch = pick(hash(i, tick * 3 + 1));
    alpha = ambient + (target(s.tone, level) - ambient) * v;
    tone = Math.min(TONES - 1, Math.round((level / 15) * (TONES - 1) * v));
  } else {
    ch = pick(hash(i, still ? 0 : Math.floor(t * 3 + (s.phase[i] ?? 0))));
  }
  if (alpha < 0.04) return false;
  out.ch = ch;
  out.alpha = alpha;
  out.tone = tone;
  return true;
}

/** Which of the ALPHAS opacity steps an opacity falls in. */
export const alphaStep = (alpha: number): number =>
  Math.min(ALPHAS - 1, Math.floor(alpha * ALPHAS));

/** The opacity a step is drawn at: the middle of its band. */
export const stepAlpha = (step: number): number => Math.min(1, (step + 0.5) / ALPHAS);

const HEX = /^#([0-9a-f]{6})$/i;

/**
 * TONES colours from `accent` to `highlight`, as rgb() strings. If either is not a #rrggbb
 * colour every step is the accent, so a theme change cannot break the drawing.
 */
export function tones(accent: string, highlight: string): string[] {
  const a = HEX.exec(accent.trim());
  const b = HEX.exec(highlight.trim());
  if (!a?.[1] || !b?.[1]) return Array.from({ length: TONES }, () => accent);
  const from = Number.parseInt(a[1], 16);
  const to = Number.parseInt(b[1], 16);
  return Array.from({ length: TONES }, (_, k) => {
    const f = k / (TONES - 1);
    const channel = (shift: number): number => {
      const x = (from >> shift) & 255;
      const y = (to >> shift) & 255;
      return Math.round(x + (y - x) * f);
    };
    return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
  });
}
