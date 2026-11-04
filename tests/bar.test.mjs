import assert from "node:assert/strict";
import { test } from "node:test";
import { barShown, EDGE, pointerAt, START, STEP, scrolled, wheel } from "../src/lib/bar.ts";

const make = (flags = {}) => ({ ...START, ...flags });

// ---------- scrolled: direction, with a step so jitter is ignored ----------

test("scrolling down or up by at least STEP sets the direction and the new reference", () => {
  const down = scrolled(make({ last: 100 }), 100 + STEP);
  assert.deepEqual(down, make({ last: 100 + STEP, dir: "down" }));
  const up = scrolled(make({ last: 100, dir: "down" }), 100 - STEP);
  assert.deepEqual(up, make({ last: 100 - STEP, dir: "up" }));
});

test("moves smaller than STEP change nothing, and the reference stays put so a slow scroll still adds up", () => {
  let state = make({ last: 200, dir: "down" });
  for (const y of [199, 198, 197, 196, 195, 194, 193]) {
    assert.equal(scrolled(state, y), state, `y=${y}`);
  }
  assert.equal(scrolled(state, 200 - STEP).dir, "up");
  state = scrolled(state, 200 - STEP);
  assert.equal(state.last, 200 - STEP);
});

test("scrolled keeps the pointer and focus holds, and never mutates its input", () => {
  const frozen = Object.freeze(make({ edge: true, focus: true, last: 50 }));
  const next = scrolled(frozen, 500);
  assert.equal(next.edge, true);
  assert.equal(next.focus, true);
  assert.equal(frozen.last, 50);
});

// ---------- wheel ----------

test("a wheel-up at the very top sets the direction up; anywhere else, or downward, it does nothing", () => {
  const start = make();
  assert.equal(wheel(start, -120, true).dir, "up");
  assert.equal(
    wheel(start, -120, false),
    start,
    "away from the top the page scrolls and says so itself",
  );
  assert.equal(wheel(start, 120, true), start);
  assert.equal(wheel(start, 0, true), start);
  const up = make({ dir: "up" });
  assert.equal(wheel(up, -120, true), up);
});

// ---------- pointerAt ----------

test("a hidden bar needs the pointer at the top edge; a shown one is kept while the pointer is over it", () => {
  const state = make();
  assert.equal(pointerAt(state, EDGE, false, 61).edge, true);
  assert.equal(pointerAt(state, EDGE + 1, false, 61).edge, false);
  assert.equal(
    pointerAt(state, 40, false, 61).edge,
    false,
    "over where the bar would be is not enough",
  );
  const over = make({ edge: true });
  assert.equal(pointerAt(over, 61, true, 61).edge, true);
  assert.equal(pointerAt(over, 62, true, 61).edge, false);
  assert.equal(pointerAt(state, 40, true, 61).edge, true, "a shown bar holds the pointer over it");
});

test("pointerAt returns the same state when nothing changes", () => {
  const state = make();
  assert.equal(pointerAt(state, 500, false, 61), state);
  const edge = make({ edge: true });
  assert.equal(pointerAt(edge, 3, false, 61), edge);
});

// ---------- barShown: the table ----------

// [description, state, wide, atTop, shown]
const table = [
  ["narrow, at the top, nothing else: shown", make(), false, true, true],
  ["narrow, scrolled down: hidden", make({ dir: "down" }), false, false, false],
  ["narrow, scrolled down then up: shown", make({ dir: "up" }), false, false, true],
  ["narrow, restored part-way down the page: hidden", make(), false, false, false],
  [
    "narrow, back at the very top after scrolling down: shown",
    make({ dir: "down" }),
    false,
    true,
    true,
  ],
  ["wide, at the top, nothing else: hidden", make(), true, true, false],
  ["wide, scrolled down: hidden", make({ dir: "down" }), true, false, false],
  ["wide, scrolled up: shown", make({ dir: "up" }), true, false, true],
  ["wide, at the top after a wheel-up: shown", make({ dir: "up" }), true, true, true],
  ["wide, at the top after scrolling down: hidden", make({ dir: "down" }), true, true, false],
  ["wide, mouse at the top edge: shown", make({ edge: true }), true, true, true],
  [
    "wide, scrolled down but the mouse is over the bar: shown",
    make({ dir: "down", edge: true }),
    true,
    false,
    true,
  ],
  ["wide, keyboard focus in the header: shown", make({ focus: true }), true, true, true],
  [
    "wide, scrolled down but focus is in the header: shown",
    make({ dir: "down", focus: true }),
    true,
    false,
    true,
  ],
  [
    "narrow, scrolled down but focus is in the header: shown",
    make({ dir: "down", focus: true }),
    false,
    false,
    true,
  ],
  [
    "narrow, scrolled down but the mouse is at the edge: shown",
    make({ dir: "down", edge: true }),
    false,
    false,
    true,
  ],
];

for (const [description, state, wide, atTop, shown] of table) {
  test(`bar: ${description}`, () => {
    assert.equal(barShown(state, wide, atTop), shown);
  });
}

// ---------- Scenarios ----------

/** Plays events against the reducer and reports whether the bar shows after each. */
function play({ wide, steps }) {
  let state = make();
  let y = 0;
  let shown = false;
  const out = [];
  for (const step of steps) {
    if (step.scroll !== undefined) {
      y = step.scroll;
      state = scrolled(state, y);
    }
    if (step.wheel !== undefined) state = wheel(state, step.wheel, y <= 0);
    if (step.mouse !== undefined) state = pointerAt(state, step.mouse, shown, 61);
    if (step.leave) state = { ...state, edge: false };
    if (step.focus !== undefined) state = { ...state, focus: step.focus };
    shown = barShown(state, wide, y <= 0);
    out.push(shown);
  }
  return out;
}

test("desktop: opens hidden, a wheel-up at the top shows it, scrolling down hides it, scrolling up shows it", () => {
  assert.deepEqual(
    play({
      wide: true,
      steps: [{}, { wheel: -100 }, { scroll: 300 }, { scroll: 250 }, { scroll: 600 }],
    }),
    [false, true, false, true, false],
  );
});

test("desktop: the mouse at the top edge shows it, stays while over it, and hides it when it leaves", () => {
  assert.deepEqual(
    play({ wide: true, steps: [{ mouse: 2 }, { mouse: 30 }, { mouse: 61 }, { mouse: 300 }] }),
    [true, true, true, false],
  );
  assert.deepEqual(play({ wide: true, steps: [{ mouse: 0 }, { leave: true }] }), [true, false]);
});

test("desktop: keyboard focus entering the header shows it, and leaving hides it again", () => {
  assert.deepEqual(play({ wide: true, steps: [{ focus: true }, { focus: false }] }), [true, false]);
});

test("phone: shown at the very top, hidden on scroll down, back on scroll up, and at the top again", () => {
  assert.deepEqual(
    play({
      wide: false,
      steps: [{}, { scroll: 200 }, { scroll: 150 }, { scroll: 400 }, { scroll: 0 }],
    }),
    [true, false, true, false, true],
  );
});

test("phone: jitter of a few pixels while scrolling down does not bring it back", () => {
  assert.deepEqual(
    play({
      wide: false,
      steps: [{ scroll: 200 }, { scroll: 196 }, { scroll: 199 }, { scroll: 203 }],
    }),
    [false, false, false, false],
  );
});

test("narrow top-of-page rule does not apply on a wide screen", () => {
  assert.equal(barShown(make(), true, true), false);
  assert.equal(barShown(make(), false, true), true);
});
