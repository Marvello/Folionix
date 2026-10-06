import { dirGlyph, fmtPctAbs, fmtSigned } from "@/lib/format";

// Market delta cell. Brand: direction is shape + color (▲ gain / ▼ loss amber /
// ◆ flat), always signed, mono tabular — so it survives grayscale. No client
// code, so server and client components share it.
export default function Delta({
  value,
  fmt = fmtPctAbs(),
  paren = false,
  glyph = true,
  empty = "—",
  neutral = false,
  className = "",
}: {
  value: number | null | undefined;
  /** Formats the absolute value; default is a 1-dp percent. */
  fmt?: (n: number) => string;
  /** Wrap in parentheses, for a secondary % beside an amount. */
  paren?: boolean;
  /** Hide the glyph when a sibling Delta in the same cell already shows it. */
  glyph?: boolean;
  empty?: string;
  /** Direction without good/bad colour — e.g. a valuation premium is neither a gain nor a loss. */
  neutral?: boolean;
  className?: string;
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className={`num text-tdim ${className}`}>{empty}</span>;
  }
  const text = fmtSigned(value, fmt);
  const flat = text === fmt(0);
  const color = flat || neutral ? "text-tmuted" : value > 0 ? "text-up" : "text-down";
  return (
    <span className={`num whitespace-nowrap ${color} ${className}`}>
      {glyph && <span aria-hidden>{flat ? "◆" : dirGlyph(value)} </span>}
      {paren ? `(${text})` : text}
    </span>
  );
}
