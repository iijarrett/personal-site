import assert from "node:assert/strict";
import { test } from "node:test";
import { bandMask, FRAME, TIER_ALPHA, textBaseline } from "../src/lib/ascii-field.ts";
import { asciiTiers } from "../src/lib/ascii-frame.ts";
import { motionMode } from "../src/lib/motion.ts";
import { initHero } from "../src/scripts/hero.ts";
import { installFakeDom } from "./helpers/fake-dom.mjs";

// These run the real src/scripts/hero.ts against a fake DOM (tests/helpers/fake-dom.mjs):
// frames, the clock and the canvas are all driven and recorded by the test.

const TIER_ALPHAS = [0.18, 0.42, 0.8];
const ON = { motionOn: true, reducedMotion: false, canHover: true };
const mode = (overrides = {}) => motionMode({ ...ON, ...overrides });

/** A stand-in for motion-state.ts: hands the hero the current mode, and pushes new ones. */
function modeHost(initial) {
  let listener;
  let current = initial;
  return {
    subscribe(next) {
      listener = next;
      next(current);
    },
    set(next) {
      current = next;
      listener?.(next);
    },
  };
}

/** A hero running in a fake DOM, after first paint, with its canvas live. */
async function startHero(t, options = {}, initial = mode()) {
  const dom = installFakeDom(options);
  t.after(() => dom.restore());
  const host = modeHost(initial);
  initHero(host.subscribe);
  await dom.boot();
  return { dom, host };
}

const hexOf = (draw) => draw.filter((glyph) => /[A-F0-79]/.test(glyph.text));
const keyOf = (glyph) => `${glyph.text}@${glyph.x.toFixed(2)},${glyph.y.toFixed(2)}`;
/** Whether a glyph sits within the static frame's 100 columns. */
const inFrame = (dom) => {
  const left = dom.pres[0].getBoundingClientRect().left;
  const right = left + 100 * dom.charWidth();
  return (glyph) => glyph.x >= left - 0.01 && glyph.x < right - 0.01;
};
const innerKeys = (dom, draw) => new Set(draw.filter(inFrame(dom)).map(keyOf));
const differences = (a, b) =>
  [...a].filter((key) => !b.has(key)).length + [...b].filter((key) => !a.has(key)).length;

test("the hero starts after first paint with the canvas live and the loop running", async (t) => {
  const { dom } = await startHero(t);
  assert.ok(dom.hero.classList.contains("is-live"));
  assert.equal(dom.canvas.hidden, false);
  assert.equal(dom.pendingFrames(), 1, "the loop is running");
});

test("the canvas's first frame matches the static frame layers glyph for glyph: character, position and opacity", async (t) => {
  const { dom } = await startHero(t);
  const first = dom.ctx.draws[0];
  const pre = dom.pres[0].getBoundingClientRect();
  const cell = dom.charWidth();
  const rowHeight = pre.height / FRAME.rows;
  const metrics = dom.ctx.measureText();
  const baseline = textBaseline(
    rowHeight,
    metrics.fontBoundingBoxAscent,
    metrics.fontBoundingBoxDescent,
  );
  const near = (actual, expected, what) =>
    assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} is not ${expected}`);

  // What the static frame shows: the three layers, each glyph at its tier's opacity,
  // under the soft left and right edge (bandMask) that global.css applies to it.
  const expected = new Map();
  asciiTiers().forEach((layer, tier) => {
    layer.split("\n").forEach((line, row) => {
      [...line].forEach((char, col) => {
        if (char === " ") return;
        expected.set(`${row},${col}`, {
          char,
          alpha: TIER_ALPHA[tier] * bandMask(col),
          x: pre.left + col * cell,
          y: row * rowHeight + baseline,
        });
      });
    });
  });

  const drawn = new Map(
    first.map((glyph) => [
      `${Math.round((glyph.y - baseline) / rowHeight)},${Math.round((glyph.x - pre.left) / cell)}`,
      glyph,
    ]),
  );
  assert.equal(drawn.size, first.length, "two glyphs were drawn on one cell");
  assert.equal(drawn.size, expected.size, "a different number of glyphs than the static frame");
  assert.ok(expected.size > 500);
  for (const [key, want] of expected) {
    const glyph = drawn.get(key);
    assert.ok(glyph, `the static frame's cell ${key} is not drawn`);
    assert.equal(glyph.text, want.char, `cell ${key}`);
    near(glyph.x, want.x, `x of ${key}`);
    near(glyph.y, want.y, `y of ${key}`);
    near(glyph.alpha, want.alpha, `opacity of ${key}`);
  }
});

test("turning the toggle off cancels the pending frame at once and leaves the canvas showing its last frame", async (t) => {
  const { dom, host } = await startHero(t);
  dom.frames(180); // three seconds of running
  const { ctx } = dom;
  const drawsBefore = ctx.draws.length;
  assert.ok(drawsBefore > 30, `only ${drawsBefore} draws`);
  assert.equal(dom.pendingFrames(), 1);

  host.set(mode({ motionOn: false }));

  assert.equal(dom.pendingFrames(), 0, "a frame is still scheduled");
  assert.ok(dom.cancelledFrames().length >= 1, "the pending frame was not cancelled");
  dom.frames(180);
  assert.equal(
    ctx.draws.length,
    drawsBefore,
    "it kept drawing, or redrew the frame, after the toggle went off",
  );
  assert.ok(dom.hero.classList.contains("is-live"), "the static frame was swapped back in");
  assert.equal(dom.canvas.hidden, false, "the canvas was hidden");
});

test("no frame is scheduled after toggle-off, even as the hero scrolls out and in or the tab hides and shows", async (t) => {
  const { dom, host } = await startHero(t);
  dom.frames(240); // long enough for the opening fade to finish, so nothing is left to repaint
  host.set(mode({ motionOn: false }));
  const draws = dom.ctx.draws.length;

  dom.intersect(false);
  dom.intersect(true);
  dom.setTabHidden(true);
  dom.setTabHidden(false);
  host.set(mode({ motionOn: false, reducedMotion: true })); // another mode change while off

  assert.equal(dom.pendingFrames(), 0);
  dom.frames(120);
  assert.equal(dom.ctx.draws.length, draws);
});

test("turning it back on resumes from the frozen frame, not from t = 0, and keeps the outer columns", async (t) => {
  const { dom, host } = await startHero(t);
  const { ctx } = dom;
  const atStart = innerKeys(dom, ctx.draws[0]);
  dom.frames(240); // four seconds: the symbols have moved on, the outer columns have faded in
  const frozen = innerKeys(dom, ctx.draws.at(-1));
  assert.ok(differences(atStart, frozen) > 100, "time should have moved the field on by now");

  host.set(mode({ motionOn: false }));
  dom.frames(60);
  host.set(mode());
  assert.equal(dom.pendingFrames(), 1, "it did not start running again");
  const before = ctx.draws.length;
  dom.frames(6);
  assert.ok(ctx.draws.length > before, "no frame was drawn after turning it on");
  const resumed = ctx.draws[before];

  assert.ok(
    differences(innerKeys(dom, resumed), frozen) < differences(atStart, frozen) / 4,
    "the field restarted from t = 0 instead of carrying on",
  );
  const outer = resumed.filter((glyph) => !inFrame(dom)(glyph));
  assert.ok(outer.length > 100, "the outer columns are gone");
  assert.ok(
    outer.every((glyph) => TIER_ALPHAS.some((alpha) => Math.abs(alpha - glyph.alpha) < 1e-9)),
    "the outer columns faded back in instead of staying fully visible",
  );
});

test("with the toggle off at load the static frame stays, and turning it on fades the outer columns in", async (t) => {
  const { dom, host } = await startHero(t, {}, mode({ motionOn: false }));
  assert.ok(!dom.hero.classList.contains("is-live"));
  assert.equal(dom.pendingFrames(), 0);
  assert.equal(dom.ctx?.draws.length ?? 0, 0);

  host.set(mode());
  assert.ok(dom.hero.classList.contains("is-live"));
  assert.ok(dom.ctx.draws[0].every(inFrame(dom)), "the outer columns appeared at once");
  dom.frames(240);
  assert.ok(
    dom.ctx.draws.at(-1).some((glyph) => !inFrame(dom)(glyph)),
    "they never faded in",
  );
});

test("under reduced motion the outer columns are there from the first frame, and the symbols still move", async (t) => {
  const { dom } = await startHero(t, {}, mode({ reducedMotion: true }));
  assert.ok(
    dom.ctx.draws[0].some((glyph) => !inFrame(dom)(glyph)),
    "they faded in under reduced motion",
  );
  const first = innerKeys(dom, dom.ctx.draws[0]);
  dom.frames(180);
  assert.ok(differences(first, innerKeys(dom, dom.ctx.draws.at(-1))) > 100);
});

/** Outer glyphs, and whether every one of them is at a tier's final opacity (no fade left in it). */
const outerGlyphs = (dom, draw) => draw.filter((glyph) => !inFrame(dom)(glyph));
const atFinalOpacity = (glyphs) =>
  glyphs.every((glyph) => TIER_ALPHAS.some((alpha) => Math.abs(alpha - glyph.alpha) < 1e-9));

test("reduced motion arriving during the opening fade completes it at once, instead of easing on", async (t) => {
  const { dom, host } = await startHero(t);
  dom.frames(14); // part-way through the fade: a few frames at 30 fps
  const midFade = outerGlyphs(dom, dom.ctx.draws.at(-1));
  assert.ok(midFade.length > 0, "the fade should have started");
  assert.equal(atFinalOpacity(midFade), false, "the fade should still be under way");

  const before = dom.ctx.draws.length;
  host.set(mode({ reducedMotion: true }));

  // Straight away, with no frame in between: the canvas was repainted at final opacity.
  assert.ok(dom.ctx.draws.length > before, "nothing was repainted when reduced motion arrived");
  const now = outerGlyphs(dom, dom.ctx.draws.at(-1));
  assert.ok(now.length >= midFade.length);
  assert.ok(atFinalOpacity(now), "the outer glyphs did not jump to their final opacity");

  // And it stays there while the loop carries on.
  dom.frames(60);
  for (const draw of dom.ctx.draws.slice(before)) {
    assert.ok(atFinalOpacity(outerGlyphs(dom, draw)), "the fade resumed easing");
  }
});

test("the same holds when the canvas is paused mid-fade: it is repainted at final opacity and stays still", async (t) => {
  const { dom, host } = await startHero(t);
  dom.frames(14);
  host.set(mode({ motionOn: false })); // paused part-way through the fade
  assert.equal(atFinalOpacity(outerGlyphs(dom, dom.ctx.draws.at(-1))), false);
  const before = dom.ctx.draws.length;

  host.set(mode({ motionOn: false, reducedMotion: true }));

  assert.ok(dom.ctx.draws.length > before, "the paused canvas was not repainted");
  assert.ok(atFinalOpacity(outerGlyphs(dom, dom.ctx.draws.at(-1))));
  assert.equal(dom.pendingFrames(), 0, "reduced motion must not restart a paused loop");
});

test("without reduced motion the opening fade is left alone and finishes by itself", async (t) => {
  const { dom, host } = await startHero(t);
  dom.frames(14);
  const before = dom.ctx.draws.length;
  host.set(mode({ canHover: false })); // some other mode change mid-fade
  assert.equal(dom.ctx.draws.length, before, "an unrelated mode change repainted the canvas");
  assert.equal(atFinalOpacity(outerGlyphs(dom, dom.ctx.draws.at(-1))), false);
  dom.frames(240);
  assert.ok(atFinalOpacity(outerGlyphs(dom, dom.ctx.draws.at(-1))));
});

// ---- the cursor --------------------------------------------------------------------

const moveCursorIn = (dom) =>
  dom.hero.dispatch("pointermove", { pointerType: "mouse", clientX: 500, clientY: 500 });

test("the cursor makes hex digits appear around it", async (t) => {
  const { dom } = await startHero(t);
  dom.frames(120);
  assert.equal(hexOf(dom.ctx.draws.at(-1)).length, 0);
  moveCursorIn(dom);
  dom.frames(90);
  assert.ok(hexOf(dom.ctx.draws.at(-1)).length > 0, "the cursor had no effect");
});

for (const [name, disallowed] of [
  ["reduced motion", mode({ reducedMotion: true })],
  ["the toggle going off", mode({ motionOn: false })],
  ["a device that cannot hover", mode({ canHover: false })],
]) {
  test(`when reaction stops being allowed (${name}), no hex digit is drawn afterwards`, async (t) => {
    const { dom, host } = await startHero(t);
    dom.frames(120);
    moveCursorIn(dom);
    dom.frames(90);
    assert.ok(hexOf(dom.ctx.draws.at(-1)).length > 0, "the reaction never showed");
    const before = dom.ctx.draws.length;

    host.set(disallowed);
    dom.frames(240);

    const after = dom.ctx.draws.slice(before);
    assert.ok(after.length >= 1, "a paused canvas should be repainted once without the hex core");
    for (const draw of after) assert.equal(hexOf(draw).length, 0, "a hex digit was drawn");
  });
}

test("an ordinary pointer departure still eases out instead of vanishing", async (t) => {
  const { dom } = await startHero(t);
  dom.frames(120);
  moveCursorIn(dom);
  dom.frames(90);
  assert.ok(hexOf(dom.ctx.draws.at(-1)).length > 0);

  dom.hero.dispatch("pointerleave", {});
  dom.frames(2);
  assert.ok(
    hexOf(dom.ctx.draws.at(-1)).length > 0,
    "the hex core vanished the moment the pointer left",
  );
  dom.frames(300);
  assert.equal(hexOf(dom.ctx.draws.at(-1)).length, 0, "the hex core never faded out");
});

test("a touch pointer never starts a reaction", async (t) => {
  const { dom } = await startHero(t);
  dom.hero.dispatch("pointermove", { pointerType: "touch", clientX: 500, clientY: 500 });
  dom.frames(120);
  assert.equal(hexOf(dom.ctx.draws.at(-1)).length, 0);
});

// ---- the font -----------------------------------------------------------------------

test("the canvas follows the <pre>'s font size when it changes after start", async (t) => {
  const { dom } = await startHero(t); // 12.8px: 7.68px glyphs, 16px lines
  const { ctx } = dom;
  assert.match(ctx.font, /12\.8px/);
  const preRect = () => dom.pres[0].getBoundingClientRect();
  const onGrid = (draw, columnWidth, left) =>
    draw.every(
      (glyph) =>
        Math.abs((glyph.x - left) / columnWidth - Math.round((glyph.x - left) / columnWidth)) <
        1e-6,
    );
  assert.ok(onGrid(ctx.draws.at(-1), 7.68, preRect().left));

  dom.setFontPx(20); // the browser's text size changed: 12px glyphs, 25px lines
  dom.resize();

  assert.match(ctx.font, /20px/, "the canvas still uses the old font");
  const draw = ctx.draws.at(-1);
  assert.ok(draw.every((glyph) => glyph.font.includes("20px")));
  assert.ok(onGrid(draw, 12, preRect().left), "the glyphs are not on the new 12px grid");
  // Each row's baseline: rows are 25px apart, and the baseline sits 19px down (the 20px
  // font's ascent) in a 25px line whose half-leading is 0.
  for (const glyph of draw) {
    const row = (glyph.y - 19) / 25;
    assert.ok(Math.abs(row - Math.round(row)) < 1e-6, `glyph y ${glyph.y} is not on the new rows`);
  }
  assert.equal(
    dom.canvas.style.height,
    `${preRect().height}px`,
    "the canvas height did not follow",
  );
  assert.equal(dom.canvas.height, Math.round(preRect().height));
});

test("the canvas follows the data-theme attribute: the new accent is read and drawn at once", async (t) => {
  const { dom } = await startHero(t);
  const [observer] = dom.themeObservers;
  assert.ok(observer, "the hero does not watch the theme");
  assert.deepEqual(observer.targets, [dom.documentElement]);
  assert.deepEqual(observer.options, { attributes: true, attributeFilter: ["data-theme"] });
  assert.equal(dom.ctx.fillStyle, "#bb9af7");
  const drawn = dom.ctx.draws.length;
  dom.setTheme("#9854f1");
  assert.equal(dom.ctx.draws.length, drawn + 1, "the canvas was not repainted");
  assert.equal(dom.ctx.fillStyle, "#9854f1");
});

test("a paused canvas is repainted in the new theme too, and does not start running", async (t) => {
  const { dom, host } = await startHero(t);
  host.set(mode({ motionOn: false }));
  assert.equal(dom.pendingFrames(), 0);
  const drawn = dom.ctx.draws.length;
  dom.setTheme("#9854f1");
  assert.equal(dom.ctx.draws.length, drawn + 1);
  assert.equal(dom.ctx.fillStyle, "#9854f1");
  assert.equal(dom.pendingFrames(), 0);
});
