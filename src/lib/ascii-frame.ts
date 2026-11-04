/**
 * Build-time generator for the static hero frame: concentric rings radiating
 * from just below the bottom-centre of the grid, drawn with a character ramp.
 * Pure and deterministic (no Math.random, no clock), so the same options always
 * produce the same text and the output can be tested.
 */

const RAMP = " .:-=+*#%@";

export interface FrameOptions {
  cols?: number;
  rows?: number;
}

/** Cheap integer hash mapped to [0, 1). Gives each cell stable "grain". */
function grain(col: number, row: number): number {
  let h = Math.imul(col + 1, 374761393) ^ Math.imul(row + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function asciiFrame({ cols = 100, rows = 20 }: FrameOptions = {}): string[] {
  const originCol = (cols - 1) / 2;
  const originRow = rows + 2;
  const cellAspect = 2.1; // a character cell is roughly twice as tall as it is wide
  const lines: string[] = [];

  for (let row = 0; row < rows; row++) {
    let line = "";
    for (let col = 0; col < cols; col++) {
      const distance = Math.hypot(col - originCol, (row - originRow) * cellAspect);
      const ring = (0.5 + 0.5 * Math.cos(distance * 0.55)) ** 3;
      const fade = Math.exp(-distance / 40);
      const level = (ring * 1.1 + 0.04) * fade * (0.85 + 0.15 * grain(col, row));
      const index = Math.min(RAMP.length - 1, Math.max(0, Math.floor(level * RAMP.length)));
      line += RAMP.charAt(index);
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
