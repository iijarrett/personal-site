/**
 * What the OSINT page's scripts share: which tab is showing and which kind of data the pivot
 * map starts from. One copy, held here, so the tabs, the map and the tool list never have to
 * reach into each other. `hashFor` and `fromHash` are the only place the address bar is read
 * or written: #all-tools for the list, #pivot-map or a data type (#email) for the map.
 */

export type Tab = "pivot" | "tools";
export type State = { tab: Tab; type: string };

export const state: State = { tab: "pivot", type: "" };

const listeners: (() => void)[] = [];

export const subscribe = (fn: () => void): void => {
  listeners.push(fn);
};

export function set(patch: Partial<State>): void {
  Object.assign(state, patch);
  for (const fn of listeners) fn();
}

export const hashFor = (s: State): string => (s.tab === "tools" ? "all-tools" : s.type);

/** What an address-bar hash asks for, or null when it asks for nothing this page knows. */
export function fromHash(hash: string, types: string[]): Partial<State> | null {
  if (hash === "all-tools") return { tab: "tools" };
  if (hash === "pivot-map") return { tab: "pivot" };
  return types.includes(hash) ? { tab: "pivot", type: hash } : null;
}
