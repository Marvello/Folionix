import { SkeletonBlock, SkeletonList } from "@/components/Skeleton";

// News skeleton, mirrors components/NewsList.tsx (heading + filter + list).
export default function NewsLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-6 w-32" />
        <SkeletonBlock className="h-9 w-40" />
      </div>
      <SkeletonList rows={8} />
    </div>
  );
}
