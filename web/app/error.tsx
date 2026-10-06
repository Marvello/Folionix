"use client";

import { useEffect } from "react";

// Root error boundary for every route segment. Convention: the real error is
// logged, never rendered — a failed query is almost always Postgres being
// unreachable, and its message could carry the connection string.
export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[route]", error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
      <h1 className="text-lg font-medium text-tprimary">Could not load this page.</h1>
      <p className="text-sm text-tmuted">The database did not respond. Nothing was changed.</p>
      {error.digest && <p className="num text-caption text-tdim">ref {error.digest}</p>}
      <button
        type="button"
        onClick={retry}
        className="inline-flex h-10 items-center rounded-sm bg-btn px-5 text-xs font-semibold tracking-[0.04em] text-page hover:bg-btn-hover"
      >
        Try again
      </button>
    </div>
  );
}
