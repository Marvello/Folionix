---
type: design-system
title: Folionix Design System
name: Folionix
description: Self-hosted observability for personal wealth. The Grafana of net worth.
colors:
  # Canvas
  background: "#0B1120"
  surface: "#16202F"
  surface-container: "#1B2738"
  surface-container-high: "#222E40"
  outline: "#1E293B"
  outline-variant: "#334155"
  # Brand
  primary: "#2DD4BF"
  on-primary: "#0B1120"
  primary-container: "#134E4A"
  on-primary-container: "#5EEAD4"
  # Text
  on-background: "#E2E8F0"
  on-surface: "#E2E8F0"
  on-surface-variant: "#94A3B8"
  ink: "#0F172A"
  # Market semantics
  gain: "#34D399"
  loss: "#F59E0B"
  critical: "#EF4444"
  on-critical: "#2E0505"
  # Machine
  signal: "#8B5CF6"
  on-signal: "#1E1B4B"
  signal-bright: "#A78BFA"
typography:
  display-lg:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: "500"
    lineHeight: 52px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 28px
    fontWeight: "500"
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: "600"
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: "400"
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: "600"
    lineHeight: 16px
    letterSpacing: 0.04em
  data-lg:
    fontFamily: JetBrains Mono
    fontSize: 28px
    fontWeight: "500"
    lineHeight: 34px
    fontFeature: "tnum"
  data-md:
    fontFamily: JetBrains Mono
    fontSize: 15px
    fontWeight: "400"
    lineHeight: 20px
    fontFeature: "tnum"
  data-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: "400"
    lineHeight: 16px
    fontFeature: "tnum"
rounded:
  sm: 4px
  DEFAULT: 8px
  md: 8px
  lg: 12px
  full: 9999px
spacing:
  unit: 8px
  card-padding: 16px
  container-padding: 24px
  section-margin: 40px
motion:
  feedback: 120ms
  content: 220ms
  easing: "cubic-bezier(0.2, 0, 0, 1)"
components:
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.card-padding}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: 0 20px
  button-primary-hover:
    backgroundColor: "{colors.on-primary-container}"
  button-ghost:
    backgroundColor: "#16332F"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
  value-positive:
    textColor: "{colors.gain}"
    typography: "{typography.data-md}"
  value-negative:
    textColor: "{colors.loss}"
    typography: "{typography.data-md}"
  insight-badge:
    backgroundColor: "#23243F"
    textColor: "{colors.signal-bright}"
    rounded: "{rounded.full}"
    typography: "{typography.label-sm}"
    padding: 2px 10px
  alert-critical:
    backgroundColor: "{colors.critical}"
    textColor: "{colors.on-critical}"
    rounded: "{rounded.sm}"
    typography: "{typography.label-sm}"
    padding: 4px 10px
  export-surface:
    backgroundColor: "#FFFFFF"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "{spacing.card-padding}"
  dialog-scrim:
    backgroundColor: "{colors.background}"
    opacity: "0.80"
  dialog-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    border: "1px {colors.outline}"
    rounded: "{rounded.lg}"
    padding: "{spacing.card-padding}"
    maxWidth: 512px
---

## Overview

Folionix is a self-hosted observability console for personal wealth — the kind of dashboard a sysadmin would build to watch a server, pointed instead at a portfolio. The reference is a **dark Grafana board at midnight in an observatory**: monitors glowing softly, everything under watch, nothing demanding attention until it must.

The audience is technical and private — someone who runs their own homelab and wants their financial data to live on their own infrastructure. The interface assumes fluency in CLIs, APIs, and containers. It speaks in an engineer's logbook register: declarative, terse, numbers first. It is not a trading app and carries none of that genre's urgency, confetti, or red-and-green adrenaline. The feeling to produce is *knowing* rather than *checking*.

The product's job is to surface signal and suppress noise. Every pixel earns its place. The design is dense but never anxious.

## Colors

A dark-first system organized by **who is speaking**: the product, the market, or the machine. Color is meaning, never decoration.

- **Background** {colors.background} is the midnight canvas — a deep blue-black, never pure black. **Surface** {colors.surface} lifts cards a single step above it; elevation is communicated by these flat tonal steps, not by shadow.
- **Primary** {colors.primary} — "Folio Teal" — is the product's own voice. It marks the logo, links, focus rings, and primary actions. It is the *only* color used for brand identity and never stands in for a market state.
- **Gain** {colors.gain} and **Loss** {colors.loss} are the market speaking. Loss is deliberately **amber, not red** — a portfolio dip is information, not an emergency. Reserve true alarm for true system failure.
- **Critical** {colors.critical} is the only red in the system. It appears exclusively for system errors and breached user-set thresholds — a failed sync, a stale feed — never for an ordinary down day.
- **Signal** {colors.signal} — violet — is the machine's voice. Anything model-generated (projections, insights, anomaly flags) wears violet so the user can always tell a fact from an opinion.
- **On-surface** {colors.on-surface} carries primary text; **on-surface-variant** {colors.on-surface-variant} handles metadata, captions, and unchanged values.

## Typography

Three families, each with one job. The split between **structure** (Space Grotesk), **interface** (Inter), and **data** (JetBrains Mono) is the typographic spine of the brand.

- **Space Grotesk** sets display and headline roles {typography.display-lg}, {typography.headline-lg}. Its geometric, slightly mechanical character gives the product its technical signature.
- **Inter** is the UI workhorse for labels, body, and controls {typography.body-md}, {typography.headline-md}. It disappears, which is the point.
- **JetBrains Mono** renders **every financial figure, without exception** {typography.data-lg}, {typography.data-md}. Tabular numerals (`tnum`) are mandatory so digits align in columns and the eye can scan a ledger vertically. A number in a proportional font is a bug.
- Currency is always written with an explicit code — `IDR 12,450,000`, never a bare symbol — so a multi-currency portfolio is never ambiguous.

## Layout

An 8px grid governs all spacing {spacing.unit}. The density target sits closer to a terminal than a marketing page: tight, information-rich, but with deliberate breathing room between logical groups.

- Cards group related metrics and use {spacing.card-padding} internal padding; sections are separated by {spacing.section-margin}.
- Prefer **sparklines inline** within list rows over full charts. A row should communicate trend at a glance without the user opening anything.
- One screen answers one question. Resist the dashboard reflex to show everything; show what is moving.

## Elevation & Depth

Depth is tonal, not cast. The interface is flat by conviction — it reads as instrumentation, not as paper floating in space.

- Surfaces step up through lightness ({colors.surface} → {colors.surface-container} → {colors.surface-container-high}), never through drop shadows.
- Borders are hairline {colors.outline} at 1px. They define edges where a tonal step alone is too subtle.
- There is no glassmorphism, no glow, no blur. The only thing that "lights up" is Folio Teal on a focus or active state.

## Shapes

Geometry is calm and consistent. Cards and inputs use {rounded.md}; small controls and buttons use {rounded.sm}; only pills and the avatar-class elements go {rounded.full}.

- The brand's signature shape is the **pointy-top hexagon** of the logo monogram — a nod to containers and infrastructure. It appears in the mark and may echo as a loading or empty-state motif, but never as decorative chrome scattered through the UI.
- Iconography is line-based, 1.5px stroke, rounded caps (Lucide-compatible). Financial direction always pairs **shape with color** (▲ ▼ ◆) so meaning survives grayscale and colorblindness.

## Components

- **Card** {components.card} is the atomic unit — a flat surface holding one metric group, hairline-bordered, no shadow.
- **Primary button** {components.button-primary} is solid Folio Teal with near-black text; it is the only solidly teal-filled element, which keeps the brand color scarce and meaningful. **Ghost buttons** {components.button-ghost} carry secondary actions.
- **Value cells** {components.value-positive} / {components.value-negative} are mono, color-coded to market semantics, and always paired with a directional glyph.
- **Insight badge** {components.insight-badge} is the violet wrapper for anything the machine generated. It must visually fence model output off from measured fact.
- **Timestamps are a component, not an afterthought.** Every data surface shows freshness ("synced 2 min ago", "price delayed 15 min · yahoo-finance2"). Honesty about latency is a feature.
- **Dialogs handle all create/edit.** Every add or edit flow opens a centered **modal** — a flat surface panel {components.dialog-panel} over a solid dark scrim {components.dialog-scrim} (a tonal wash of the canvas, **never a blur** — there is no glassmorphism). The panel carries a title and a close (✕), closes on Escape or scrim-click, locks background scroll, and moves focus inside on open / restores it on close. Inline forms wedged between table rows are not used; mutation is always a deliberate, focused moment. The scrim fades at {motion.feedback}, the panel rises at {motion.content}, both on {motion.easing}, and both collapse to instant under `prefers-reduced-motion`.

## Motion

Transitions are quick and mechanical. Nothing bounces, overshoots, or lingers — state changes feel like a switch, not a flourish.

- Interactive feedback (hover, press, toggle): {motion.feedback}, always {motion.easing}.
- Content transitions (panel, route, modal): {motion.content}, same curve.
- Nothing animates past 300ms. Respect `prefers-reduced-motion`: all durations collapse to 0ms.
- Live data updates by quiet value-swap or a brief teal pulse — never a flashing row or a sliding banner.

## Do's and Don'ts

- **Do** treat dark mode as the brand's native state, not a toggle. Folionix is a dark instrument; a light theme is a printed export, not the identity.
- **Do** render every number in JetBrains Mono with tabular figures. Columns of money must align to the digit.
- **Do** keep Folio Teal scarce. It belongs to the product's voice — logo, links, focus, primary action — and nowhere else.
- **Do** show data freshness everywhere. A timestamp or source tag on every feed is non-negotiable.
- **Do** pair color with shape for every market signal, so the meaning survives grayscale.
- **Don't** use red for a down day. Losses are amber; red is reserved for a broken system.
- **Don't** blend model output into measured fact. AI insights always wear the violet {colors.signal} badge.
- **Don't** add glow, gradients, glass, or drop shadows. Depth comes from flat tonal steps and hairline borders.
- **Don't** use exclamation marks, emoji, or hype in UI copy. The register is an engineer's logbook, not a trading-app push notification.
- **Don't** imply real-time when data is delayed. State the delay plainly.
- **Don't** scatter the hexagon as ornament. It is the mark; in the UI it earns its place once or not at all.
- **Don't** reach for pie charts. Use horizontal stacked bars or treemaps for allocation.

---

## Data Tables — Row Height Standard

**Invariant: every data row in every table must render at the same height.**
The root cause of height variance is block-level (`<div>`) content inside a `<td>` — it stacks vertically, inflating that row. All multi-value cells must use inline `<span>` elements.

### Skeleton

```tsx
<div className="hidden overflow-x-auto md:block">
  <table className="w-full min-w-[Xrem] text-sm">
    <thead>
      <tr className="text-xs font-semibold text-tdim">
        <th className="pb-2 pr-4 text-left">LABEL</th>     {/* text col */}
        <th className="pb-2 pr-4 text-right">LABEL</th>    {/* numeric col */}
        <th className="pb-2"></th>                         {/* action col — no pr-4 */}
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.id} className="border-t border-edge">
          <td className="py-2 pr-4">…</td>                 {/* text cell */}
          <td className="num py-2 pr-4 text-right">…</td>  {/* numeric cell */}
          <td className="py-2 text-right">…</td>           {/* action cell — no pr-4 */}
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

### Rules

| Rule | Detail |
|---|---|
| `py-2` on every `<td>` | Enforces uniform row height — no exceptions |
| `pr-4` on every `<td>` | Except the last (action) column |
| `num` class on every financial figure | Monospace + tabular-nums alignment |
| `whitespace-nowrap` on combined cells | Prevents line-wrap from inflating row height |
| Mobile: card layout | All desktop tables are `hidden md:block`; mobile uses `md:hidden` card grid |

### Multi-value cells

Never stack `<div>` inside a `<td>`. Use inline `<span>` elements.

```tsx
{/* ✗ WRONG — stacked divs inflate row height */}
<td className="num py-2 pr-4 text-right">
  <div className="text-up">{fmtIdr(pnl)}</div>
  <div className="text-xs text-up">(+2.5%)</div>
</td>

{/* ✓ CORRECT — inline spans, single line */}
<td className="num whitespace-nowrap py-2 pr-4 text-right">
  <span className="text-up">{fmtIdr(pnl)}</span>
  <span className="ml-1 text-xs text-up">(+2.5%)</span>
</td>
```

This rule applies to every table: Portfolio, Watchlist (now merged under `/stocks`), Gold, Funds, Bonds, and the dashboard By Product table.

---

## Navigation

Single-level flat nav — no groups, no collapsible sections:

| Label | Route |
|---|---|
| Dashboard | `/` |
| Stocks | `/stocks` (Portfolio + Watchlist merged) |
| Gold | `/gold` |
| Funds | `/funds` |
| Bonds | `/bonds` |
| News | `/news` |

Ticker detail lives at `/stocks?ticker=BBCA`. `TickerDetail` takes `backHref="/stocks"`.

---

## Product Allocation Colors

Used in the dashboard By Product bar chart and table dots. Always applied via `style={{ backgroundColor: hex }}` (not dynamic Tailwind classes, which get purged).

| Product | Hex |
|---|---|
| Stocks | `#22d3ee` |
| Gold | `#fbbf24` |
| Bonds | `#a78bfa` |
| Funds | `#34d399` |