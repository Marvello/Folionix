import type { SortState } from "@/lib/useSort";

// Sortable column header: a real <button> inside the <th> (keyboard + screen
// reader reachable) and aria-sort on the active column.
export default function SortTh({
  col,
  label,
  sort,
  onSort,
  className = "",
  title,
}: {
  col: string;
  label: string;
  sort: SortState;
  onSort: (col: string) => void;
  className?: string;
  title?: string;
}) {
  const active = sort.col === col;
  return (
    <th
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
      className={`pb-2 ${className}`}
      title={title}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`select-none hover:text-tprimary ${active ? "text-tprimary" : ""}`}
      >
        {label}
        <span aria-hidden>{active ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}</span>
      </button>
    </th>
  );
}
