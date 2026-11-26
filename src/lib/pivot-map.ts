/**
 * Helpers for the OSINT pivot map. The build uses them to lay the map out; the page script
 * uses `trailText`. The data is a vendored copy of the OSINT Field Guide's pivot-map.json.
 */

export type Tool = { id: string; name: string; tier: "start" | "deeper"; url: string };
export type PivotNode = { id: string; label: string; short: string; guide: string };
export type Edge = { from: string; to: string; label: string; tools: Tool[]; note?: string };
export type PivotData = { nodes: PivotNode[]; edges: Edge[]; toolCount: number };

const MORE: Record<string, string> = {
  name: "names",
  domain: "domains",
  ip: "IP addresses",
  org: "organizations",
  image: "photos or videos",
  account: "accounts",
  repo: "repositories",
  wallet: "wallets",
  location: "places",
};

export const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

export const heading = (n: PivotNode): string => `From ${lowerFirst(n.label)} you can reach`;

export const moreLabel = (n: PivotNode): string => `More ${MORE[n.id] ?? n.short.toLowerCase()}`;

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Points for `count` items spaced evenly round a circle, starting at the top. */
export function ring(
  count: number,
  cx: number,
  cy: number,
  r: number,
): { x: number; y: number; a: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / count;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), a };
  });
}

/** The pivots that leave a node, grouped by where they lead, in first-seen order. */
export function targets(edges: Edge[], id: string): { to: string; tools: string[] }[] {
  const out: { to: string; tools: string[] }[] = [];
  for (const e of edges) {
    if (e.from !== id || e.to === id) continue;
    const found = out.find((x) => x.to === e.to);
    const t = found ?? { to: e.to, tools: [] };
    if (!found) out.push(t);
    for (const tool of e.tools) if (!t.tools.includes(tool.name)) t.tools.push(tool.name);
  }
  return out;
}

/** The trail as plain text, one numbered line per step after the first. */
export function trailText(shorts: string[], tools: string[][]): string {
  return shorts
    .slice(1)
    .map((s, i) => `${i + 1}. ${shorts[i]} -> ${s} (${tools[i + 1]?.join(", ")})`)
    .join("\n");
}
