import { useState } from "react";

// Client-side pagination over an already-fetched array. Returns the current
// page's slice plus clamped page state, so deleting rows never strands you on
// an empty page. Default 20 rows/page.
export function usePaged<T>(items: T[], size = 20) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, totalPages); // clamp when the list shrinks
  const pageItems = items.slice((current - 1) * size, current * size);
  return { page: current, setPage, totalPages, pageItems };
}
