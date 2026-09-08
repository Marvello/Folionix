"use client";

import { useEffect } from "react";

// Convention: the real error is logged, never rendered. A failed query here is
// almost always Postgres being unreachable, and its message would carry the
// connection string.
export default function StocksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[stocks]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="text-sm text-tprimary">Could not load stock data.</p>
      <p className="text-xs text-tdim">
        The market database did not respond. Nothing was changed.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-btn px-3 py-1.5 text-sm font-semibold text-page"
      >
        Try again
      </button>
    </div>
  );
}
