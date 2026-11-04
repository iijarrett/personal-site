/**
 * The settings menu in the header: a disclosure button and a panel with the theme and
 * motion switches. It ships hidden (invisible, out of the tab order) and appears once
 * this runs, so there is no dead control without JavaScript. When it is open is decided
 * by src/lib/menu.ts; this file is the DOM around it.
 */

import { CLOSED, isOpen, type MenuEvent, nextMenu } from "../lib/menu.ts";
import { parseTheme, THEME_COLOR, THEME_KEY, type Theme } from "../lib/theme.ts";

/** The motion switch, owned by motion-state.ts and handed in so this file stays testable. */
export interface MotionSwitch {
  isOn(): boolean;
  set(on: boolean): void;
}

export function initSettings(motion: MotionSwitch): void {
  const box = document.querySelector<HTMLElement>(".settings");
  const button = box?.querySelector<HTMLButtonElement>(".settings-btn");
  const panel = box?.querySelector<HTMLElement>(".settings-panel");
  if (!box || !button || !panel) return;
  const root = document.documentElement;
  let state = CLOSED;
  let restoring = false; // focus is being put back on the button, which must not reopen it

  const send = (event: MenuEvent): void => {
    state = nextMenu(state, event);
    panel.hidden = !isOpen(state);
    button.setAttribute("aria-expanded", String(isOpen(state)));
  };

  // Every choice button shows whether it is the current one.
  const sync = (): void => {
    const now: Record<string, string> = {
      theme: parseTheme(root.dataset.theme),
      motion: motion.isOn() ? "on" : "off",
    };
    for (const choice of panel.querySelectorAll<HTMLElement>("button[data-key]")) {
      const picked = now[choice.dataset.key ?? ""] === choice.dataset.value;
      choice.setAttribute("aria-pressed", String(picked));
    }
  };

  const setTheme = (theme: Theme): void => {
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  };

  panel.addEventListener("click", (event) => {
    const choice = (event.target as Element).closest<HTMLElement>("button[data-key]");
    if (!choice) return;
    if (choice.dataset.key === "theme") setTheme(parseTheme(choice.dataset.value));
    else motion.set(choice.dataset.value === "on");
    sync();
  });
  // Pressing on the panel must not move focus away first: that would close the menu in
  // browsers that do not focus a button when it is clicked.
  panel.addEventListener("mousedown", (event) => event.preventDefault());

  button.addEventListener("click", () => send("click"));
  // Keyboard focus anywhere in the box counts, on the button or on an option, so a menu that
  // hover opened stays open while focus is in it. A mouse press that focuses something does
  // not count: that is the click's job.
  box.addEventListener("focusin", (event) => {
    if (!restoring && (event.target as Element).matches(":focus-visible")) send("focus");
  });
  // Hover is for a mouse. On touch the pointer events come with the tap, which the click handles.
  box.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") send("enter");
  });
  box.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") send("leave");
  });
  box.addEventListener("focusout", (event) => {
    if (!box.contains(event.relatedTarget as Node | null)) send("blur");
  });
  document.addEventListener("pointerdown", (event) => {
    if (isOpen(state) && !box.contains(event.target as Node)) send("outside");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isOpen(state)) return;
    const inside = box.contains(document.activeElement);
    send("escape");
    if (inside) {
      restoring = true;
      button.focus();
      restoring = false;
    }
  });

  sync();
  box.classList.add("is-ready");
}
