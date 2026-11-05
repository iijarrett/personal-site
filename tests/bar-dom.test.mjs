import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { initBar } from "../src/scripts/bar.ts";
import { installBarDom } from "./helpers/fake-bar-dom.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The bar script running in a fake DOM, restored when the test ends. */
function start(t, options) {
  const dom = installBarDom(options);
  t.after(() => dom.restore());
  initBar();
  return dom;
}

test("on a wide screen the page opens with the bar hidden; on a narrow one, shown", (t) => {
  const wide = start(t, { wide: true });
  assert.equal(wide.bar, "bar-off");
  wide.restore();
  assert.equal(start(t, { wide: false }).bar, "bar-on");
});

test("it sets exactly one of bar-on and bar-off, never both", (t) => {
  const dom = start(t, { wide: true });
  for (const step of [() => dom.wheel(-50), () => dom.scrollTo(300), () => dom.scrollTo(100)]) {
    step();
    const found = dom.classes().filter((name) => name.startsWith("bar-"));
    assert.equal(found.length, 1, found.join());
  }
});

test("a page restored part-way down opens with the bar hidden, even on a narrow screen", (t) => {
  assert.equal(start(t, { wide: false, scrollY: 900 }).bar, "bar-off");
});

test("wide: a wheel-up at the top shows the bar, and scrolling down hides it, scrolling up shows it", (t) => {
  const dom = start(t, { wide: true });
  dom.wheel(-100);
  assert.equal(dom.bar, "bar-on");
  dom.scrollTo(400);
  assert.equal(dom.bar, "bar-off");
  dom.scrollTo(300);
  assert.equal(dom.bar, "bar-on");
  dom.scrollTo(700);
  assert.equal(dom.bar, "bar-off");
});

test("a wheel-up away from the top is left to the scroll event, and a wheel-down changes nothing", (t) => {
  const dom = start(t, { wide: true, scrollY: 500 });
  dom.wheel(-100);
  assert.equal(dom.bar, "bar-off", "the page had not scrolled yet");
  dom.wheel(100);
  assert.equal(dom.bar, "bar-off");
});

test("narrow: shown at the top, hidden on scroll down, back on scroll up, and shown again at the top", (t) => {
  const dom = start(t, { wide: false });
  assert.equal(dom.bar, "bar-on");
  dom.scrollTo(250);
  assert.equal(dom.bar, "bar-off");
  dom.scrollTo(200);
  assert.equal(dom.bar, "bar-on");
  dom.scrollTo(600);
  assert.equal(dom.bar, "bar-off");
  dom.scrollTo(0);
  assert.equal(dom.bar, "bar-on");
});

test("an overscroll bounce above the top counts as the top, not as scrolling up", (t) => {
  const dom = start(t, { wide: true });
  dom.scrollTo(-40);
  assert.equal(dom.bar, "bar-off");
  dom.restore();
  const narrow = start(t, { wide: false });
  narrow.scrollTo(300);
  narrow.scrollTo(-40);
  assert.equal(narrow.bar, "bar-on");
});

test("a mouse at the top edge shows the bar, keeps it while over it, and hides it when it moves away", (t) => {
  const dom = start(t, { wide: true });
  dom.pointer(3);
  assert.equal(dom.bar, "bar-on");
  dom.pointer(40);
  assert.equal(dom.bar, "bar-on");
  dom.pointer(400);
  assert.equal(dom.bar, "bar-off");
  dom.pointer(40);
  assert.equal(dom.bar, "bar-off", "over where the hidden bar would be does not reveal it");
});

test("only a mouse reveals it: touch and pen pointer moves are ignored", (t) => {
  const dom = start(t, { wide: true });
  dom.pointer(2, "touch");
  dom.pointer(2, "pen");
  assert.equal(dom.bar, "bar-off");
});

test("the mouse leaving the window releases the top-edge hold", (t) => {
  const dom = start(t, { wide: true });
  dom.pointer(0);
  assert.equal(dom.bar, "bar-on");
  dom.pointerLeaveWindow();
  assert.equal(dom.bar, "bar-off");
});

test("keyboard focus entering the header shows it, and focus leaving it hides it again", (t) => {
  const dom = start(t, { wide: true });
  dom.focusIn(true);
  assert.equal(dom.bar, "bar-on");
  dom.focusOut(dom.inside); // moving between things inside the header keeps it
  assert.equal(dom.bar, "bar-on");
  dom.focusOut(null);
  assert.equal(dom.bar, "bar-off");
});

test("a mouse click that focuses something in the header does not bring the bar", (t) => {
  const dom = start(t, { wide: true });
  dom.focusIn(false);
  assert.equal(dom.bar, "bar-off");
});

test("focus in the header holds the bar open against scrolling down", (t) => {
  const dom = start(t, { wide: false });
  dom.focusIn(true);
  dom.scrollTo(500);
  assert.equal(dom.bar, "bar-on");
  dom.focusOut(null);
  assert.equal(dom.bar, "bar-off");
});

test("crossing the breakpoint re-decides at once", (t) => {
  const dom = start(t, { wide: true });
  assert.equal(dom.bar, "bar-off");
  dom.setWide(false);
  assert.equal(dom.bar, "bar-on");
  dom.setWide(true);
  assert.equal(dom.bar, "bar-off");
});

test("without a header it does nothing and does not throw", (t) => {
  const dom = installBarDom();
  t.after(() => dom.restore());
  globalThis.document.querySelector = () => null;
  assert.doesNotThrow(() => initBar());
  assert.equal(dom.bar, "");
});

test("the script's wide query is the CSS's (checked in full in tests/bar-media.test.mjs)", () => {
  assert.match(
    read("../src/scripts/bar.ts"),
    /matchMedia\("\(min-width: 641px\) and \(hover: hover\)"\)/,
  );
});
