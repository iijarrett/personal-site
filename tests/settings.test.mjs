import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { initSettings } from "../src/scripts/settings.ts";
import { colour, contrast, themes } from "./helpers/contrast.mjs";
import { installSettingsDom } from "./helpers/fake-settings-dom.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const header = read("../src/components/Header.astro");
const footer = read("../src/components/Footer.astro");
const css = read("../src/styles/global.css");

// ---------- Markup ----------

test("the settings button is an icon only, with an accessible name and its state in aria-expanded", () => {
  const button = header.match(/<button\s+class="settings-btn"[\s\S]*?<\/button>/)?.[0];
  assert.ok(button, "Header.astro has no .settings-btn");
  assert.match(button, /type="button"/);
  assert.match(button, /aria-label="Display settings"/);
  assert.match(button, /aria-expanded="false"/);
  assert.match(button, /aria-controls="settings-panel"/);
  assert.match(button, /<svg[^>]*aria-hidden="true"/);
  const visibleText = button
    .replace(/<svg[\s\S]*?<\/svg>/, "")
    .replace(/<[^>]*>/g, "")
    .trim();
  assert.equal(visibleText, "", "the button has a visible text label");
});

test("the panel ships closed, and has a Theme group and a Motion group of two buttons each", () => {
  assert.match(header, /<div class="settings-panel" id="settings-panel" hidden>/);
  for (const [id, key, values] of [
    ["set-theme", "theme", ["dark", "light"]],
    ["set-motion", "motion", ["on", "off"]],
  ]) {
    assert.match(header, new RegExp(`role="group" aria-labelledby="${id}"`));
    assert.match(header, new RegExp(`id="${id}"`));
    const group = values.map((value) => {
      const pattern = new RegExp(
        `<button type="button" data-key="${key}" data-value="${value}" aria-pressed="(true|false)">`,
      );
      const found = header.match(pattern);
      assert.ok(found, `no ${key} ${value} button`);
      return found[1];
    });
    // The first of each pair is the default (dark, motion on) and is shown pressed.
    assert.deepEqual(group, ["true", "false"], key);
  }
});

test("the header has no inline style, image, data: URL, form or input", () => {
  for (const banned of [/\sstyle=/, /<img/, /data:/, /<form/, /<input/]) {
    assert.ok(!banned.test(header), `Header.astro matches ${banned}`);
  }
});

test("focus order is brand, nav, settings button, which on a phone is also the reading order", () => {
  const brand = header.indexOf('class="brand"');
  const nav = header.indexOf('class="site-nav"');
  const settings = header.indexOf('class="settings"');
  assert.ok(brand > 0 && brand < nav && nav < settings);
});

test("the footer toggle is gone, from the markup, the CSS and the script", () => {
  assert.ok(!/<button/.test(footer));
  assert.ok(!/Motion effects/.test(footer));
  assert.ok(!css.includes("motion-toggle"));
  assert.ok(!read("../src/scripts/motion-state.ts").includes("motion-toggle"));
});

// ---------- CSS ----------

const settingsCss = css.slice(
  css.indexOf("/* ---------- Settings menu ---------- */"),
  css.indexOf(".site-footer {"),
);

test("without JavaScript the menu is invisible, and so out of the tab order", () => {
  assert.match(settingsCss, /\.settings:not\(\.is-ready\)\s*\{\s*visibility: hidden;/);
});

test("the menu opens with no transition or animation, so reduced motion has nothing to turn off", () => {
  assert.ok(settingsCss.length > 500, "could not find the settings CSS");
  assert.ok(!/transition|animation/.test(settingsCss));
});

test("the panel sits flush under the button and never outgrows a phone", () => {
  const panel = settingsCss.match(/\.settings-panel\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(panel, /top: 100%/);
  assert.match(panel, /right: 0/);
  assert.match(panel, /max-width: calc\(100vw - 2rem\)/);
  assert.match(panel, /font-family: var\(--font-ui\)/);
});

test("on a phone the brand has its own row, and the settings button is pinned at the bottom right of the header", () => {
  const phone = css.match(/@media \(max-width: 36rem\)\s*\{([\s\S]*?)\n\}\n/)?.[1] ?? "";
  assert.match(phone, /\.brand\s*\{\s*flex-basis: 100%/);
  assert.match(phone, /\.site-nav\s*\{\s*flex: 1 1 0/);
  const settings = settingsCss.match(/\.settings\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(settings, /position: absolute/);
  assert.match(settings, /bottom: 0\.5rem/);
  assert.match(
    settings,
    /right: calc\(var\(--space-3\) \+ max\(0px, \(100% - var\(--page\)\) \/ 2\)\)/,
  );
});

// ---------- Contrast, in both themes ----------

for (const [name, block] of Object.entries(themes)) {
  const c = (token) => colour(block, token);

  test(`${name}: menu text is readable (4.5:1) on the panel and on a pressed segment`, () => {
    assert.ok(contrast(c("--text"), c("--surface")) >= 4.5, "--text on --surface");
    assert.ok(contrast(c("--muted"), c("--surface")) >= 4.5, "--muted on --surface (labels)");
    assert.ok(
      contrast(c("--on-accent"), c("--accent-text")) >= 4.5,
      "--on-accent on --accent-text",
    );
  });

  test(`${name}: the pressed segment stands out from its panel, and the icon from the header (3:1)`, () => {
    assert.ok(contrast(c("--accent-text"), c("--surface")) >= 3, "pressed fill on --surface");
    assert.ok(contrast(c("--muted"), c("--bg")) >= 3, "icon (--muted) on --bg");
    assert.ok(contrast(c("--text"), c("--bg")) >= 3, "hovered icon (--text) on --bg");
  });

  test(`${name}: the focus ring is visible on the panel and on a pressed segment's surroundings (3:1)`, () => {
    assert.ok(contrast(c("--ring"), c("--surface")) >= 3, "--ring on --surface");
    assert.ok(contrast(c("--ring"), c("--bg")) >= 3, "--ring on --bg");
  });
}

test("global.css draws the menu with exactly the tokens measured above", () => {
  assert.match(
    settingsCss,
    /\.seg button\[aria-pressed="true"\]\s*\{\s*background: var\(--accent-text\);\s*color: var\(--on-accent\);/,
  );
  assert.match(settingsCss, /\.settings-btn\s*\{[^}]*color: var\(--muted\)/);
  assert.match(settingsCss, /\.settings-panel\s*\{[^}]*background: var\(--surface\)/);
  assert.match(settingsCss, /\.seg button\s*\{[^}]*color: var\(--text\)/);
});

// ---------- Behaviour, against a fake DOM ----------

/** The menu running in a fake DOM, with the fake restored when the test ends. */
function start(t, options) {
  const dom = installSettingsDom(options);
  t.after(() => dom.restore());
  initSettings(dom.motion);
  return dom;
}

test("it appears once the script has run, closed, with the current choices pressed", (t) => {
  const dom = start(t);
  assert.ok(dom.box.classList.contains("is-ready"));
  assert.equal(dom.open, false);
  assert.equal(dom.expanded, "false");
  assert.deepEqual(dom.pressed(), { dark: "true", light: "false", on: "true", off: "false" });
});

test("a saved light theme and motion off are shown as the pressed choices", (t) => {
  const dom = installSettingsDom({ theme: "light" });
  t.after(() => dom.restore());
  dom.motion.set(false);
  initSettings(dom.motion);
  assert.deepEqual(dom.pressed(), { dark: "false", light: "true", on: "false", off: "true" });
});

test("without the markup it does nothing and does not throw", (t) => {
  const dom = installSettingsDom();
  t.after(() => dom.restore());
  dom.document.querySelector = () => null;
  assert.doesNotThrow(() => initSettings(dom.motion));
});

test("a mouse hovering opens it and leaving closes it; touch and pen do not hover", (t) => {
  const dom = start(t);
  dom.pointerEnter();
  assert.equal(dom.open, true);
  assert.equal(dom.expanded, "true");
  dom.pointerLeave();
  assert.equal(dom.open, false);
  for (const type of ["touch", "pen"]) {
    dom.pointerEnter(type);
    assert.equal(dom.open, false, `${type} opened it by hover`);
  }
});

test("the pointer can move from the button into the panel without closing it", (t) => {
  const dom = start(t);
  dom.pointerEnter();
  // The panel is inside the same box, so crossing into it fires no pointerleave on the box.
  dom.click(dom.choices.light);
  assert.equal(dom.open, true);
});

test("keyboard focus on the button opens it; a mouse press focusing it does not", (t) => {
  const dom = start(t);
  dom.focusTo(dom.button, false);
  assert.equal(dom.open, false, "pointer focus opened it");
  dom.focusTo(dom.outside, false);
  dom.focusTo(dom.button, true);
  assert.equal(dom.open, true);
  assert.equal(dom.expanded, "true");
});

test("tabbing from the button into the panel keeps it open; tabbing out of it closes it", (t) => {
  const dom = start(t);
  dom.focusTo(dom.button, true);
  dom.focusTo(dom.choices.dark, true);
  assert.equal(dom.open, true);
  dom.focusTo(dom.choices.off, true);
  assert.equal(dom.open, true);
  dom.focusTo(dom.outside, true);
  assert.equal(dom.open, false);
  assert.equal(dom.expanded, "false");
});

test("a tap or click opens it and keeps it open when the pointer leaves; a second click closes it", (t) => {
  const dom = start(t);
  dom.click(dom.button);
  assert.equal(dom.open, true);
  dom.pointerLeave();
  assert.equal(dom.open, true, "leaving closed a menu that was clicked open");
  dom.click(dom.button);
  assert.equal(dom.open, false);
});

test("clicking a menu that hover opened pins it open", (t) => {
  const dom = start(t);
  dom.pointerEnter();
  dom.click(dom.button);
  dom.pointerLeave();
  assert.equal(dom.open, true);
});

test("Enter and Space on the button are clicks, so they open it too", (t) => {
  const dom = start(t);
  // A browser turns Enter or Space on a focused button into a click; the page needs no key handler.
  dom.click(dom.button);
  assert.equal(dom.expanded, "true");
});

test("Escape closes it from the button, and from inside the panel where it puts focus back", (t) => {
  const dom = start(t);
  dom.focusTo(dom.button, true);
  dom.key("Escape");
  assert.equal(dom.open, false);
  assert.equal(dom.document.activeElement, dom.button);

  dom.click(dom.button);
  dom.focusTo(dom.choices.light, true);
  assert.equal(dom.open, true);
  dom.key("Escape");
  assert.equal(dom.open, false);
  assert.equal(dom.expanded, "false");
  assert.equal(dom.document.activeElement, dom.button, "focus was not returned to the button");
});

test("putting focus back on the button after Escape does not reopen the menu", (t) => {
  const dom = start(t);
  dom.focusTo(dom.button, true);
  dom.focusTo(dom.choices.dark, true);
  dom.key("Escape");
  assert.equal(dom.open, false);
});

test("other keys do nothing, and Escape on a closed menu does nothing", (t) => {
  const dom = start(t);
  dom.key("Escape");
  assert.equal(dom.open, false);
  dom.click(dom.button);
  dom.key("a");
  dom.key("Enter");
  assert.equal(dom.open, true);
});

test("pressing anywhere outside closes it, and pressing inside does not", (t) => {
  const dom = start(t);
  dom.click(dom.button);
  dom.pointerDown(dom.choices.light);
  dom.pointerDown(dom.button);
  assert.equal(dom.open, true);
  dom.pointerDown(dom.outside);
  assert.equal(dom.open, false);
});

test("a press on the panel is not allowed to move focus away from it", (t) => {
  const dom = start(t);
  assert.equal(dom.mouseDown(dom.choices.dark).defaultPrevented, true);
});

test("choosing Light sets the theme, the theme-color meta, the saved choice and the pressed state", (t) => {
  const dom = start(t);
  dom.click(dom.button);
  dom.click(dom.choices.light);
  assert.equal(dom.root.dataset.theme, "light");
  assert.equal(dom.meta.getAttribute("content"), "#e1e2e7");
  assert.equal(dom.stored.get("theme"), "light");
  assert.deepEqual(dom.pressed(), { dark: "false", light: "true", on: "true", off: "false" });
  assert.equal(dom.open, true, "choosing closed the menu");

  dom.click(dom.choices.dark);
  assert.equal(dom.root.dataset.theme, "dark");
  assert.equal(dom.meta.getAttribute("content"), "#16161e");
  assert.equal(dom.stored.get("theme"), "dark");
  assert.deepEqual(dom.pressed(), { dark: "true", light: "false", on: "true", off: "false" });
});

test("choosing Motion off or on goes through the motion switch and updates the pressed state", (t) => {
  const dom = start(t);
  dom.click(dom.button);
  dom.click(dom.choices.off);
  assert.deepEqual(dom.motionCalls, [false]);
  assert.deepEqual(dom.pressed(), { dark: "true", light: "false", on: "false", off: "true" });
  dom.click(dom.choices.on);
  assert.deepEqual(dom.motionCalls, [false, true]);
  assert.deepEqual(dom.pressed(), { dark: "true", light: "false", on: "true", off: "false" });
});

test("blocked storage does not stop the theme changing for this visit, and does not throw", (t) => {
  const dom = start(t, { storage: "blocked" });
  dom.click(dom.button);
  assert.doesNotThrow(() => dom.click(dom.choices.light));
  assert.equal(dom.root.dataset.theme, "light");
  assert.equal(dom.stored.size, 0);
});

test("a click that is not on a choice changes nothing", (t) => {
  const dom = start(t);
  dom.click(dom.button);
  dom.click(dom.panel);
  assert.equal(dom.root.dataset.theme, undefined);
  assert.deepEqual(dom.motionCalls, []);
});

// ---------- Hover, focus and pin are independent (cases from review) ----------

test("(a) hover-opened, then keyboard focus enters the last option: the pointer leaving keeps it open and focus where it is", (t) => {
  const dom = start(t);
  dom.focusTo(dom.outside, true);
  dom.pointerEnter();
  assert.equal(dom.open, true);
  dom.focusTo(dom.choices.off, true); // Shift+Tab from the page into the last option
  dom.pointerLeave();
  assert.equal(dom.open, true, "the panel was hidden while focus was inside it");
  assert.equal(dom.expanded, "true");
  assert.equal(dom.document.activeElement, dom.choices.off, "focus was lost");
  // Focus leaving is what finally closes it.
  dom.focusTo(dom.outside, true);
  assert.equal(dom.open, false);
});

test("(b) hovering over the menu, then Tabbing out: it stays open until the pointer leaves", (t) => {
  const dom = start(t);
  dom.pointerEnter();
  dom.focusTo(dom.button, true);
  dom.focusTo(dom.outside, true); // Tab out
  assert.equal(dom.open, true, "it closed with the pointer still over it");
  dom.pointerLeave();
  assert.equal(dom.open, false);
});

test("hover then leave with no focus closes it", (t) => {
  const dom = start(t);
  dom.pointerEnter();
  assert.equal(dom.open, true);
  dom.pointerLeave();
  assert.equal(dom.open, false);
  assert.equal(dom.expanded, "false");
});

test("Tab in then Tab out with no hover closes it", (t) => {
  const dom = start(t);
  dom.focusTo(dom.button, true);
  assert.equal(dom.open, true);
  dom.focusTo(dom.choices.dark, true);
  dom.focusTo(dom.outside, true);
  assert.equal(dom.open, false);
});

test("a click pin survives the pointer leaving", (t) => {
  const dom = start(t);
  dom.pointerEnter();
  dom.click(dom.button);
  dom.pointerLeave();
  assert.equal(dom.open, true);
  assert.equal(dom.expanded, "true");
});

test("Escape while hovered closes it and it stays closed until the pointer re-enters", (t) => {
  const dom = start(t);
  dom.pointerEnter();
  dom.key("Escape");
  assert.equal(dom.open, false);
  assert.equal(dom.expanded, "false");
  dom.pointerLeave();
  assert.equal(dom.open, false);
  dom.pointerEnter();
  assert.equal(dom.open, true);
});

test("Escape from an option while hovered closes it, returns focus to the button and does not reopen it", (t) => {
  const dom = start(t);
  dom.focusTo(dom.outside, true);
  dom.pointerEnter();
  dom.focusTo(dom.choices.off, true);
  dom.key("Escape");
  assert.equal(dom.open, false);
  assert.equal(dom.document.activeElement, dom.button);
  // The pointer is still over it and focus is on the button, but both are dismissed.
  assert.equal(dom.expanded, "false");
  dom.pointerLeave();
  dom.pointerEnter();
  assert.equal(dom.open, true, "a fresh hover did not reopen it");
});

test("a second click on the button closes a pinned menu even while the pointer is over it", (t) => {
  const dom = start(t);
  dom.pointerEnter();
  dom.click(dom.button);
  dom.click(dom.button);
  assert.equal(dom.open, false);
  dom.pointerLeave();
  dom.pointerEnter();
  assert.equal(dom.open, true);
});

test("touch: a tap opens it, nothing else changes it, and a tap outside closes it", (t) => {
  const dom = start(t);
  dom.pointerEnter("touch"); // the pointer events that come with a tap are ignored
  assert.equal(dom.open, false);
  dom.click(dom.button);
  assert.equal(dom.open, true);
  dom.pointerLeave("touch");
  assert.equal(dom.open, true);
  dom.pointerDown(dom.outside);
  assert.equal(dom.open, false);
  assert.equal(dom.expanded, "false");
});
