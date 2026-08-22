import { SkeletonCardRow, SkeletonTable, SkeletonList } from "@/components/Skeleton";

// Dashboard skeleton, mirrors app/page.tsx structure.
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <SkeletonCardRow />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section>
            <h2 className="mb-2 font-semibold text-tprimary">Portfolio</h2>
            <SkeletonTable rows={5} cols={4} />
          </section>
          <section>
            <h2 className="mb-2 font-semibold text-tprimary">Watchlist</h2>
            <SkeletonTable rows={4} cols={4} />
          </section>
        </div>
        <section>
          <h2 className="mb-2 font-semibold text-tprimary">Latest News</h2>
          <SkeletonList rows={6} />
        </section>
      </div>
    </div>
  );
}
