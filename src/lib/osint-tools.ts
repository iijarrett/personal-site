/**
 * Helpers for the OSINT "All tools" list. The data is a vendored copy of the OSINT Field Guide's
 * tools.json. `rowView` is the only way the page template sees a tool, and for a gated tool it
 * hands over the name, the tier, the link and one fixed line, never anything else the data
 * might carry.
 */

export type Tier = "start" | "deeper" | "gated";
export type OsintTool = {
  id: string;
  name: string;
  section: string;
  tier: Tier;
  url: string;
  kind?: string;
  summary?: string;
  verified?: string;
  reach: string[];
};
export type Section = { id: string; rank: string; title: string };
export type ToolsData = {
  toolCount: number;
  tierCounts: Record<Tier, number>;
  sections: Section[];
  tools: OsintTool[];
};

export const GATED_LINE = "Easy to misuse. Details and cautions are in the guide.";

export type RowView = {
  cost: string;
  name: string;
  tier: Tier;
  url: string;
  text: string;
  gatedLine?: string;
  detail?: string;
  summary?: string | undefined;
  reach?: string[];
};

/** Lower-cased text the search looks in. A gated tool is found by its name alone. */
export const searchText = (t: OsintTool): string =>
  (t.tier === "gated" ? t.name : `${t.name} ${t.summary ?? ""}`).toLowerCase();

export function rowView(t: OsintTool): RowView {
  const base = { name: t.name, tier: t.tier, url: t.url, text: searchText(t), cost: "" };
  if (t.tier === "gated") return { ...base, gatedLine: GATED_LINE };
  const detail = [t.kind, t.verified && `verified ${t.verified}`].filter(Boolean).join(" · ");
  return { ...base, cost: costOf(t.kind), detail, summary: t.summary, reach: t.reach };
}

/** What a tool costs to use, read from its kind line: "free", "account" (a free tier or sign-up), or "". */
export function costOf(kind: string | undefined): string {
  const words = (kind ?? "").split(" \u00b7 ");
  if (words.includes("free")) return "free";
  return words.some(
    (w) => w === "free tier" || w === "free account" || w === "account to see detail",
  )
    ? "account"
    : "";
}

export const COSTS = [
  { id: "free", label: "Free" },
  { id: "account", label: "Free tier or account" },
] as const;

/** The oldest and newest check dates among the open tools, and how many carry one. */
export function checkRange(tools: OsintTool[]): { oldest: string; newest: string; count: number } {
  const dates = tools.flatMap((t) => (t.verified ? [t.verified] : [])).sort();
  return { oldest: dates[0] ?? "", newest: dates[dates.length - 1] ?? "", count: dates.length };
}

export type Filter = { q: string; sec: string; tier: string; cost: string };

export const matches = (
  row: { text: string; sec: string; tier: string; cost?: string },
  f: Filter,
): boolean =>
  (!f.sec || row.sec === f.sec) &&
  (!f.tier || row.tier === f.tier) &&
  (!f.cost || row.cost === f.cost) &&
  (!f.q || row.text.includes(f.q));

export const countLine = (shown: number, total: number): string => `Showing ${shown} of ${total}`;

export const tierName = (tier: Tier): string => tier.charAt(0).toUpperCase() + tier.slice(1);
