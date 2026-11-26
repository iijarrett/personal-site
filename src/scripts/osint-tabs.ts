/**
 * The "Pivot map | All tools" tabs. Both panels are already in the page; this decides which one
 * shows, keeps the roving focus and the arrow keys, and is the only code that writes the address
 * bar (#all-tools, or the map's data type, which also covers #pivot-map).
 */

import { fromHash, hashFor, set, state, subscribe, type Tab } from "../lib/osint-state.ts";

const root = document.querySelector<HTMLElement>("[data-os]");
if (root) init(root);

function init(root: HTMLElement): void {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[role=tab]")];
  const panels = [...root.querySelectorAll<HTMLElement>("[role=tabpanel]")];
  const types = [...root.querySelectorAll<HTMLElement>(".pm-panel")].map((p) => p.dataset.id ?? "");
  const bar = root.querySelector<HTMLElement>(".os-tabs");
  if (bar) bar.hidden = false;

  const render = (): void => {
    for (const t of tabs) {
      const on = t.dataset.tab === state.tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    }
    for (const p of panels) p.classList.toggle("on", p.dataset.panel === state.tab);
    try {
      history.replaceState(null, "", `#${hashFor(state)}`);
    } catch {
      // The address bar stays as it is.
    }
  };
  subscribe(render);

  const go = (tab: string | undefined): void => {
    if (tab === "pivot" || tab === "tools") set({ tab: tab as Tab });
  };
  root.addEventListener("click", (ev) => {
    go((ev.target as Element).closest<HTMLElement>("[role=tab]")?.dataset.tab);
  });
  bar?.addEventListener("keydown", (ev) => {
    const at = tabs.findIndex((t) => t.dataset.tab === state.tab);
    const next =
      ev.key === "ArrowRight"
        ? at + 1
        : ev.key === "ArrowLeft"
          ? at - 1
          : ev.key === "Home"
            ? 0
            : ev.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    ev.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length];
    go(tab?.dataset.tab);
    tab?.focus();
  });

  const fromLocation = (): void => {
    const patch = fromHash(location.hash.slice(1), types);
    if (patch) set(patch);
    else render();
  };
  fromLocation();
  addEventListener("hashchange", fromLocation);
}
