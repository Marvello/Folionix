"use client";

import { SecondaryButton } from "@/components/Form";

// Prev / "Page x of y" / Next control. Renders nothing when there's a single
// page.
export default function Pager({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-tdim">
      <SecondaryButton size="sm" onClick={onPrev} disabled={page <= 1}>
        Prev
      </SecondaryButton>
      <span>Page {page} of {totalPages}</span>
      <SecondaryButton size="sm" onClick={onNext} disabled={page >= totalPages}>
        Next
      </SecondaryButton>
    </div>
  );
}
