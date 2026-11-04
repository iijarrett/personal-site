import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOSED, isOpen, nextMenu } from "../src/lib/menu.ts";

const by = (value) => ({ by: value });

// [state, event, next]: every state meets every event.
const table = [
  [CLOSED, "enter", by("hover")],
  [CLOSED, "leave", CLOSED],
  [CLOSED, "focus", by("focus")],
  [CLOSED, "blur", CLOSED],
  [CLOSED, "click", by("click")],
  [CLOSED, "escape", CLOSED],
  [CLOSED, "outside", CLOSED],

  [by("hover"), "enter", by("hover")],
  [by("hover"), "leave", CLOSED],
  [by("hover"), "focus", by("focus")],
  [by("hover"), "blur", CLOSED],
  [by("hover"), "click", by("click")],
  [by("hover"), "escape", CLOSED],
  [by("hover"), "outside", CLOSED],

  [by("focus"), "enter", by("focus")],
  [by("focus"), "leave", by("focus")],
  [by("focus"), "focus", by("focus")],
  [by("focus"), "blur", CLOSED],
  [by("focus"), "click", by("click")],
  [by("focus"), "escape", CLOSED],
  [by("focus"), "outside", CLOSED],

  [by("click"), "enter", by("click")],
  [by("click"), "leave", by("click")],
  [by("click"), "focus", by("click")],
  [by("click"), "blur", CLOSED],
  [by("click"), "click", CLOSED],
  [by("click"), "escape", CLOSED],
  [by("click"), "outside", CLOSED],
];

for (const [state, event, next] of table) {
  test(`menu ${state.by ?? "closed"} + ${event} -> ${next.by ?? "closed"}`, () => {
    assert.deepEqual(nextMenu(state, event), next);
  });
}

test("the table covers every state against every event", () => {
  assert.equal(table.length, 4 * 7);
});

test("isOpen is true exactly when the menu was opened by something", () => {
  assert.equal(isOpen(CLOSED), false);
  for (const opener of ["hover", "focus", "click"]) assert.equal(isOpen(by(opener)), true);
});

test("a hover-opened menu is pinned by a click: leaving no longer closes it, a second click does", () => {
  let state = nextMenu(CLOSED, "enter");
  state = nextMenu(state, "click");
  state = nextMenu(state, "leave");
  assert.equal(isOpen(state), true);
  assert.equal(isOpen(nextMenu(state, "click")), false);
});

test("a menu closed by Escape, a blur or an outside press stays closed when the pointer leaves", () => {
  for (const event of ["escape", "blur", "outside"]) {
    assert.equal(isOpen(nextMenu(nextMenu(by("hover"), event), "leave")), false, event);
  }
});

test("the reducer returns the same state object when nothing changes, and never mutates", () => {
  const open = Object.freeze(by("click"));
  assert.equal(nextMenu(open, "enter"), open);
  assert.equal(nextMenu(open, "leave"), open);
  assert.equal(CLOSED.by, null);
});
