/**
 * The brick breaker's rules, with no DOM, no clock and no randomness. The footer game steps this
 * at a fixed rate and draws what it holds, so the same inputs always give the same game and the
 * rules can be tested in Node. Sizes are in a small logical field (W by H); the canvas scales it.
 */

export const W = 240;
export const H = 150;
export const COLS = 8;
export const ROWS = 4;
export const BW = 26;
export const BH = 9;
export const PW = 36;
export const PH = 4;
export const PY = H - 12;
export const R = 2.5; // the ball is a square of side 2R
export const DT = 1 / 120; // the fixed step, in seconds
const GAP = 3;
const X0 = 5;
const Y0 = 16;
const PADDLE_SPEED = 220;
const LIVES = 3;
const MAX_ANGLE = 1.05; // radians from straight up, at the paddle's edge

export type Game = {
  mode: "ready" | "play" | "over";
  px: number; // paddle centre
  bx: number;
  by: number;
  vx: number;
  vy: number;
  bricks: boolean[];
  left: number; // bricks still standing
  score: number;
  lives: number;
  wave: number;
  hits: number; // bricks broken this wave: the ball speeds up with it
  serve: 1 | -1; // which way the next launch leans
};

export const brickX = (i: number): number => X0 + (i % COLS) * (BW + GAP);
export const brickY = (i: number): number => Y0 + Math.floor(i / COLS) * (BH + GAP);

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const speed = (g: Game): number => Math.min(250, 110 + 12 * (g.wave - 1) + 0.8 * g.hits);

export function newGame(): Game {
  return {
    mode: "ready",
    px: W / 2,
    bx: W / 2,
    by: PY - R,
    vx: 0,
    vy: 0,
    bricks: Array.from({ length: COLS * ROWS }, () => true),
    left: COLS * ROWS,
    score: 0,
    lives: LIVES,
    wave: 1,
    hits: 0,
    serve: 1,
  };
}

/** Put the ball back on the paddle, waiting for a launch. */
function serve(g: Game): void {
  g.mode = "ready";
  g.vx = 0;
  g.vy = 0;
  g.bx = g.px;
  g.by = PY - R;
}

/** Move the paddle to x (a pointer or finger). A waiting ball rides on it. */
export function aim(g: Game, x: number): void {
  g.px = clamp(x, PW / 2, W - PW / 2);
  if (g.mode === "ready") g.bx = g.px;
}

/** Send a waiting ball up and to one side. Anything else does nothing. */
export function launch(g: Game): void {
  if (g.mode !== "ready") return;
  const s = speed(g);
  g.mode = "play";
  g.vx = g.serve * 0.4 * s;
  g.vy = -Math.sqrt(s * s - g.vx * g.vx);
  g.serve = g.serve === 1 ? -1 : 1;
}

/** The first standing brick the ball would overlap at (x, y), or -1. */
function hit(g: Game, x: number, y: number): number {
  for (let i = 0; i < g.bricks.length; i++) {
    if (g.bricks[i] !== true) continue;
    const bx = brickX(i);
    const by = brickY(i);
    if (x + R > bx && x - R < bx + BW && y + R > by && y - R < by + BH) return i;
  }
  return -1;
}

function smash(g: Game, i: number): void {
  g.bricks[i] = false;
  g.left -= 1;
  g.hits += 1;
  g.score += 10 * (ROWS - Math.floor(i / COLS));
  if (g.left === 0) {
    g.wave += 1;
    g.hits = 0;
    g.left = COLS * ROWS;
    g.bricks.fill(true);
    serve(g);
  }
}

/**
 * Advance dt seconds. move is -1, 0 or 1 (held keys). At the speeds used the ball moves under
 * 2.2px a step, less than its own size, so it cannot pass through a brick or the paddle.
 */
export function step(g: Game, dt: number, move: number): void {
  if (move) aim(g, g.px + move * PADDLE_SPEED * dt);
  if (g.mode !== "play") return;

  let x = g.bx + g.vx * dt;
  if (x < R) {
    x = R;
    g.vx = Math.abs(g.vx);
  } else if (x > W - R) {
    x = W - R;
    g.vx = -Math.abs(g.vx);
  }
  const hx = hit(g, x, g.by);
  if (hx < 0) {
    g.bx = x;
  } else {
    g.vx = -g.vx;
    smash(g, hx);
  }
  if (g.mode !== "play") return;

  let y = g.by + g.vy * dt;
  if (y < R) {
    y = R;
    g.vy = Math.abs(g.vy);
  }
  const hy = hit(g, g.bx, y);
  if (hy < 0) {
    g.by = y;
  } else {
    g.vy = -g.vy;
    smash(g, hy);
  }
  if (g.mode !== "play") return;

  if (g.vy > 0 && g.by + R >= PY && g.by - R <= PY + PH && Math.abs(g.bx - g.px) <= PW / 2 + R) {
    const s = speed(g);
    const a = ((g.bx - g.px) / (PW / 2 + R)) * MAX_ANGLE;
    g.vx = s * Math.sin(a);
    g.vy = -s * Math.cos(a);
    g.by = PY - R;
  } else if (g.by - R > H) {
    g.lives -= 1;
    if (g.lives > 0) serve(g);
    else g.mode = "over";
  }
}
