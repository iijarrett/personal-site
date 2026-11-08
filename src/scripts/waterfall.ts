/**
 * The falling-symbols strip along the bottom of the footer, built by the lazy chunk (arcade.ts
 * calls this) so it is never part of the first load. One canvas, about 30 frames a second, and
 * only while it is on screen, the tab is visible and the Motion switch is on. It follows the
 * hero's rule for ambient motion: the switch decides, the device's reduced-motion setting does
 * not. With the switch off it shows one still frame and never runs. It is decoration: hidden
 * from assistive technology, and it listens for no input at all.
 *
 * ../lib/waterfall.ts holds the rules and may be imported by this file alone, so the bundler folds
 * it into the chunk (check:dist refuses a chunk that imports anything).
 */

import { ALPHA, levelAt, PITCH, RAMP, type Streak, streaks } from "../lib/waterfall.ts";
import type { ArcadeEnv } from "./lazy.ts";

const FPS = 30;
const STILL = 6; // seconds into the pattern that the still frame shows
const MAX_DT = 0.1; // a returning tab does not jump

export function initWaterfall(env: ArcadeEnv): void {
  const mount = env.footer.querySelector<HTMLElement>(".waterfall");
  if (!mount || mount.firstChild) return;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const gfx = ctx;
  canvas.setAttribute("aria-hidden", "true");
  mount.append(canvas);

  const root = document.documentElement;
  const font = getComputedStyle(canvas).fontFamily || "monospace";
  let tint = "";
  let cols: Streak[][] = [];
  let rows = 0;
  let t = STILL;
  let on = false; // motion is allowed
  let seen = false; // the strip is on screen
  let raf = 0;
  let last = 0;
  let due = 0;

  const colours = (): void => {
    const style = getComputedStyle(root);
    tint =
      style.getPropertyValue("--accent-text").trim() || style.getPropertyValue("--accent").trim();
  };

  const draw = (): void => {
    const w = canvas.clientWidth;
    gfx.clearRect(0, 0, w, rows * PITCH);
    gfx.fillStyle = tint;
    gfx.font = `12px ${font}`;
    gfx.textAlign = "center";
    gfx.textBaseline = "middle";
    let shown = -1;
    cols.forEach((column, c) => {
      for (let r = 0; r < rows; r++) {
        const level = levelAt(column, r, t);
        if (!level) continue;
        if (level !== shown) gfx.globalAlpha = ALPHA[level] ?? 0;
        shown = level;
        gfx.fillText(RAMP.charAt(level), c * PITCH + PITCH / 2, r * PITCH + PITCH / 2);
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
    rows = Math.ceil(h / PITCH);
    cols = Array.from({ length: Math.ceil(w / PITCH) }, (_, c) => streaks(c, rows));
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

  addEventListener("resize", fit);
  document.addEventListener("visibilitychange", sync);
  new MutationObserver(() => {
    colours();
    draw();
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  new IntersectionObserver((entries) => {
    seen = !!entries.at(-1)?.isIntersecting;
    sync();
  }).observe(canvas);

  colours();
  fit();
  // Calls back at once, then whenever the Motion switch changes.
  env.subscribe((mode) => {
    on = mode.ambient;
    if (!on) {
      t = STILL;
      draw();
    }
    sync();
  });
}
