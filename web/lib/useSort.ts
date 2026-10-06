import { useState } from "react";

export type SortDir = "asc" | "desc";
export type SortState = { col: string; dir: SortDir };

/** Clicking the active column flips it; a new column starts desc, or asc for text columns in `ascFirst`. */
export function nextSort(s: SortState, col: string, ascFirst: readonly string[] = []): SortState {
  if (s.col === col) return { col, dir: s.dir === "asc" ? "desc" : "asc" };
  return { col, dir: ascFirst.includes(col) ? "asc" : "desc" };
}

/** Comparator for mixed string/number sort keys; null sorts as -Infinity / "". */
export function compareBy(a: number | string | null, b: number | string | null, dir: SortDir): number {
  const m = dir === "asc" ? 1 : -1;
  if (typeof a === "string" || typeof b === "string") return m * String(a ?? "").localeCompare(String(b ?? ""));
  return m * ((a ?? -Infinity) - (b ?? -Infinity) || 0);
}

export function useSort(initial: SortState, ascFirst: readonly string[] = []) {
  const [sort, setSort] = useState(initial);
  return { sort, toggle: (col: string) => setSort((s) => nextSort(s, col, ascFirst)) };
}
