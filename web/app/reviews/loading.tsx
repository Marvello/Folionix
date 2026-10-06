import { SkeletonBlock, SkeletonTable } from "@/components/Skeleton";

// Reviews skeleton, mirrors app/reviews/page.tsx (heading + table).
export default function ReviewsLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <SkeletonBlock className="h-6 w-48" />
      <SkeletonTable rows={6} cols={6} />
    </div>
  );
}
