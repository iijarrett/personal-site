/**
 * The "All tools" list. Every row is already in the page, built from the data; this script only
 * hides the rows a search or a chip rules out, keeps the "Showing N of M" line, and sends a
 * "Reach from" chip to the pivot map through the shared state. It reads text from the page and
 * writes only text, classes and the hidden flag.
 */

import { set } from "../lib/osint-state.ts";
import { countLine, matches } from "../lib/osint-tools.ts";

const root = document.querySelector<HTMLElement>("[data-at]");
if (root) init(root);

function init(root: HTMLElement): void {
  const all = <T extends Element>(sel: string): T[] => [...root.querySelectorAll<T>(sel)];
  const rows = all<HTMLElement>(".at-row").map((el) => ({
    el,
    text: el.dataset.text ?? "",
    sec: el.dataset.sec ?? "",
    tier: el.dataset.tier ?? "",
  }));
  const groups = all<HTMLElement>(".at-group");
  const input = root.querySelector<HTMLInputElement>("[data-q]");
  const count = root.querySelector<HTMLElement>("[data-count]");
  const clear = root.querySelector<HTMLElement>("[data-clear]");
  const empty = root.querySelector<HTMLElement>("[data-empty]");
  const filter = { q: "", sec: "", tier: "" };
  for (const el of all<HTMLElement>("[data-js]")) el.hidden = false;
  for (const b of all<HTMLButtonElement>("[data-reach]")) b.disabled = false;

  const apply = (): void => {
    let shown = 0;
    for (const r of rows) {
      const on = matches(r, filter);
      r.el.hidden = !on;
      if (on) shown++;
    }
    for (const g of groups) g.hidden = !g.querySelector(".at-row:not([hidden])");
    for (const b of all<HTMLElement>("[data-fsec],[data-ftier]")) {
      const on = b.dataset.fsec ? b.dataset.fsec === filter.sec : b.dataset.ftier === filter.tier;
      b.setAttribute("aria-pressed", String(on));
    }
    if (count) count.textContent = countLine(shown, rows.length);
    if (clear) clear.hidden = !(filter.q || filter.sec || filter.tier);
    if (empty) empty.hidden = shown > 0;
  };

  root.addEventListener("click", (ev) => {
    const el = (ev.target as Element).closest<HTMLElement>(
      "[data-fsec],[data-ftier],[data-clear],[data-reach]",
    );
    if (!el) return;
    if (el.dataset.reach) {
      set({ tab: "pivot", type: el.dataset.reach });
      document.querySelector<HTMLElement>(".pm-panel.on h3")?.focus();
      return;
    }
    if (el.dataset.fsec) filter.sec = filter.sec === el.dataset.fsec ? "" : el.dataset.fsec;
    else if (el.dataset.ftier) {
      filter.tier = filter.tier === el.dataset.ftier ? "" : el.dataset.ftier;
    } else {
      filter.q = filter.sec = filter.tier = "";
      if (input) input.value = "";
    }
    apply();
  });
  input?.addEventListener("input", () => {
    filter.q = input.value.trim().toLowerCase();
    apply();
  });
  apply();
}
