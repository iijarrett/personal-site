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
 * From then on arrows or A and D move, and so does a finger sliding on the canvas or a mouse
 * dragging with its button down (a mouse merely passing over does not), and keys are taken while
 * the canvas is on screen. Escape, Tab, or scrolling away puts it back to idle.
 * It never runs while the canvas is off screen or the tab is hidden.
 */

import { ACCENT_VARS, ACCENTS, accentValues, HOME_NAME, nextAccent } from "../lib/accents.ts";
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
// What the box lists depends on the device: a keyboard and mouse, or a finger.
const KEYS = ["← → or A D, or click and drag, to move", "esc to stop"];
const TOUCH = ["slide to move"];
const HELP = "← → or A D, or drag, to move · esc to stop"; // read aloud only

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
  // Read aloud only: what the keys are, and the score. The controls are drawn inside the box.
  help.className = "sr-only";
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
  // A finger as the main pointer: the box then says tap and drag, and lists no keys.
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  let ink = "";
  let tint = "";
  let dim = "";
  let shade = -1; // the accent the whole page wears: -1 is the home purple, else an ACCENTS index
  let wave = 1; // the wave the game was last seen on, to spot a cleared one
  let unlocked = ""; // the colour just won, shown until the next launch

  const colours = (): void => {
    const style = getComputedStyle(root);
    // The text accent where the theme has one (it is the darker purple on the light theme).
    tint =
      style.getPropertyValue("--accent-text").trim() || style.getPropertyValue("--accent").trim();
    ink = style.getPropertyValue("--text").trim();
    dim = style.getPropertyValue("--muted").trim();
  };

  /**
   * Dress the page in the current accent: the tokens go on <html> as inline values (home purple
   * takes them off again), for the theme that is showing. data-accent changes with every repaint,
   * which is what tells the hero, the strip and the pictures to read their colour again.
   */
  const paintAccent = (): void => {
    const a = ACCENTS[shade];
    const light = root.dataset.theme === "light";
    ACCENT_VARS.forEach((name, k) => {
      const v = a ? accentValues(a, light)[k] : undefined;
      if (v) root.style.setProperty(name, v);
      else root.style.removeProperty(name);
    });
    if (a) root.dataset.accent = `${a.name.toLowerCase()}-${light ? "l" : "d"}`;
    else delete root.dataset.accent;
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
    const go = touch ? "tap" : "click or press space";
    const note = !active
      ? `${go} to play`
      : g.mode === "over"
        ? "game over"
        : g.mode === "ready"
          ? go
          : "";
    gfx.fillText(note, W / 2, 80);
    if (unlocked && g.mode === "ready") {
      gfx.fillStyle = tint;
      gfx.fillText(`color unlocked: ${unlocked}`, W / 2, 68);
      gfx.fillStyle = dim;
    }
    if (!active) {
      // The controls, in the box and only until the first start, so they never sit in the way:
      // one short line each, with room around them.
      gfx.font = `7px ${font}`;
      for (const [k, line] of (touch ? TOUCH : KEYS).entries())
        gfx.fillText(line, W / 2, 97 + k * 12);
      gfx.font = `9px ${font}`;
    }
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
    wave = 1;
    unlocked = "";
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
    if (g.wave !== wave) {
      // The last brick went: the whole page moves on to the next colour.
      wave = g.wave;
      shade = nextAccent(shade);
      unlocked = ACCENTS[shade]?.name ?? HOME_NAME;
      paintAccent();
      colours();
      say(`wave cleared · color unlocked: ${unlocked}`);
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
    unlocked = "";
    if (g.mode !== "over") launch(g);
    else if (performance.now() - over >= 600) {
      // the pause stops a mashed key from skipping the score
      g = newGame();
      wave = 1;
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
    paintAccent(); // the other theme wants the other values of the same colour
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
  // launches at once and dragging steers. A mouse only steers with its button down, so a cursor
  // wandering across the box while the keys are in use never grabs the paddle.
  canvas.addEventListener("click", (e) => {
    const skip = active || quiet; // quiet: Escape came in the middle of this press
    quiet = false;
    if (skip) return;
    begin();
    at(e);
    go();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" && !pressed) return;
    at(e);
  });
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
