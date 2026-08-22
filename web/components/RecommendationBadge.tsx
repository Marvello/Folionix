import { recGlyph } from "@/lib/format";

export default function RecommendationBadge({ rec }: { rec?: string | null }) {
  const label = (rec || "").toUpperCase().trim();
  if (!label || label === "—") {
    return <span className="text-tdim">—</span>;
  }
  // Insight badge: violet, fencing the model's opinion off from measured fact.
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ai-surface px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.04em] text-ai-bright">
      <span aria-hidden>{recGlyph(rec)}</span>
      {label}
    </span>
  );
}
