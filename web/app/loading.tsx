import { SkeletonBlock, SkeletonCardRow, SkeletonTable, SkeletonList } from "@/components/Skeleton";

// Dashboard skeleton, mirrors app/page.tsx: 5 metric cards, By Product
// (allocation bar + table) beside Activity Calendar + Latest News.
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <SkeletonCardRow count={5} />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-2 font-semibold text-tprimary">By Product</h2>
          <SkeletonBlock className="mb-3 h-2 w-full" />
          <SkeletonTable rows={5} cols={4} />
        </section>
        <section className="space-y-6">
          <div>
            <h2 className="mb-2 font-semibold text-tprimary">Activity Calendar</h2>
            <SkeletonBlock className="h-48 w-full" />
          </div>
          <div>
            <h2 className="mb-2 font-semibold text-tprimary">Latest News</h2>
            <SkeletonList rows={6} />
          </div>
        </section>
      </div>
    </div>
  );
}
