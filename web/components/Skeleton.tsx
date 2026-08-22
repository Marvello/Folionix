// Presentational loading placeholders streamed by route `loading.tsx` files
// while server components await Supabase. No data, no client code.

const pulse = "animate-pulse rounded bg-edge";

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`${pulse} ${className}`} />;
}

/** Row of metric cards, mirrors components/MetricCard.tsx layout. */
export function SkeletonCardRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-edge bg-component p-4">
          <SkeletonBlock className="h-3 w-20" />
          <SkeletonBlock className="mt-2 h-6 w-28" />
        </div>
      ))}
    </div>
  );
}

/** Table placeholder, mirrors the <Table> in app/page.tsx and client tables. */
export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left">
          {Array.from({ length: cols }).map((_, i) => (
            <th key={i} className="pb-2">
              <SkeletonBlock className="h-3 w-16" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r} className="border-t border-edge">
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c} className="py-2 pr-2">
                <SkeletonBlock className="h-4 w-full max-w-[8rem]" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Vertical list placeholder, mirrors the news list (headline + meta line). */
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i}>
          <SkeletonBlock className="h-4 w-full max-w-[16rem]" />
          <SkeletonBlock className="mt-1 h-3 w-32" />
        </li>
      ))}
    </ul>
  );
}
