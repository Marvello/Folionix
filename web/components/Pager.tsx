"use client";

// Prev / "Page x of y" / Next control. Renders nothing when there's a single
// page. Styling mirrors the schedule pager in BondsClient.
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
      <button
        onClick={onPrev}
        disabled={page <= 1}
        className="rounded-md border border-edge px-2.5 py-1 text-tmuted disabled:cursor-not-allowed disabled:opacity-40"
      >
        Prev
      </button>
      <span>Page {page} of {totalPages}</span>
      <button
        onClick={onNext}
        disabled={page >= totalPages}
        className="rounded-md border border-edge px-2.5 py-1 text-tmuted disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
