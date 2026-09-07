// Tab state lives in the URL, not client state: the detail page stays an async
// Server Component, tabs deep-link and survive the back button, and each render
// queries only the active tab's tables.

export const DETAIL_TABS = [
  { id: "overview", label: "Overview" },
  { id: "financials", label: "Financials" },
  { id: "actions", label: "Actions" },
  { id: "history", label: "History" },
] as const;

export type TabId = (typeof DETAIL_TABS)[number]["id"];

/** Never trust the query string: anything unrecognised falls back to overview. */
export function resolveTab(raw: string | undefined): TabId {
  const match = DETAIL_TABS.find((t) => t.id === raw);
  return match ? match.id : "overview";
}
