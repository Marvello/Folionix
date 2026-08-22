"use client";

import { useState } from "react";

export default function MetricCard({
  label,
  value,
  fullValue,
  color,
  glyph,
  sub,
}: {
  label: string;
  value: string;
  fullValue?: string;
  color?: "up" | "down";
  glyph?: string;
  sub?: string;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  const valueColor =
    color === "up" ? "text-up" : color === "down" ? "text-down" : "text-tprimary";
  const subColor =
    color === "up" ? "text-up" : color === "down" ? "text-down" : "text-tdim";

  const hasTooltip = Boolean(fullValue && fullValue !== value);

  return (
    <div
      className="group relative min-w-0 rounded-lg border border-edge bg-component p-3.5 sm:p-4 transition-colors hover:border-edge-hover"
      title={fullValue || value}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => setShowTooltip((v) => !v)}
    >
      {hasTooltip && (
        <div
          className={`pointer-events-none absolute -top-10 left-1/2 z-30 -translate-x-1/2 transition-all duration-150 ${
            showTooltip ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
        >
          <div className="num whitespace-nowrap rounded-md border border-edge bg-page px-2.5 py-1 text-xs font-semibold text-tprimary shadow-xl">
            {fullValue}
          </div>
        </div>
      )}
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-tdim">{label}</div>
      <div
        className={`num mt-1.5 flex min-w-0 flex-wrap items-baseline gap-1 text-base font-semibold leading-snug tracking-tight sm:text-xl md:text-2xl ${valueColor}`}
      >
        {glyph && <span className="shrink-0 text-xs leading-none sm:text-sm">{glyph}</span>}
        <span className="min-w-0 whitespace-nowrap sm:whitespace-normal sm:break-all">{value}</span>
      </div>
      {sub && <div className={`num mt-1.5 text-[11px] leading-normal break-words sm:text-xs ${subColor}`}>{sub}</div>}
    </div>
  );
}
