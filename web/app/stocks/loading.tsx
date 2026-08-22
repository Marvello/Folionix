import { SkeletonBlock, SkeletonTable } from "@/components/Skeleton";

export default function StocksLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SkeletonBlock className="h-6 w-40" />
          <SkeletonBlock className="h-8 w-28" />
        </div>
        <SkeletonTable rows={6} cols={5} />
      </div>
      <div className="space-y-4">
        <SkeletonBlock className="h-6 w-36" />
        <SkeletonTable rows={5} cols={4} />
      </div>
    </div>
  );
}
