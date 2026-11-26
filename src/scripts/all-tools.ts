/**
 * The "All tools" list. Every row is already in the page, built from the data; this script only
 * hides the rows a search or a chip rules out, keeps the "Showing N of M" line, and sends a
 * "Reach from" chip to the pivot map through the shared state. It reads text from the page and
 * writes only text, classes and the hidden flag.
 */

import { set, state, subscribe } from "../lib/osint-state.ts";
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
    cost: el.dataset.cost ?? "",
  }));
  const groups = all<HTMLElement>(".at-group");
  const input = root.querySelector<HTMLInputElement>("[data-q]");
  const count = root.querySelector<HTMLElement>("[data-count]");
  const clear = root.querySelector<HTMLElement>("[data-clear]");
  const empty = root.querySelector<HTMLElement>("[data-empty]");
  const filter = { q: "", sec: "", tier: "", cost: "" };
  for (const el of all<HTMLElement>("[data-js]")) el.hidden = false;
  for (const b of all<HTMLButtonElement>("[data-reach]")) b.disabled = false;

  const clearAll = (): void => {
    filter.q = filter.sec = filter.tier = filter.cost = "";
    if (input) input.value = "";
  };

  const apply = (): void => {
    let shown = 0;
    for (const r of rows) {
      const on = matches(r, filter);
      r.el.hidden = !on;
      if (on) shown++;
    }
    for (const g of groups) g.hidden = !g.querySelector(".at-row:not([hidden])");
    for (const b of all<HTMLElement>("[data-fsec],[data-ftier],[data-fcost]")) {
      const on = b.dataset.fsec
        ? b.dataset.fsec === filter.sec
        : b.dataset.ftier
          ? b.dataset.ftier === filter.tier
          : b.dataset.fcost === filter.cost;
      b.setAttribute("aria-pressed", String(on));
    }
    if (count) count.textContent = countLine(shown, rows.length);
    if (clear) clear.hidden = !(filter.q || filter.sec || filter.tier || filter.cost);
    if (empty) empty.hidden = shown > 0;
  };

  root.addEventListener("click", (ev) => {
    const el = (ev.target as Element).closest<HTMLElement>(
      "[data-fsec],[data-ftier],[data-fcost],[data-clear],[data-reach]",
    );
    if (!el) return;
    if (el.dataset.reach) {
      set({ tab: "pivot", type: el.dataset.reach, trail: [el.dataset.reach] });
      document.querySelector<HTMLElement>(".pm-panel.on h3")?.focus();
      return;
    }
    if (el.dataset.fsec) filter.sec = filter.sec === el.dataset.fsec ? "" : el.dataset.fsec;
    else if (el.dataset.ftier) {
      filter.tier = filter.tier === el.dataset.ftier ? "" : el.dataset.ftier;
    } else if (el.dataset.fcost) {
      filter.cost = filter.cost === el.dataset.fcost ? "" : el.dataset.fcost;
    } else clearAll();
    apply();
  });
  input?.addEventListener("input", () => {
    filter.q = input.value.trim().toLowerCase();
    apply();
  });
  apply();

  // A link to one tool (#tool-<id>): drop the filters, bring the row to the middle and mark it.
  const reveal = (): void => {
    if (state.tab !== "tools" || !state.tool) return;
    clearAll();
    apply();
    const row = rows.find((r) => r.el.id === `tool-${state.tool}`);
    if (!row) return;
    for (const el of all<HTMLElement>(".at-hit")) el.classList.remove("at-hit");
    row.el.classList.add("at-hit");
    row.el.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
    row.el.scrollIntoView({ block: "center" });
  };
  subscribe(reveal);
  reveal();

  // "/" jumps to the search box, as on GitHub, unless a field already has the keyboard.
  addEventListener("keydown", (ev) => {
    const t = ev.target as HTMLElement;
    if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey || state.tab !== "tools") return;
    if (t.closest("input,textarea,select,[contenteditable]")) return;
    ev.preventDefault();
    input?.focus();
  });
}
