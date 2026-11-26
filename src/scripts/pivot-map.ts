/**
 * The pivot map's behaviour. Every panel, card and link is already in the page, built from the
 * data, so this script only decides what is shown: the chosen type, the trail of steps and the
 * lit nodes. It reads text from the page and writes only text and classes. The trail is shared
 * through the page state, which the tabs turn into the address bar, so a trail is a link.
 */

import { set, state, subscribe } from "../lib/osint-state.ts";
import { markdownText, trailText } from "../lib/pivot-map.ts";

type Step = { id: string; tools: string[] };

const root = document.querySelector<HTMLElement>("[data-pm]");
if (root) init(root);

function init(root: HTMLElement): void {
  const all = <T extends Element>(sel: string): T[] => [...root.querySelectorAll<T>(sel)];
  const one = <T extends Element>(sel: string): T | null => root.querySelector<T>(sel);
  const panels = all<HTMLElement>(".pm-panel");
  const bar = one<HTMLElement>(".pm-bar");
  const barFirst = one<HTMLElement>("[data-copy]");
  const toast = one<HTMLElement>(".pm-toast");
  const live = one<HTMLElement>("[data-live]");
  const find = (id: string) => panels.find((p) => p.dataset.id === id);
  let trail: Step[] = [];
  for (const b of all<HTMLButtonElement>(".pm-go")) b.disabled = false;
  for (const el of all<HTMLElement>("[data-js]")) el.hidden = false;
  const ids = (): string[] => trail.map((s) => s.id);

  // The tools a step from one type to another uses: every card in the panel that leads there.
  const stepTools = (from: string, to: string): string[] | null => {
    const cards = [...(find(from)?.querySelectorAll<HTMLElement>(".pm-go") ?? [])].filter(
      (b) => b.dataset.go === to,
    );
    if (!cards.length) return null;
    const names = cards.flatMap((b) => (b.dataset.tools ?? "").split(", "));
    return [...new Set(names)];
  };

  const render = (): void => {
    const last = trail[trail.length - 1];
    const cur = find(last?.id ?? "");
    if (!bar || !barFirst || !last || !cur) return;
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
      b.textContent = (i ? "→ " : "") + (find(s.id)?.dataset.short ?? s.id);
      b.addEventListener("click", () => {
        trail = trail.slice(0, i + 1);
        render();
      });
      if (i === trail.length - 1) b.setAttribute("aria-current", "step");
      bar.insertBefore(b, barFirst);
    });
    bar.hidden = trail.length < 2;
    if (toast) toast.textContent = "";
    if (live) live.textContent = cur.dataset.head ?? "";
    if (state.trail.join(".") !== ids().join(".")) set({ type: last.id, trail: ids() });
  };

  // Show a trail of types. A step the map has no pivot for ends the trail there.
  const restore = (list: string[]): void => {
    const first = list[0];
    if (!first || !find(first)) {
      trail = [{ id: panels[0]?.dataset.id ?? "", tools: [] }];
    } else {
      trail = [{ id: first, tools: [] }];
      for (const to of list.slice(1)) {
        const tools = stepTools(trail[trail.length - 1]?.id ?? "", to);
        if (!tools) break;
        trail.push({ id: to, tools });
      }
    }
    render();
  };

  const text = (): { shorts: string[]; tools: string[][]; url: string } => ({
    shorts: trail.map((s) => find(s.id)?.dataset.short ?? s.id),
    tools: trail.map((s) => s.tools),
    url: `${location.origin}${location.pathname}#${ids().join(".")}`,
  });

  const copy = async (what: string): Promise<void> => {
    const { shorts, tools, url } = text();
    const out =
      what === "md"
        ? markdownText(shorts, tools, url)
        : what === "link"
          ? url
          : trailText(shorts, tools);
    let ok = false;
    try {
      await navigator.clipboard.writeText(out);
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
    if (el.dataset.start) restore([el.dataset.start]);
    else if (el.dataset.go) {
      trail.push({ id: el.dataset.go, tools: (el.dataset.tools ?? "").split(", ") });
      render();
      root.querySelector<HTMLElement>(".pm-panel.on h3")?.focus();
    } else if (el.dataset.copy !== undefined) void copy(el.dataset.copy || "text");
    else restore([trail[0]?.id ?? ""]);
  });
  root.addEventListener("keydown", (ev) => {
    const g = (ev.target as Element).closest<SVGGElement>("g[role=button]");
    if (g && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      g.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });

  subscribe(() => {
    if (state.trail.join(".") !== ids().join(".")) {
      restore(state.trail.length ? state.trail : [state.type]);
    }
  });
  restore(state.trail.length ? state.trail : state.type ? [state.type] : []);
}
