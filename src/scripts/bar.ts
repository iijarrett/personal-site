/**
 * The header bar's hide and show. It sets bar-on or bar-off on <html> and the CSS does the
 * sliding; src/lib/bar.ts decides which. It only runs with JavaScript, and the CSS only hides
 * the bar once the head script has added .js, so without JavaScript the header stays put.
 */

import { type BarState, barShown, pointerAt, START, scrolled, wheel } from "../lib/bar.ts";

export function initBar(): void {
  const header = document.querySelector<HTMLElement>(".site-header");
  if (!header) return;
  const root = document.documentElement;
  const wide = matchMedia("(min-width: 641px)"); // the same breakpoint as the CSS
  let state: BarState = { ...START, last: Math.max(0, scrollY) };
  let shown = false;

  const update = (next: BarState = state): void => {
    state = next;
    shown = barShown(state, wide.matches, scrollY <= 0);
    root.classList.toggle("bar-on", shown);
    root.classList.toggle("bar-off", !shown);
  };

  // Scrolling negative (an overscroll bounce) counts as the top.
  addEventListener("scroll", () => update(scrolled(state, Math.max(0, scrollY))), {
    passive: true,
  });
  addEventListener("wheel", (event) => update(wheel(state, event.deltaY, scrollY <= 0)), {
    passive: true,
  });
  addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType !== "mouse") return;
      update(pointerAt(state, event.clientY, shown, header.getBoundingClientRect().bottom));
    },
    { passive: true },
  );
  root.addEventListener("pointerleave", () => update({ ...state, edge: false }));
  // Only keyboard focus counts: a mouse click on the settings button should not bring the nav.
  header.addEventListener("focusin", (event) => {
    if ((event.target as Element).matches(":focus-visible")) update({ ...state, focus: true });
  });
  header.addEventListener("focusout", (event) => {
    if (!header.contains(event.relatedTarget as Node | null)) update({ ...state, focus: false });
  });
  wide.addEventListener("change", () => update());
  update();
}
