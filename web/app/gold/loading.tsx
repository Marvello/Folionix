import { SkeletonProductPage } from "@/components/Skeleton";

// Gold skeleton, mirrors components/GoldClient.tsx (heading, cards, table).
export default function GoldLoading() {
  return <SkeletonProductPage cards={5} cols={7} />;
}
