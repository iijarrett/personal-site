/**
 * Draws the face on the Me page and the JD mark on the Contact page. Each is a canvas of code
 * symbols that resolves into the picture once, then holds it with a quiet shimmer. It follows the
 * hero's rule for ambient motion, which is the footer strip's rule too: the Motion switch alone
 * decides, so the picture moves wherever the hero does, whatever the device's reduced-motion
 * setting says. With the switch off it shows the finished picture once, still. It also stops while
 * off screen or in a hidden tab. Decoration only: hidden from assistive
 * technology, and it listens for no input.
 *
 * This is its own script, loaded by the pages that carry a picture. It shares nothing with the
 * main script (check:dist refuses a script that imports another file), so it reads the Motion
 * choice itself. ../lib/portrait.ts holds the rules and is imported by this file alone.
 */

import {
  ALPHAS,
  alphaStep,
  type Glyph,
  glyphAt,
  makeShape,
  type Shape,
  STILL,
  stepAlpha,
  TONES,
  type Tone,
  tones,
} from "../lib/portrait.ts";

const FPS = 30;
const MAX_DT = 0.1; // a returning tab does not jump
const CELL_H = 12; // the art is sampled for a 9 px symbol in a 12 px tall cell
const SYMBOL_H = 9;
const HIGHLIGHT = { dark: "#efe6ff", light: "#2b1166" };

const root = document.documentElement;

/** The Motion switch alone: what the hero and the footer strip follow. */
function motionAllowed(): boolean {
  try {
    // "motion" is the key the settings menu stores its choice under.
    return localStorage.getItem("motion") !== "off";
  } catch {
    return true;
  }
}

function mount(host: HTMLElement): void {
  const cols = Number(host.dataset.cols);
  const rows = Number(host.dataset.rows);
  const cells = host.dataset.cells ?? "";
  const kind: Tone = host.dataset.tone === "mark" ? "mark" : "photo";
  if (!(cols > 0 && rows > 0) || cells.length !== cols * rows || host.firstChild) return;
  const shape: Shape = makeShape(cols, rows, kind, cells);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const gfx = ctx;
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);

  const buckets: number[][] = Array.from({ length: TONES * ALPHAS }, () => []);
  const glyph: Glyph = { ch: "", alpha: 0, tone: 0 };
  const symbols: string[] = new Array(cols * rows).fill("");
  let colours: string[] = [];
  let t = STILL;
  let on = motionAllowed();
  let seen = false;
  let raf = 0;
  let last = 0;
  let due = 0;

  const paint = (): void => {
    const style = getComputedStyle(root);
    const high = root.dataset.theme === "light" ? HIGHLIGHT.light : HIGHLIGHT.dark;
    colours = tones(style.getPropertyValue("--accent").trim(), high);
  };

  const draw = (): void => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const cw = w / cols;
    const ch = h / rows;
    gfx.clearRect(0, 0, w, h);
    for (const bucket of buckets) bucket.length = 0;
    const still = !on;
    for (let i = 0; i < cols * rows; i++) {
      if (!glyphAt(shape, i, t, still, glyph)) continue;
      symbols[i] = glyph.ch;
      buckets[glyph.tone * ALPHAS + alphaStep(glyph.alpha)]?.push(i);
    }
    gfx.font = `${(ch / CELL_H) * SYMBOL_H}px ${getComputedStyle(canvas).fontFamily || "monospace"}`;
    gfx.textBaseline = "alphabetic";
    buckets.forEach((bucket, k) => {
      if (!bucket.length) return;
      gfx.globalAlpha = stepAlpha(k % ALPHAS);
      gfx.fillStyle = colours[Math.floor(k / ALPHAS)] ?? "";
      for (const i of bucket) {
        const x = (i % cols) * cw;
        const y = (Math.floor(i / cols) + 1) * ch - ch * 0.22;
        gfx.fillText(symbols[i] ?? "", x, y);
      }
    });
    gfx.globalAlpha = 1;
  };

  const fit = (): void => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const s = Math.min(2, Math.max(1, Math.round(devicePixelRatio || 1)));
    canvas.width = w * s;
    canvas.height = h * s;
    gfx.setTransform(s, 0, 0, s, 0, 0);
    draw();
  };

  const frame = (now: number): void => {
    raf = 0;
    if (!on || !seen || document.hidden) return;
    if (now >= due - 1) {
      const interval = 1000 / FPS;
      due = due + interval <= now ? now + interval : due + interval;
      t += Math.max(0, Math.min(MAX_DT, (now - last) / 1000));
      last = now;
      draw();
    }
    raf = requestAnimationFrame(frame);
  };

  // Runs the loop exactly while all three conditions hold, and never twice.
  const sync = (): void => {
    const go = on && seen && !document.hidden;
    if (go && !raf) {
      last = performance.now();
      due = last;
      raf = requestAnimationFrame(frame);
    } else if (!go && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  // The picture starts from nothing each time it is allowed to move, and rests when it is not.
  const setMotion = (allowed: boolean): void => {
    if (allowed === on) return;
    on = allowed;
    t = on ? 0 : STILL;
    draw();
    sync();
  };

  addEventListener("resize", fit);
  document.addEventListener("visibilitychange", sync);
  new MutationObserver(() => {
    paint();
    draw();
  }).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
  // The settings menu marks the chosen Motion button when the visitor picks one, so watching it
  // follows the switch itself (the page's no-fx class also folds in reduced motion and the pointer).
  const pick = (): void => {
    const pressed = document.querySelector('button[data-key="motion"][aria-pressed="true"]');
    if (pressed instanceof HTMLElement) setMotion(pressed.dataset.value !== "off");
  };
  const watch = new MutationObserver(pick);
  for (const button of document.querySelectorAll('button[data-key="motion"]'))
    watch.observe(button, { attributes: true, attributeFilter: ["aria-pressed"] });
  if (typeof IntersectionObserver === "undefined") {
    seen = true;
  } else {
    new IntersectionObserver((entries) => {
      seen = !!entries.at(-1)?.isIntersecting;
      sync();
    }).observe(canvas);
  }

  paint();
  t = on ? 0 : STILL;
  const ready = (): void => {
    fit();
    sync();
  };
  // The symbols want the mono font; draw once it is there, or at once if it cannot be waited for.
  if (document.fonts?.load) {
    document.fonts.load(`${SYMBOL_H}px "JetBrains Mono"`, "01@").then(ready, ready).catch(ready);
  } else {
    ready();
  }
}

for (const host of document.querySelectorAll<HTMLElement>("[data-portrait]")) mount(host);
