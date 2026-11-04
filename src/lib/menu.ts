/**
 * When the settings menu is open. Pure, so it can be tested; the DOM glue is
 * src/scripts/settings.ts. It remembers how the menu opened, because that decides
 * what closes it: a menu opened by hovering closes when the pointer leaves, one
 * opened by keyboard focus or by a click stays until it is dismissed.
 */

export type OpenedBy = "hover" | "focus" | "click";
export interface MenuState {
  /** How it opened, or null when it is closed. */
  by: OpenedBy | null;
}
export type MenuEvent = "enter" | "leave" | "focus" | "blur" | "click" | "escape" | "outside";

export const CLOSED: MenuState = { by: null };

export const isOpen = (state: MenuState): boolean => state.by !== null;

export function nextMenu(state: MenuState, event: MenuEvent): MenuState {
  switch (event) {
    case "enter": // a mouse arriving opens it, but never changes how an open one stays open
      return isOpen(state) ? state : { by: "hover" };
    case "focus": // keyboard focus on the button, which also keeps a hovered menu open
      return state.by === "click" || state.by === "focus" ? state : { by: "focus" };
    case "leave": // the pointer going away only closes a menu that hover opened
      return state.by === "hover" ? CLOSED : state;
    case "click": // opens it and keeps it open; clicking again closes it
      return state.by === "click" ? CLOSED : { by: "click" };
    case "blur":
    case "escape":
    case "outside":
      return CLOSED;
  }
}
