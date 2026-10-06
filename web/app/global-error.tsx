"use client";

import { useEffect } from "react";
import "./globals.css";

// Replaces the root layout when the layout itself throws, so it renders its
// own document. Same rule as app/error.tsx: never render error.message.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[global]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-full">
        <title>Folionix · Error</title>
        <main role="alert" className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
          <h1 className="text-lg font-medium text-tprimary">Folionix could not start this page.</h1>
          <p className="text-sm text-tmuted">Nothing was changed. Try again in a moment.</p>
          {error.digest && <p className="num text-caption text-tdim">ref {error.digest}</p>}
          <button
            type="button"
            onClick={retry}
            className="inline-flex h-10 items-center rounded-sm bg-btn px-5 text-xs font-semibold tracking-[0.04em] text-page hover:bg-btn-hover"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
