/**
 * The footer brick breaker, in the spirit of the browser's offline dinosaur: it sits idle in the
 * footer, one press starts it, and the only saved thing is the best score, kept on this device in
 * localStorage. It is a separate file that lazy.ts requests only after a real visitor has the
 * footer in reach, so it is never part of the first load. The build check lets this file export
 * but never import, so ../lib/brick.ts must be used by this file alone (the bundler then folds it
 * in) and nothing else may be shared with the page script.
 *
 * Idle, it draws once and does nothing else: the page scrolls as normal, and only the focused
 * canvas answers keys. A tap, a click, or space, Enter, up or W on the focused canvas starts it.
 * From then on arrows or A and D move, a finger or mouse over the canvas moves the paddle, and keys
 * are taken while the canvas is on screen. Escape, Tab, or scrolling away puts it back to idle.
 * It never runs while the canvas is off screen or the tab is hidden.
 */

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
  PH,
  PW,
  PY,
  R,
  step,
  W,
} from "../lib/brick.ts";
import type { ArcadeEnv } from "./lazy.ts";
import { initWaterfall } from "./waterfall.ts";

const BEST = "jd-brick-best";
const LEFT = ["ArrowLeft", "a", "A"];
const RIGHT = ["ArrowRight", "d", "D"];
const GO = [" ", "Enter", "ArrowUp", "w", "W"];
const OTHER = "a,button,input,select,summary,textarea,[contenteditable]";
const HELP = "← → or A D, or drag, to move · esc to stop";

/** What the lazy loader calls: the footer game, then the falling-symbols strip below it. */
export function initArcade(env: ArcadeEnv): void {
  initGame(env);
  initWaterfall(env);
}

function initGame(env: ArcadeEnv): void {
  const mount = env.footer.querySelector<HTMLElement>(".arcade");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!mount || mount.firstChild || !ctx) return;
  const gfx = ctx;

  const help = document.createElement("p");
  help.className = "label";
  help.setAttribute("role", "status");
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Brick breaker. Press space or tap to play.");
  mount.append(canvas, help);

  const root = document.documentElement;
  let g = newGame();
  let best = 0;
  try {
    // Only a plain whole number counts; anything else someone left there is ignored.
    const saved = localStorage.getItem(BEST) ?? "";
    best = /^\d{1,9}$/.test(saved) ? Number(saved) : 0;
  } catch {}
  const held = [false, false];
  let pressed = false; // a pointer is down on the canvas
  let quiet = false; // that press was cut short by a reset, so its click must not restart the game
  let active = false; // the visitor has started it
  let seen = false; // the canvas is on screen
  let over = 0; // when the game ended (ms), or 0
  let raf = 0;
  let last = 0;
  let acc = 0;
  const font = getComputedStyle(canvas).fontFamily || "monospace";
  let ink = "";
  let tint = "";
  let dim = "";

  const colours = (): void => {
    const style = getComputedStyle(root);
    // The text accent where the theme has one (it is the darker purple on the light theme).
    tint =
      style.getPropertyValue("--accent-text").trim() || style.getPropertyValue("--accent").trim();
    ink = style.getPropertyValue("--text").trim();
    dim = style.getPropertyValue("--muted").trim();
  };

  function draw(): void {
    gfx.clearRect(0, 0, W, H);
    gfx.textBaseline = "middle";
    gfx.textAlign = "center";
    gfx.font = `11px ${font}`;
    gfx.fillStyle = tint;
    g.bricks.forEach((alive, i) => {
      if (!alive) return;
      // Rows differ by glyph, not by fading, so every brick keeps the full text contrast.
      const row = Math.floor(i / COLS);
      gfx.fillText(("@#X+"[row] ?? "+").repeat(4), brickX(i) + BW / 2, brickY(i) + BH / 2);
    });
    gfx.fillStyle = ink;
    gfx.fillRect(g.px - PW / 2, PY, PW, PH);
    gfx.fillRect(g.bx - R, g.by - R, 2 * R, 2 * R);
    gfx.fillStyle = dim;
    gfx.font = `9px ${font}`;
    const note = !active
      ? "tap or press space to play"
      : g.mode === "over"
        ? "game over"
        : g.mode === "ready"
          ? "tap or press space"
          : "";
    gfx.fillText(note, W / 2, 100);
    for (let k = 0; k < g.lives; k++) gfx.fillRect(4 + k * 7, 4, 4, 4);
    gfx.textAlign = "right";
    gfx.fillText(`${best ? `HI ${best}  ` : ""}${g.score}`, W - 4, 7);
  }
  const fit = (): void => {
    const s = Math.max(1, Math.round((canvas.clientWidth / W) * (devicePixelRatio || 1)));
    canvas.width = W * s;
    canvas.height = H * s;
    gfx.setTransform(s, 0, 0, s, 0, 0);
    draw();
  };
  const say = (text: string): void => {
    help.textContent = text;
  };
  const stop = (): void => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  /** Back to idle: a fresh game, nothing running, keys and touch released. */
  const reset = (): void => {
    stop();
    g = newGame();
    over = 0;
    active = false;
    held[0] = held[1] = false;
    if (pressed) quiet = true;
    mount.classList.remove("live");
    say(HELP);
    draw();
  };

  const frame = (t: number): void => {
    raf = 0;
    acc += Math.max(0, Math.min(0.05, (t - last) / 1000));
    last = t;
    const dir = (held[1] ? 1 : 0) - (held[0] ? 1 : 0);
    while (acc >= DT) {
      step(g, DT, dir);
      acc -= DT;
    }
    if (g.mode === "over" && !over) {
      over = performance.now();
      if (g.score > best) {
        best = g.score;
        try {
          localStorage.setItem(BEST, String(best));
        } catch {}
      }
      say(`game over · score ${g.score} · best ${best}`);
    }
    draw();
    if (g.mode === "play" || dir) raf = requestAnimationFrame(frame);
  };
  const kick = (): void => {
    if (raf || !active || !seen || document.hidden) return;
    last = performance.now();
    acc = 0;
    raf = requestAnimationFrame(frame);
  };
  const begin = (): void => {
    active = true;
    mount.classList.add("live");
  };
  /** One press: start, launch the ball, or play again. */
  const go = (): void => {
    begin();
    if (g.mode !== "over") launch(g);
    else if (performance.now() - over >= 600) {
      // the pause stops a mashed key from skipping the score
      g = newGame();
      over = 0;
      say(HELP);
    }
    draw();
    kick();
  };

  const onDown = (e: KeyboardEvent): void => {
    if (!seen || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === "Escape" || k === "Tab") {
      if (active) reset();
      return;
    }
    // Idle, only the focused canvas answers, so space and the arrows still scroll the page.
    if (!active && e.target !== canvas) return;
    // Playing, a key typed into, or pressed on, any other control belongs to that control.
    if (e.target !== canvas && (e.target as Element | null)?.closest?.(OTHER)) return;
    if (GO.includes(k)) {
      if (!e.repeat) go();
    } else if (!active) {
      return;
    } else if (LEFT.includes(k)) {
      held[0] = true;
    } else if (RIGHT.includes(k)) {
      held[1] = true;
    } else {
      return;
    }
    e.preventDefault();
    kick();
  };
  const onUp = (e: KeyboardEvent): void => {
    if (LEFT.includes(e.key)) held[0] = false;
    if (RIGHT.includes(e.key)) held[1] = false;
  };
  const at = (e: MouseEvent): void => {
    if (!active) return;
    const box = canvas.getBoundingClientRect();
    aim(g, ((e.clientX - box.left) / box.width) * W);
    kick();
  };

  addEventListener("keydown", onDown);
  addEventListener("keyup", onUp);
  addEventListener("resize", fit);
  // A key released while the window was elsewhere never reaches us, so let go of both directions.
  const release = (): void => {
    held[0] = held[1] = false;
  };
  addEventListener("blur", release);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      release();
      stop();
    } else kick();
  });
  new MutationObserver(() => {
    colours();
    draw();
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  // Scrolling the canvas fully out of view puts the game back to idle.
  new IntersectionObserver((entries) => {
    seen = !!entries.at(-1)?.isIntersecting;
    if (seen) kick();
    else reset();
  }).observe(canvas);
  // A click (a tap or a mouse click, never the start of a scroll) starts it; after that a press
  // launches at once and moving over the canvas steers.
  canvas.addEventListener("click", (e) => {
    const skip = active || quiet; // quiet: Escape came in the middle of this press
    quiet = false;
    if (skip) return;
    begin();
    at(e);
    go();
  });
  canvas.addEventListener("pointermove", at);
  const lift = (): void => {
    pressed = false;
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);
  canvas.addEventListener("pointerdown", (e) => {
    quiet = false; // a new press starts clean
    if (e.button || !active) return;
    pressed = true;
    canvas.setPointerCapture(e.pointerId);
    at(e);
    go();
  });

  colours();
  say(HELP);
  fit();
}
