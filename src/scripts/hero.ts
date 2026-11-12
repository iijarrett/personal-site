/**
 * The hero canvas: the shared ASCII field (src/lib/ascii-field.ts) drawn live over
 * the static <pre>. It copies the <pre>'s font, cell size, height and position, and
 * starts at t = 0 with the outer columns (beyond the static frame's 100) at zero
 * opacity and the frame's soft edge applied, so its first frame is the static frame
 * and the swap is invisible. The outer columns then fade in. Starts after first
 * paint. Off-screen and hidden tabs pause it, and so does the Motion switch in the settings menu: that
 * cancels the pending frame at once and leaves the canvas showing the frame it
 * stopped on, with no swap back to the static frame. Turning it on again resumes
 * from that frame.
 */

import {
  ALPHA,
  ambient,
  CELL_H,
  CELL_W,
  columnAlpha,
  columnRange,
  FRAME,
  HEX_ALPHA,
  hexChar,
  inHexCore,
  levelOf,
  pointerBoost,
  pointerDistance,
  RAMP,
  textBaseline,
} from "../lib/ascii-field.ts";
import {
  easeToward,
  frameDelta,
  frameDue,
  type MotionMode,
  nextDeadline,
  targetFps,
} from "../lib/motion.ts";

const HEX_LEVEL = 255;
const HEX_BIT = 1 << RAMP.length;
const POINTER_TAU = 0.12; // seconds for the smoothed cursor to follow the real one
const STRENGTH_TAU = 0.235; // seconds for the reaction to fade in and out
const EDGE_TAU = 0.22; // seconds for the outer columns to fade in and out
const EDGE_DONE = 0.004; // within this of its target the fade counts as finished

type Subscribe = (listener: (mode: MotionMode) => void) => void;

function afterFirstPaint(task: () => void): void {
  const schedule = (): void => {
    if (window.requestIdleCallback) window.requestIdleCallback(task, { timeout: 1500 });
    else setTimeout(task, 200);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}

/** The <pre>'s font as a canvas font string, read fresh each time it is needed. */
function fontOf(pre: HTMLElement): string {
  const style = getComputedStyle(pre);
  return `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

async function start(
  hero: HTMLElement,
  stack: HTMLElement,
  pre: HTMLElement,
  subscribe: Subscribe,
): Promise<void> {
  try {
    await document.fonts.load(fontOf(pre), "M");
  } catch {
    // Fall back to whatever font the <pre> is using.
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.className = "field";
  canvas.setAttribute("aria-hidden", "true");
  canvas.hidden = true;
  stack.after(canvas);

  let mode: MotionMode | undefined;
  let live = false; // the canvas is showing, running or paused on its last frame
  let inView = true;
  let raf = 0;
  let last = 0;
  let deadline = 0; // when the next frame is due, advanced from itself, not from now
  let t = 0;
  let accent = "#bb9af7";
  let edge = 1; // how far the outer columns have faded in, 0 to 1

  // Layout in CSS px, measured from the <pre> so the glyphs land on the same spots.
  let font = fontOf(pre);
  let width = 0;
  let height = 0;
  let rowH: number = CELL_H;
  let cw: number = CELL_W;
  let frameLeft = 0;
  let baseline = 12;
  let first = 0;
  let cols = 0;
  let levels = new Uint8Array(0);
  let hexes = new Uint8Array(0);
  let colAlpha = new Float32Array(0);

  // The cursor, smoothed. x and y are in the field's nominal cell units.
  const pointer = { clientX: 0, clientY: 0, x: 0, y: 0, strength: 0, target: 0 };

  const readAccent = (): void => {
    accent = getComputedStyle(hero).getPropertyValue("--accent").trim() || accent;
  };

  const updateColAlpha = (): void => {
    for (let i = 0; i < cols; i++) colAlpha[i] = columnAlpha(first + i, edge);
  };

  const layout = (): boolean => {
    const heroRect = hero.getBoundingClientRect();
    const preRect = pre.getBoundingClientRect();
    if (heroRect.width === 0 || preRect.height === 0) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = heroRect.width;
    height = preRect.height;
    rowH = height / FRAME.rows;
    frameLeft = preRect.left - heroRect.left;
    // Same height as the <pre> (the CSS 40rem is 0.3px taller), and the bitmap's own
    // rounding folded into the scale, so every glyph lands where the <pre>'s does.
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    font = fontOf(pre); // re-read every time: the <pre>'s font size can change after start
    ctx.font = font;
    ctx.textBaseline = "alphabetic";
    const metrics = ctx.measureText("M");
    cw = metrics.width;
    baseline = textBaseline(rowH, metrics.fontBoundingBoxAscent, metrics.fontBoundingBoxDescent);
    const range = columnRange(width, frameLeft, cw);
    first = range.first;
    cols = range.last - range.first + 1;
    levels = new Uint8Array(cols * FRAME.rows);
    hexes = new Uint8Array(cols * FRAME.rows);
    colAlpha = new Float32Array(cols);
    updateColAlpha();
    return true;
  };

  const draw = (): void => {
    const rows = FRAME.rows;
    const strength = pointer.strength;
    const reactive = strength > 0.01;
    let present = 0; // which levels have any ink this frame, one bit each
    for (let row = 0; row < rows; row++) {
      const base = row * cols;
      for (let i = 0; i < cols; i++) {
        const col = first + i;
        let brightness = ambient(col, row, t);
        let hex = false;
        if (reactive) {
          const distance = pointerDistance(col, row, pointer.x, pointer.y);
          brightness += pointerBoost(distance, strength);
          hex = inHexCore(distance, strength);
        }
        if (hex) {
          levels[base + i] = HEX_LEVEL;
          hexes[base + i] = hexChar(col, row, t).charCodeAt(0);
          present |= HEX_BIT;
        } else {
          const level = levelOf(brightness);
          levels[base + i] = level;
          present |= 1 << level;
        }
      }
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = accent;
    const x = frameLeft + first * cw;
    const graded = edge < 1; // while the outer columns fade, each column has its own opacity
    // Only cells with ink are drawn, one glyph each, grouped by level so the alpha
    // changes at most 11 times (once per glyph while graded). Far cheaper than
    // shaping long rows full of spaces.
    for (let level = 1; level <= RAMP.length; level++) {
      if (!(present & (1 << level))) continue;
      const isHex = level === RAMP.length;
      const alpha = isHex ? HEX_ALPHA : (ALPHA[level] ?? 1);
      ctx.globalAlpha = alpha;
      const wanted = isHex ? HEX_LEVEL : level;
      const symbol = RAMP.charAt(level);
      for (let row = 0; row < rows; row++) {
        const y = row * rowH + baseline;
        const base = row * cols;
        for (let i = 0; i < cols; i++) {
          if (levels[base + i] !== wanted) continue;
          if (graded) {
            const column = colAlpha[i] ?? 0;
            if (column < EDGE_DONE) continue;
            ctx.globalAlpha = alpha * column;
          }
          ctx.fillText(isHex ? String.fromCharCode(hexes[base + i] ?? 32) : symbol, x + i * cw, y);
        }
      }
    }
    ctx.globalAlpha = 1;
  };

  const stepPointer = (dt: number): void => {
    if (pointer.target === 0 && pointer.strength < 0.001) {
      pointer.strength = 0;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = (pointer.clientX - rect.left - frameLeft) * (CELL_W / cw);
    const y = (pointer.clientY - rect.top) * (CELL_H / rowH);
    if (pointer.strength < 0.01) {
      pointer.x = x;
      pointer.y = y;
    } else {
      pointer.x = easeToward(pointer.x, x, POINTER_TAU, dt);
      pointer.y = easeToward(pointer.y, y, POINTER_TAU, dt);
    }
    pointer.strength = easeToward(pointer.strength, pointer.target, STRENGTH_TAU, dt);
  };

  // The outer columns fade in once, when the canvas first appears. Under reduced
  // motion they were already switched on in goLive().
  const stepEdge = (dt: number): void => {
    if (edge >= 1) return;
    edge = easeToward(edge, 1, EDGE_TAU, dt);
    if (1 - edge < EDGE_DONE) edge = 1;
    updateColAlpha();
  };

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    if (!frameDue(now, deadline)) return;
    // 60 fps only while the cursor is reacting, including while its glow fades out.
    const reacting = pointer.target > 0 || pointer.strength > 0.001;
    deadline = nextDeadline(deadline, now, mode ? targetFps(mode, reacting) : 30);
    const dt = frameDelta(now, last);
    last = now;
    t += dt;
    stepPointer(dt);
    stepEdge(dt);
    draw();
  };

  // Swap in the canvas and hide the <pre> in the same task, so they never overlap.
  // It only ever happens once: after that the toggle pauses and resumes the canvas.
  const goLive = (): void => {
    if (!layout()) return;
    readAccent();
    t = 0;
    pointer.strength = 0;
    pointer.target = 0;
    edge = mode?.edgeFade === false ? 1 : 0; // starts as exactly the static frame
    updateColAlpha();
    draw();
    canvas.hidden = false;
    hero.classList.add("is-live");
    live = true;
  };

  // Run while the toggle is on, the hero is on screen and the tab is visible. Anything
  // else cancels the pending frame at once. Pausing leaves the canvas showing the frame
  // it stopped on; running again carries on from there.
  const update = (): void => {
    if (mode?.ambient && !live) goLive();
    const run = !!mode?.ambient && live && inView && !document.hidden;
    if (run && !raf) {
      last = performance.now();
      deadline = 0; // the first frame is due at once
      raf = requestAnimationFrame(frame);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  hero.addEventListener(
    "pointermove",
    (event) => {
      if (!mode?.reactive || event.pointerType === "touch") return;
      pointer.clientX = event.clientX;
      pointer.clientY = event.clientY;
      pointer.target = 1;
    },
    { passive: true },
  );
  hero.addEventListener("pointerleave", () => {
    pointer.target = 0;
  });

  // The <pre> is watched too: a change of the browser's default font size resizes it
  // (the frame is in rem) without resizing the hero.
  const resized = new ResizeObserver(() => {
    if (live && layout()) draw();
  });
  resized.observe(hero);
  resized.observe(pre);
  // Moving to another display changes the pixel ratio without resizing anything.
  const watchPixelRatio = (): void => {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      "change",
      () => {
        if (live && layout()) draw();
        watchPixelRatio();
      },
      { once: true },
    );
  };
  watchPixelRatio();
  new IntersectionObserver((entries) => {
    inView = entries.at(-1)?.isIntersecting ?? true;
    update();
  }).observe(hero);
  document.addEventListener("visibilitychange", update);
  // The theme is the data-theme attribute on <html> (set by public/theme-init.js and the
  // settings menu), not the OS setting. Its accent colour is read again when it changes.
  new MutationObserver(() => {
    readAccent();
    if (live) draw();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-accent"],
  });

  subscribe((next) => {
    mode = next;
    let repaint = false;
    // When the cursor may no longer reach the hero (reduced motion, the toggle, a
    // different pointer type), clear its strength too, not only its target, so no hex
    // digit is drawn afterwards. An ordinary pointerleave only sets the target, so
    // that still eases out.
    if (!next.reactive && (pointer.target !== 0 || pointer.strength !== 0)) {
      pointer.target = 0;
      pointer.strength = 0;
      repaint = true;
    }
    // Reduced motion arriving during the opening fade finishes it on the spot: the
    // outer columns jump to their final opacity instead of carrying on easing.
    if (!next.edgeFade && edge < 1) {
      edge = 1;
      updateColAlpha();
      repaint = true;
    }
    // Repaint once, so a paused canvas does not keep a hex core or a half-faded edge.
    if (repaint && live) draw();
    update();
  });
}

export function initHero(subscribe: Subscribe): void {
  const hero = document.querySelector<HTMLElement>(".hero");
  const stack = hero?.querySelector<HTMLElement>(".ascii");
  const pre = stack?.querySelector<HTMLElement>("pre");
  if (!hero || !stack || !pre) return;
  afterFirstPaint(() => {
    void start(hero, stack, pre, subscribe);
  });
}
