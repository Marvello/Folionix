import { SkeletonProductPage } from "@/components/Skeleton";

export default function BondsLoading() {
  return <SkeletonProductPage cards={3} cols={7} />;
}
