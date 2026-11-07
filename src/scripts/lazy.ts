/**
 * Loads the footer arcade chunk, once, and only for a real visitor. It needs the footer within
 * 800px of the viewport and a trusted press, touch, wheel or key; a page that is only opened, a
 * crawler or a Lighthouse run never requests it. It stays out of the way of people who asked
 * their browser to save data, and where IntersectionObserver is missing. The chunk is a
 * same-origin file, so the CSP (script-src 'self') already covers it.
 */

import { createGate } from "../lib/lazy-gate.ts";
import type { MotionMode } from "../lib/motion.ts";

export type ArcadeEnv = {
  footer: HTMLElement;
  isOn: () => boolean;
  subscribe: (listener: (mode: MotionMode) => void) => void;
};
export type ArcadeModule = { initArcade: (env: ArcadeEnv) => void };

const ACTIONS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

export function initLazy(load: () => Promise<ArcadeModule>, env: Omit<ArcadeEnv, "footer">): void {
  const footer = document.querySelector<HTMLElement>(".site-footer");
  const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
  if (!footer || saveData || typeof IntersectionObserver === "undefined") return;

  const act = (event: Event): void => {
    if (event.isTrusted) gate.setActed();
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) gate.setNear(entry.isIntersecting);
    },
    { rootMargin: "800px 0px" },
  );
  const gate = createGate(() => {
    for (const name of ACTIONS) removeEventListener(name, act);
    observer.disconnect();
    load()
      .then((chunk) => chunk.initArcade({ footer, ...env }))
      .catch(() => {});
  });
  for (const name of ACTIONS) addEventListener(name, act, { passive: true });
  observer.observe(footer);
}
