/**
 * What the OSINT page's scripts share: which tab is showing, the pivot map's trail and the tool
 * the list was sent to. One copy, held here, so the tabs, the map and the tool list never have
 * to reach into each other. `hashFor` and `fromHash` are the only place the address bar is read
 * or written:
 *   #all-tools        the tool list
 *   #tool-<id>        the tool list, at one tool
 *   #pivot-map        the map, as it is
 *   #email.account    the map, on a trail of data types (one type is a trail of one)
 */

export type Tab = "pivot" | "tools";
export type State = { tab: Tab; type: string; trail: string[]; tool: string };

export const state: State = { tab: "pivot", type: "", trail: [], tool: "" };

const listeners: (() => void)[] = [];

export const subscribe = (fn: () => void): void => {
  listeners.push(fn);
};

export function set(patch: Partial<State>): void {
  Object.assign(state, patch);
  for (const fn of listeners) fn();
}

export function hashFor(s: State): string {
  if (s.tab === "tools") return s.tool ? `tool-${s.tool}` : "all-tools";
  return s.trail.length > 1 ? s.trail.join(".") : s.type;
}

/** What an address-bar hash asks for, or null when it asks for nothing this page knows. */
export function fromHash(
  hash: string,
  types: string[],
  tools: string[] = [],
): Partial<State> | null {
  if (hash === "all-tools") return { tab: "tools", tool: "" };
  if (hash === "pivot-map") return { tab: "pivot" };
  if (hash.startsWith("tool-")) {
    const tool = hash.slice(5);
    return tools.includes(tool) ? { tab: "tools", tool } : null;
  }
  const trail = hash.split(".");
  return trail.every((t) => types.includes(t))
    ? { tab: "pivot", type: trail[0] ?? "", trail }
    : null;
}
