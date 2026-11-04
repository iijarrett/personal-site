/**
 * When the settings menu is open. Pure, so it can be tested; the DOM glue is
 * src/scripts/settings.ts.
 *
 * Four things are tracked independently, because any of them can hold the menu open
 * and none may close it while another still does (WCAG 1.4.13, persistent):
 *   hover      a mouse pointer is over the menu
 *   focus      keyboard focus is anywhere inside it, on the button or on an option
 *   pinned     a click or tap opened it and it stays until dismissed
 *   dismissed  Escape or a second click closed it. It blocks hover and focus from
 *              keeping the menu open until the next fresh hover or focus entry.
 *
 * The menu is open when it is pinned, or when it is hovered or focused and not dismissed.
 */

export interface MenuState {
  hover: boolean;
  focus: boolean;
  pinned: boolean;
  dismissed: boolean;
}

export type MenuEvent = "enter" | "leave" | "focus" | "blur" | "click" | "escape" | "outside";

export const CLOSED: MenuState = { hover: false, focus: false, pinned: false, dismissed: false };

export const isOpen = (state: MenuState): boolean =>
  state.pinned || ((state.hover || state.focus) && !state.dismissed);

export function nextMenu(state: MenuState, event: MenuEvent): MenuState {
  switch (event) {
    case "enter": // a mouse arriving. A fresh hover ends a dismissal.
      return state.hover ? state : { ...state, hover: true, dismissed: false };
    case "leave": // the pointer going away only takes away its own hold
      return state.hover ? { ...state, hover: false } : state;
    case "focus": // keyboard focus arriving anywhere in the menu. A fresh entry ends a dismissal.
      return state.focus ? state : { ...state, focus: true, dismissed: false };
    case "blur": // focus leaving the menu altogether also releases a pin
      return state.focus || state.pinned ? { ...state, focus: false, pinned: false } : state;
    case "click": // the button: pins the menu open, and when it is already pinned closes it
      return state.pinned
        ? { ...state, pinned: false, dismissed: true }
        : { ...state, pinned: true, dismissed: false };
    case "escape": // closes an open menu even while the pointer is over it or focus is in it
      return isOpen(state) ? { ...state, pinned: false, dismissed: true } : state;
    case "outside": // a press anywhere else closes everything
      return CLOSED;
  }
}
