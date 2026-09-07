import { SkeletonBlock, SkeletonTable } from "@/components/Skeleton";

// Shared by the stocks list and the ticker detail view (tab switches are
// searchParams navigations on this same route), so the shape stays neutral:
// a heading, a metric strip, one table.
export default function StocksLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-6 w-40" />
        <SkeletonBlock className="h-8 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <SkeletonBlock className="h-3 w-16" />
            <SkeletonBlock className="mt-2 h-5 w-24" />
          </div>
        ))}
      </div>
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
