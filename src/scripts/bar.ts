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
  // The same query as the CSS: a screen over 640px whose primary pointer can hover.
  const wide = matchMedia("(min-width: 641px) and (hover: hover)");
  // The scroll position clamped to the page's real range, so an overscroll bounce at either end
  // (iOS rubber-banding) is not read as scrolling.
  const pos = (): number => Math.max(0, Math.min(scrollY, root.scrollHeight - innerHeight));
  // The bundle can run late, with keyboard focus already in the header.
  let state: BarState = { ...START, last: pos(), focus: header.matches(":has(:focus-visible)") };
  let shown = false;
  // Handlers do nothing until setup has finished, so a throw part-way through leaves no marker
  // class behind and the CSS failsafe stays in charge.
  let live = false;

  const update = (next: BarState = state): void => {
    if (!live) return;
    state = next;
    shown = barShown(state, wide.matches, !pos());
    root.classList.toggle("bar-on", shown);
    root.classList.toggle("bar-off", !shown);
  };

  const passive = { passive: true };
  addEventListener("scroll", () => update(scrolled(state, pos())), passive);
  addEventListener("wheel", (event) => update(wheel(state, event.deltaY, !pos())), passive);
  addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType !== "mouse") return;
      update(pointerAt(state, event.clientY, shown, header.getBoundingClientRect().bottom));
    },
    passive,
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
  live = true;
  update();
}
