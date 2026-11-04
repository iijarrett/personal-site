import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOSED, isOpen, nextMenu } from "../src/lib/menu.ts";

const make = (flags = {}) => ({ ...CLOSED, ...flags });

// Named states, each a combination of the four independent holds.
const Z = CLOSED;
const H = make({ hover: true });
const F = make({ focus: true });
const HF = make({ hover: true, focus: true });
const P = make({ pinned: true });
const HP = make({ hover: true, pinned: true });
const DH = make({ hover: true, dismissed: true }); // Escape or a second click while hovered
const DF = make({ focus: true, dismissed: true }); // Escape while keyboard focus is in the menu

const names = new Map([
  [Z, "closed"],
  [H, "hovered"],
  [F, "focused"],
  [HF, "hovered+focused"],
  [P, "pinned"],
  [HP, "hovered+pinned"],
  [DH, "hovered, dismissed"],
  [DF, "focused, dismissed"],
]);

// [state, event, next]: every named state meets every event.
const table = [
  [Z, "enter", H],
  [Z, "leave", Z],
  [Z, "focus", F],
  [Z, "blur", Z],
  [Z, "click", P],
  [Z, "escape", Z],
  [Z, "outside", Z],

  [H, "enter", H],
  [H, "leave", Z],
  [H, "focus", HF],
  [H, "blur", H],
  [H, "click", HP],
  [H, "escape", DH],
  [H, "outside", Z],

  [F, "enter", HF],
  [F, "leave", F],
  [F, "focus", F],
  [F, "blur", Z],
  [F, "click", make({ focus: true, pinned: true })],
  [F, "escape", DF],
  [F, "outside", Z],

  [HF, "enter", HF],
  [HF, "leave", F],
  [HF, "focus", HF],
  [HF, "blur", H],
  [HF, "click", make({ hover: true, focus: true, pinned: true })],
  [HF, "escape", make({ hover: true, focus: true, dismissed: true })],
  [HF, "outside", Z],

  [P, "enter", HP],
  [P, "leave", P],
  [P, "focus", make({ focus: true, pinned: true })],
  [P, "blur", Z],
  [P, "click", make({ dismissed: true })],
  [P, "escape", make({ dismissed: true })],
  [P, "outside", Z],

  [HP, "enter", HP],
  [HP, "leave", P],
  [HP, "focus", make({ hover: true, focus: true, pinned: true })],
  [HP, "blur", H],
  [HP, "click", DH],
  [HP, "escape", DH],
  [HP, "outside", Z],

  [DH, "enter", DH],
  [DH, "leave", make({ dismissed: true })],
  [DH, "focus", HF],
  [DH, "blur", DH],
  [DH, "click", HP],
  [DH, "escape", DH],
  [DH, "outside", Z],

  [DF, "enter", HF],
  [DF, "leave", DF],
  [DF, "focus", DF],
  [DF, "blur", make({ dismissed: true })],
  [DF, "click", make({ focus: true, pinned: true })],
  [DF, "escape", DF],
  [DF, "outside", Z],
];

for (const [state, event, next] of table) {
  test(`menu ${names.get(state)} + ${event} -> ${JSON.stringify(next)}`, () => {
    assert.deepEqual(nextMenu(state, event), next);
  });
}

test("the table covers every named state against every event", () => {
  assert.equal(table.length, names.size * 7);
});

test("open means pinned, or hovered or focused and not dismissed", () => {
  const open = new Map([
    [Z, false],
    [H, true],
    [F, true],
    [HF, true],
    [P, true],
    [HP, true],
    [DH, false],
    [DF, false],
  ]);
  for (const [state, expected] of open) assert.equal(isOpen(state), expected, names.get(state));
  // And over every combination of the four flags.
  for (let bits = 0; bits < 16; bits++) {
    const state = {
      hover: !!(bits & 1),
      focus: !!(bits & 2),
      pinned: !!(bits & 4),
      dismissed: !!(bits & 8),
    };
    const expected = state.pinned || ((state.hover || state.focus) && !state.dismissed);
    assert.equal(isOpen(state), expected, JSON.stringify(state));
  }
});

// Facts that must hold from every one of the 16 combinations of flags.
const everyState = Array.from({ length: 16 }, (_, bits) => ({
  hover: !!(bits & 1),
  focus: !!(bits & 2),
  pinned: !!(bits & 4),
  dismissed: !!(bits & 8),
}));

test("from any state, Escape and a press outside leave the menu closed", () => {
  for (const state of everyState) {
    assert.equal(isOpen(nextMenu(state, "escape")), false, `escape ${JSON.stringify(state)}`);
    assert.equal(isOpen(nextMenu(state, "outside")), false, `outside ${JSON.stringify(state)}`);
  }
});

test("a click on a pinned menu closes it even while hovered or focused; otherwise it pins it open", () => {
  for (const state of everyState) {
    const next = nextMenu(state, "click");
    if (state.pinned) assert.equal(isOpen(next), false, `second click ${JSON.stringify(state)}`);
    else assert.equal(isOpen(next) && next.pinned, true, `first click ${JSON.stringify(state)}`);
  }
});

test("a fresh hover or focus entry always opens the menu, ending any dismissal", () => {
  // "Fresh" means the hold was not already there; a repeated enter or focus changes nothing.
  for (const state of everyState) {
    for (const [event, held] of [
      ["enter", state.hover],
      ["focus", state.focus],
    ]) {
      const next = nextMenu(state, event);
      if (held) {
        assert.equal(next, state, `a repeated ${event} must not change ${JSON.stringify(state)}`);
      } else {
        assert.equal(isOpen(next), true, `${event} ${JSON.stringify(state)}`);
        assert.equal(next.dismissed, false);
      }
    }
  }
});

test("leaving takes away only the pointer's hold, and blurring only focus's and the pin", () => {
  for (const state of everyState) {
    assert.deepEqual(nextMenu(state, "leave"), { ...state, hover: false });
    assert.deepEqual(nextMenu(state, "blur"), { ...state, focus: false, pinned: false });
  }
});

test("leaving or blurring never opens a menu that was closed", () => {
  for (const state of everyState.filter((s) => !isOpen(s))) {
    for (const event of ["leave", "blur", "escape", "outside"]) {
      assert.equal(isOpen(nextMenu(state, event)), false, `${event} ${JSON.stringify(state)}`);
    }
  }
});

test("the reducer returns the same state object when nothing changes, and never mutates", () => {
  assert.equal(nextMenu(H, "enter"), H);
  assert.equal(nextMenu(F, "focus"), F);
  assert.equal(nextMenu(Z, "leave"), Z);
  assert.equal(nextMenu(Z, "blur"), Z);
  assert.equal(nextMenu(Z, "escape"), Z);
  assert.equal(nextMenu(DH, "escape"), DH);
  const frozen = Object.freeze({ ...HP });
  assert.doesNotThrow(() => nextMenu(frozen, "click"));
  assert.deepEqual(CLOSED, { hover: false, focus: false, pinned: false, dismissed: false });
});

/** Feeds a list of events to the reducer from a closed menu and returns each step's openness. */
const run = (events) => {
  let state = CLOSED;
  return events.map((event) => {
    state = nextMenu(state, event);
    return isOpen(state);
  });
};

// ---------- The cases from review ----------

test("(a) hover-open, then focus enters the menu, then the pointer leaves: it stays open", () => {
  assert.deepEqual(run(["enter", "focus", "leave"]), [true, true, true]);
});

test("(b) hover over the menu, then Tab out: it stays open while the pointer is over it", () => {
  // Focus was inside (the button), then moves to the page. The pointer is still there.
  assert.deepEqual(run(["focus", "enter", "blur"]), [true, true, true]);
  assert.deepEqual(run(["enter", "focus", "blur"]), [true, true, true]);
  assert.deepEqual(run(["focus", "enter", "blur", "leave"]), [true, true, true, false]);
});

test("hover then leave with no focus closes it", () => {
  assert.deepEqual(run(["enter", "leave"]), [true, false]);
});

test("Tab in then Tab out with no hover closes it", () => {
  assert.deepEqual(run(["focus", "blur"]), [true, false]);
});

test("a click pin survives the pointer leaving, and a press outside ends it", () => {
  assert.deepEqual(run(["enter", "click", "leave"]), [true, true, true]);
  assert.deepEqual(run(["click", "leave", "outside"]), [true, true, false]);
});

test("Escape while hovered closes it, and it stays closed until the pointer re-enters", () => {
  assert.deepEqual(run(["enter", "escape", "leave", "enter"]), [true, false, false, true]);
  // Still over it: nothing but a fresh entry reopens it.
  assert.deepEqual(run(["enter", "escape", "blur", "escape"]), [true, false, false, false]);
});

test("a second click closes it even while the pointer is over it, until the pointer re-enters", () => {
  assert.deepEqual(run(["enter", "click", "click"]), [true, true, false]);
  assert.deepEqual(run(["enter", "click", "click", "leave", "enter"]), [
    true,
    true,
    false,
    false,
    true,
  ]);
});

test("touch: a tap pins it open (no hover events), and a tap outside closes it", () => {
  assert.deepEqual(run(["click", "outside"]), [true, false]);
  assert.deepEqual(run(["click", "click"]), [true, false]);
});

test("Escape with focus in the menu closes it until focus leaves and comes back", () => {
  assert.deepEqual(run(["focus", "escape", "blur", "focus"]), [true, false, false, true]);
});
