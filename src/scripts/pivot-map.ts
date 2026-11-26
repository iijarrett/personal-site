/**
 * The pivot map's behaviour. Every panel, card and link is already in the page, built from the
 * data, so this script only decides what is shown: the chosen type, the trail of steps and the
 * lit nodes. It reads text from the page and writes only text and classes.
 */

import { set, state, subscribe } from "../lib/osint-state.ts";
import { trailText } from "../lib/pivot-map.ts";

type Step = { id: string; tools: string[] };

const root = document.querySelector<HTMLElement>("[data-pm]");
if (root) init(root);

function init(root: HTMLElement): void {
  const all = <T extends Element>(sel: string): T[] => [...root.querySelectorAll<T>(sel)];
  const one = <T extends Element>(sel: string): T | null => root.querySelector<T>(sel);
  const panels = all<HTMLElement>(".pm-panel");
  const bar = one<HTMLElement>(".pm-bar");
  const copyBtn = one<HTMLElement>("[data-copy]");
  const toast = one<HTMLElement>(".pm-toast");
  const live = one<HTMLElement>("[data-live]");
  const find = (id: string) => panels.find((p) => p.dataset.id === id);
  let trail: Step[] = [];
  for (const b of all<HTMLButtonElement>(".pm-go")) b.disabled = false;
  for (const el of all<HTMLElement>("[data-js]")) el.hidden = false;

  const render = (): void => {
    const last = trail[trail.length - 1];
    const cur = find(last?.id ?? "");
    if (!bar || !copyBtn || !last || !cur) return;
    for (const p of panels) p.classList.toggle("on", p === cur);
    for (const c of all<HTMLElement>(".pm-chip")) {
      c.setAttribute("aria-pressed", String(c.dataset.start === trail[0]?.id));
    }
    const reach = new Set(
      [...cur.querySelectorAll<HTMLElement>(".pm-hub [data-go]")].map((g) => g.dataset.go),
    );
    for (const n of all<SVGGElement>(".pm-map .pm-n")) {
      n.classList.toggle("sel", n.dataset.start === last.id);
      n.classList.toggle("reach", reach.has(n.dataset.start));
    }
    for (const e of all<SVGPathElement>(".pm-map .pm-e")) {
      const on = e.dataset.f === last.id;
      e.classList.toggle("on", on);
      if (on) e.setAttribute("marker-end", "url(#pm-arr)");
      else e.removeAttribute("marker-end");
    }
    for (const c of all(".crumb")) c.remove();
    trail.forEach((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn crumb";
      b.textContent = (i ? "\u2192 " : "") + (find(s.id)?.dataset.short ?? s.id);
      b.addEventListener("click", () => {
        trail = trail.slice(0, i + 1);
        render();
      });
      if (i === trail.length - 1) b.setAttribute("aria-current", "step");
      bar.insertBefore(b, copyBtn);
    });
    bar.hidden = trail.length < 2;
    if (toast) toast.textContent = "";
    if (live) live.textContent = cur.dataset.head ?? "";
  };

  // Starting from a type: the map shows it, and the shared state (which the tabs turn into the
  // address bar) hears of it, unless the state is where the change came from.
  const begin = (id: string): void => {
    if (!find(id)) return;
    trail = [{ id, tools: [] }];
    render();
  };
  const start = (id: string): void => {
    begin(id);
    set({ type: id });
  };

  const copy = async (): Promise<void> => {
    const text = trailText(
      trail.map((s) => find(s.id)?.dataset.short ?? s.id),
      trail.map((s) => s.tools),
    );
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      getSelection()?.selectAllChildren(bar as Node);
    }
    if (toast)
      toast.textContent = ok
        ? "Copied."
        : "Copy was blocked. The trail is selected: copy it yourself.";
  };

  root.addEventListener("click", (ev) => {
    const el = (ev.target as Element).closest<HTMLElement>(
      "[data-start],[data-go],[data-copy],[data-clear]",
    );
    if (!el) return;
    if (el.dataset.start) start(el.dataset.start);
    else if (el.dataset.go) {
      trail.push({ id: el.dataset.go, tools: (el.dataset.tools ?? "").split(", ") });
      render();
      root.querySelector<HTMLElement>(".pm-panel.on h3")?.focus();
    } else if (el.dataset.copy !== undefined) void copy();
    else start(trail[0]?.id ?? "");
  });
  root.addEventListener("keydown", (ev) => {
    const g = (ev.target as Element).closest<SVGGElement>("g[role=button]");
    if (g && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      g.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });

  subscribe(() => {
    if (state.type !== trail[0]?.id) begin(state.type);
  });
  start(find(state.type) ? state.type : (panels[0]?.dataset.id ?? ""));
}
