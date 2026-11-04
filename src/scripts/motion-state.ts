/**
 * Shared motion state: the footer toggle, the OS reduced-motion setting and the
 * pointer type, combined by motionMode() and published to the effects.
 */

import { MOTION_KEY, type MotionMode, motionMode, parseMotionPref } from "../lib/motion.ts";

const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
const hoverQuery = matchMedia("(hover: hover)");
const listeners = new Set<(mode: MotionMode) => void>();

function readPref(): boolean {
  try {
    return parseMotionPref(localStorage.getItem(MOTION_KEY)) === "on";
  } catch {
    return true; // storage blocked: default to on
  }
}

function savePref(on: boolean): void {
  try {
    localStorage.setItem(MOTION_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

let motionOn = readPref();

export function currentMode(): MotionMode {
  return motionMode({
    motionOn,
    reducedMotion: reducedQuery.matches,
    canHover: hoverQuery.matches,
  });
}

function publish(): void {
  const mode = currentMode();
  document.documentElement.classList.toggle("no-fx", !mode.fades);
  for (const listener of listeners) listener(mode);
}

/** Calls back straight away, then whenever the toggle, reduced motion or pointer type changes. */
export function subscribe(listener: (mode: MotionMode) => void): void {
  listeners.add(listener);
  listener(currentMode());
}

function initToggle(): void {
  const button = document.querySelector<HTMLButtonElement>(".motion-toggle");
  if (!button) return;
  const state = button.querySelector("span");
  const render = (): void => {
    button.setAttribute("aria-pressed", String(motionOn));
    if (state) state.textContent = motionOn ? ": on" : ": off";
  };
  render();
  button.hidden = false; // it ships hidden, so there is no dead control without JavaScript
  button.addEventListener("click", () => {
    motionOn = !motionOn;
    savePref(motionOn);
    render();
    publish();
  });
}

export function initMotion(): void {
  reducedQuery.addEventListener("change", publish);
  hoverQuery.addEventListener("change", publish);
  document.documentElement.classList.toggle("no-fx", !currentMode().fades);
  initToggle();
}
