import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aim,
  BH,
  BW,
  brickX,
  brickY,
  COLS,
  DT,
  H,
  launch,
  newGame,
  PW,
  PY,
  R,
  ROWS,
  step,
  W,
} from "../src/lib/brick.ts";

/** A game in play with the ball placed by hand. */
function playing(over = {}) {
  const g = newGame();
  launch(g);
  return Object.assign(g, over);
}
const run = (g, seconds, move = 0) => {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) step(g, DT, move);
};
const speedOf = (g) => Math.hypot(g.vx, g.vy);

test("a new game waits: three lives, every brick standing, the ball on the paddle's middle", () => {
  const g = newGame();
  assert.equal(g.mode, "ready");
  assert.equal(g.lives, 3);
  assert.equal(g.left, COLS * ROWS);
  assert.ok(g.bricks.every(Boolean));
  assert.equal(g.bx, g.px);
  assert.equal(g.by, PY - R);
  assert.equal(g.score, 0);
  assert.equal(g.wave, 1);
});

test("aim keeps the paddle inside the field, and a waiting ball rides it", () => {
  const g = newGame();
  aim(g, -50);
  assert.equal(g.px, PW / 2);
  assert.equal(g.bx, PW / 2);
  aim(g, 9999);
  assert.equal(g.px, W - PW / 2);
  aim(g, 100);
  assert.equal(g.bx, 100);
  launch(g);
  aim(g, 40);
  assert.notEqual(g.bx, 40, "a ball in play does not ride the paddle");
});

test("held keys move the paddle at a steady speed, clamped at the walls", () => {
  const g = newGame();
  run(g, 0.25, 1);
  assert.ok(Math.abs(g.px - (W / 2 + 55)) < 0.5, String(g.px));
  run(g, 5, 1);
  assert.equal(g.px, W - PW / 2);
  run(g, 5, -1);
  assert.equal(g.px, PW / 2);
});

test("launch sends the ball up, once, at the starting speed, leaning the other way each time", () => {
  const g = newGame();
  launch(g);
  assert.equal(g.mode, "play");
  assert.ok(g.vy < 0);
  assert.ok(g.vx > 0);
  assert.ok(Math.abs(speedOf(g) - 110) < 1e-9);
  const before = { vx: g.vx, vy: g.vy };
  launch(g);
  assert.deepEqual({ vx: g.vx, vy: g.vy }, before, "launching again does nothing");

  const next = newGame();
  next.serve = g.serve;
  launch(next);
  assert.ok(next.vx < 0, "the second launch leans left");
});

test("the ball bounces off the side walls and the ceiling", () => {
  const left = playing({ bx: R + 0.2, by: 100, vx: -100, vy: 0 });
  step(left, DT, 0);
  assert.ok(left.vx > 0);
  assert.ok(left.bx >= R);

  const right = playing({ bx: W - R - 0.2, by: 100, vx: 100, vy: 0 });
  step(right, DT, 0);
  assert.ok(right.vx < 0);
  assert.ok(right.bx <= W - R);

  const top = playing({ bx: 120, by: R + 0.2, vx: 0, vy: -100 });
  // keep it clear of the bricks, which start at y 16
  step(top, DT, 0);
  assert.ok(top.vy > 0);
  assert.ok(top.by >= R);
});

test("the paddle returns the ball by where it lands: middle straight up, edges at an angle, speed kept", () => {
  const hitAt = (offset) => {
    const g = playing({ px: 120, bx: 120 + offset, by: PY - R - 0.5, vx: 0, vy: 110 });
    step(g, DT, 0);
    return g;
  };
  const mid = hitAt(0);
  assert.ok(Math.abs(mid.vx) < 1e-9);
  assert.ok(mid.vy < 0);
  const right = hitAt(PW / 2);
  const left = hitAt(-PW / 2);
  assert.ok(right.vx > 0 && right.vy < 0);
  assert.ok(left.vx < 0 && left.vy < 0);
  assert.ok(Math.abs(right.vx + left.vx) < 1e-9, "symmetric");
  const angle = Math.atan2(right.vx, -right.vy);
  assert.ok(angle > 0.8 && angle < 1.1, `${angle}`);
  for (const g of [mid, right, left]) assert.ok(Math.abs(speedOf(g) - 110) < 1e-9);
});

test("a ball that misses the paddle costs a life and is served again; the third miss ends the game", () => {
  const g = playing({ bx: 20, by: H - 2, vx: 0, vy: 100, px: 200 });
  run(g, 0.5);
  assert.equal(g.lives, 2);
  assert.equal(g.mode, "ready");
  assert.equal(g.bx, g.px);

  for (let miss = 0; miss < 2; miss++) {
    launch(g);
    Object.assign(g, { bx: 20, by: H - 2, vx: 0, vy: 100, px: 200 });
    run(g, 0.5);
  }
  assert.equal(g.lives, 0);
  assert.equal(g.mode, "over");
  const frozen = JSON.stringify(g);
  run(g, 1, 1);
  assert.equal(g.mode, "over");
  assert.equal(g.score, JSON.parse(frozen).score);
});

test("a brick breaks when hit from below: it goes, the ball turns round, and higher rows score more", () => {
  const bottom = COLS * (ROWS - 1);
  const g = playing({
    bx: brickX(bottom) + BW / 2,
    by: brickY(bottom) + BH + R + 0.3,
    vx: 0,
    vy: -100,
  });
  step(g, DT, 0);
  assert.equal(g.bricks[bottom], false);
  assert.equal(g.left, COLS * ROWS - 1);
  assert.equal(g.score, 10);
  assert.ok(g.vy > 0);

  // From above, so only the top row is in reach (the gaps between rows are narrower than the ball).
  const top = playing({ bx: brickX(0) + BW / 2, by: brickY(0) - R - 0.3, vx: 0, vy: 100 });
  step(top, DT, 0);
  assert.equal(top.bricks[0], false);
  assert.equal(top.score, 40);
  assert.ok(top.vy < 0);
});

test("hitting a brick from the side turns the ball round sideways", () => {
  const g = playing({ bx: brickX(0) - R - 0.3, by: brickY(0) + BH / 2, vx: 100, vy: 0 });
  step(g, DT, 0);
  assert.equal(g.bricks[0], false);
  assert.ok(g.vx < 0);
  assert.equal(g.vy, 0);
});

test("only one brick breaks per axis per step, so a gap between two never breaks both", () => {
  // The ball is wider than the 3px gap, so it overlaps two bricks at once.
  const g = playing({
    bx: brickX(0) + BW + 1.5,
    by: brickY(COLS * 3) + BH + R + 0.3,
    vx: 0,
    vy: -100,
  });
  step(g, DT, 0);
  assert.equal(g.left, COLS * ROWS - 1);
});

test("clearing the last brick starts the next wave: bricks back, ball waiting, score kept, faster", () => {
  const g = playing();
  g.bricks.fill(false);
  g.bricks[0] = true;
  g.left = 1;
  g.score = 120;
  Object.assign(g, { bx: brickX(0) + BW / 2, by: brickY(0) + BH + R + 0.3, vx: 0, vy: -100 });
  step(g, DT, 0);
  assert.equal(g.wave, 2);
  assert.equal(g.left, COLS * ROWS);
  assert.ok(g.bricks.every(Boolean));
  assert.equal(g.mode, "ready");
  assert.equal(g.score, 160);
  assert.equal(g.lives, 3);
  launch(g);
  assert.ok(Math.abs(speedOf(g) - 122) < 1e-9, String(speedOf(g)));
});

test("the ball speeds up as bricks break, and never past the cap", () => {
  const g = playing({ hits: 10 });
  Object.assign(g, { px: 120, bx: 120, by: PY - R - 0.5, vx: 0, vy: 110 });
  step(g, DT, 0);
  assert.ok(Math.abs(speedOf(g) - 118) < 1e-9);
  const fast = playing({ hits: 100000, wave: 50 });
  Object.assign(fast, { px: 120, bx: 120, by: PY - R - 0.5, vx: 0, vy: 110 });
  step(fast, DT, 0);
  assert.equal(speedOf(fast), 250);
});

test("the same inputs always give the same game", () => {
  const play = () => {
    const g = newGame();
    launch(g);
    for (let i = 0; i < 6000; i++) step(g, DT, i % 400 < 200 ? 1 : -1);
    return JSON.stringify(g);
  };
  assert.equal(play(), play());
});

// A bot that follows the ball with a shifting offset, so the bounces vary. It checks the
// invariants on every step: the ball stays in the field, nothing is NaN, the brick count matches,
// and the ball is never faster than the cap.
function bot(seconds) {
  const g = newGame();
  let cleared = 0;
  for (let t = 0; t < seconds && g.mode !== "over"; t += DT) {
    if (g.mode === "ready") launch(g);
    const offset = Math.sin(t * 0.37) * (PW / 2 - 4);
    aim(g, g.bx - offset);
    const before = g.left;
    step(g, DT, 0);
    if (g.left < before) cleared += 1;
    assert.ok(
      Number.isFinite(g.bx) &&
        Number.isFinite(g.by) &&
        Number.isFinite(g.vx) &&
        Number.isFinite(g.vy),
    );
    assert.ok(g.bx >= R - 1e-6 && g.bx <= W - R + 1e-6, `x ${g.bx}`);
    assert.ok(g.by >= R - 1e-6, `y ${g.by}`);
    assert.ok(speedOf(g) <= 250 + 1e-6);
    assert.equal(g.left, g.bricks.filter(Boolean).length);
  }
  return { g, cleared };
}

test("a steady bot plays for minutes without breaking the rules, and clears bricks and waves", () => {
  const { g, cleared } = bot(900);
  assert.ok(cleared >= 32, `only ${cleared} bricks cleared`);
  assert.ok(g.wave >= 2, `the bot never cleared a whole wave (wave ${g.wave}, ${g.mode})`);
});
