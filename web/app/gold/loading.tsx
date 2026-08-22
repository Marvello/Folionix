import { SkeletonBlock, SkeletonTable } from "@/components/Skeleton";

// Gold skeleton, mirrors components/GoldClient.tsx (heading + table).
export default function GoldLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-6 w-40" />
        <SkeletonBlock className="h-8 w-28" />
      </div>
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
