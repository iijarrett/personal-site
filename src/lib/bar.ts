/**
 * When the header bar shows. Pure, so it can be tested; the DOM glue is
 * src/scripts/bar.ts. Four things can show it:
 *   scrolling up   (and on a narrow screen, being at the very top of the page)
 *   a wheel-up at the very top, where there is nothing left to scroll
 *   a mouse at the top edge of the window, which then keeps it while the pointer is over it
 *   keyboard focus anywhere in the header
 * Scrolling down hides it again, unless the pointer or focus is holding it.
 */

export type Direction = "up" | "down" | null;

export interface BarState {
  /** Which way the page was last scrolled, once it had moved STEP px. */
  dir: Direction;
  /** The scroll position the direction was last measured from. */
  last: number;
  /** The mouse is at the top edge, or over the shown bar. */
  edge: boolean;
  /** Keyboard focus is inside the header. */
  focus: boolean;
}

/** Scrolling less than this, in px, is not a change of direction: it is jitter. */
export const STEP = 8;
/** A mouse this close to the top of the window reveals a hidden bar. */
export const EDGE = 8;

export const START: BarState = { dir: null, last: 0, edge: false, focus: false };

/** The page scrolled to `y`. Small moves add up until they reach STEP, so a slow scroll still counts. */
export function scrolled(state: BarState, y: number): BarState {
  const moved = y - state.last;
  return Math.abs(moved) < STEP ? state : { ...state, last: y, dir: moved > 0 ? "down" : "up" };
}

/** A wheel turned by `deltaY`. Up at the very top cannot scroll, so no scroll event follows. */
export function wheel(state: BarState, deltaY: number, atTop: boolean): BarState {
  return deltaY < 0 && atTop && state.dir !== "up" ? { ...state, dir: "up" } : state;
}

/** The mouse at height `y`. A hidden bar needs the edge; a shown one is kept while `y` is over it. */
export function pointerAt(state: BarState, y: number, shown: boolean, barBottom: number): BarState {
  const edge = y <= (shown ? barBottom : EDGE);
  return edge === state.edge ? state : { ...state, edge };
}

/** Whether the bar shows. `wide` is the desktop layout, which starts with the bar hidden. */
export function barShown(state: BarState, wide: boolean, atTop: boolean): boolean {
  return state.focus || state.edge || state.dir === "up" || (!wide && atTop);
}
