/**
 * Build-time generator for the static hero frame: the shared ASCII field
 * (src/lib/ascii-field.ts) at t = 0 with no cursor. The canvas draws the same
 * function, so when it takes over nothing changes on screen.
 */

import { ambient, FRAME, levelOf, RAMP, symbolAt, TIER_ALPHA, tierOf } from "./ascii-field.ts";

export interface FrameOptions {
  cols?: number;
  rows?: number;
}

export function asciiFrame({ cols = FRAME.cols, rows = FRAME.rows }: FrameOptions = {}): string[] {
  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    let line = "";
    for (let col = 0; col < cols; col++) line += symbolAt(col, row, 0, { cols, rows });
    lines.push(line.trimEnd());
  }
  return lines;
}

/**
 * The same frame split into one text block per opacity tier (see TIER_ALPHA). Each
 * block keeps its own cells in place and blanks the rest, so stacking the blocks
 * rebuilds the frame. Empty lines hold one space so every block is `rows` lines tall.
 */
export function asciiTiers({ cols = FRAME.cols, rows = FRAME.rows }: FrameOptions = {}): string[] {
  const blocks: string[][] = TIER_ALPHA.map(() => []);
  for (let row = 0; row < rows; row++) {
    const lines = TIER_ALPHA.map(() => "");
    for (let col = 0; col < cols; col++) {
      const level = levelOf(ambient(col, row, 0, { cols, rows }));
      const tier = tierOf(level);
      TIER_ALPHA.forEach((_, index) => {
        lines[index] += index === tier ? RAMP.charAt(level) : " ";
      });
    }
    lines.forEach((line, index) => {
      blocks[index]?.push(line.trimEnd() || " ");
    });
  }
  return blocks.map((block) => block.join("\n"));
}
