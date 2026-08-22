// Brand: currency is always written with an explicit code (`IDR 12,450,000`),
// never a bare symbol, so a multi-currency portfolio is never ambiguous.
export const fmtIdr = (v: number | null | undefined, decimals = 0): string =>
  v == null
    ? "N/A"
    : `IDR ${v.toLocaleString("id-ID", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`;

/** Compact format for small viewports / metric cards (e.g., IDR 1.2B / IDR 450M / IDR 12.5K). */
export function fmtIdrCompact(v: number | null | undefined): string {
  if (v == null) return "N/A";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) {
    return `${sign}IDR ${(abs / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (abs >= 1_000_000_000) {
    return `${sign}IDR ${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}IDR ${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}IDR ${(abs / 1_000).toFixed(1)}K`;
  }
  return fmtIdr(v);
}

/** Format an amount in any currency. IDR uses id-ID locale (1.234.567); others use en-US (1,234.56). */
export function fmtCurrency(
  v: number | null | undefined,
  currency = "IDR",
  decimals?: number,
): string {
  if (v == null) return "N/A";
  const dp = decimals ?? (currency === "IDR" ? 0 : 2);
  const locale = currency === "IDR" ? "id-ID" : "en-US";
  return `${currency} ${v.toLocaleString(locale, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
}

export function fmtWib(dt: string | Date | null | undefined): string {
  if (!dt) return "—";
  const d = typeof dt === "string" ? new Date(dt) : dt;
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(d)
      .replace(",", "") + " WIB"
  );
}

export function fmtWibDate(dt: string | Date | null | undefined): string {
  if (!dt) return "—";
  const d = typeof dt === "string" ? new Date(dt) : dt;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** News older than this is hidden from the feeds (stale RSS lingering in cache). */
export const NEWS_MAX_AGE_DAYS = 30;

/** ISO cutoff for the oldest news to show; use as `.gte("published_at", …)`. */
export function newsCutoffIso(days = NEWS_MAX_AGE_DAYS): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Relative "time ago" for data-freshness tags. Brand: every feed shows its age. */
export function fmtAgo(dt: string | Date | null | undefined): string {
  if (!dt) return "—";
  const d = typeof dt === "string" ? new Date(dt) : dt;
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Directional glyph paired with market color so meaning survives grayscale. */
export function dirGlyph(n: number | null | undefined): string {
  if (n == null || n === 0) return "◆";
  return n > 0 ? "▲" : "▼";
}

/** Newest fetch timestamp across a set of dated rows, for data-freshness tags. */
export function newestFetchedAt(rows: { fetched_at?: string | null }[]): string | null {
  return rows.reduce<string | null>(
    (acc, r) => (r.fetched_at && (!acc || r.fetched_at > acc) ? r.fetched_at : acc),
    null,
  );
}

export interface Pnl {
  pnl: number;
  pnlPct: number;
  totalPnl: number;
  invested: number;
}

export function calcPnl(current: number, avg: number, lots = 0): Pnl {
  const pnl = Math.round(current - avg);
  const pnlPct = avg ? Math.round((pnl / avg) * 100 * 100) / 100 : 0;
  const totalPnl = lots ? Math.round(pnl * lots * 100) : 0;
  const invested = avg && lots ? avg * lots * 100 : 0;
  return { pnl, pnlPct, totalPnl, invested };
}

// A recommendation is the machine's opinion, not market fact, so it wears the
// violet insight-badge (brand: never blend model output into measured fact).
// Direction is carried by a glyph so BUY/HOLD/SELL still scan at a glance and
// survive grayscale, without borrowing the market's gain/loss colors.
export function recGlyph(rec: string | null | undefined): string {
  const r = (rec || "").toUpperCase().trim();
  if (r.includes("BUY") || r.includes("BELI")) return "▲";
  if (r.includes("CUT") || r.includes("JUAL") || r.includes("SELL")) return "▼";
  if (r.includes("HINDARI") || r.includes("AVOID")) return "▼";
  if (r.includes("TUNGGU") || r.includes("HOLD") || r.includes("TAHAN")) return "◆";
  return "◆";
}

/** Strip all HTML tags except b, i, code (ports utils.sanitize_html). */
export function sanitizeHtml(html: string): string {
  return html.replace(/<(?!\/?(?:b|i|code)(?:\s[^>]*)?>)[^>]+>/g, "");
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");

/**
 * RSS summaries often embed a leading <img> tag and HTML entities. Pull out
 * the first http(s) image URL and return the plain-text remainder.
 */
export function parseSummary(html: string): { imageUrl: string | null; text: string } {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  const url = m ? decodeEntities(m[1]) : null;
  const imageUrl = url && /^https?:\/\//i.test(url) ? url : null;
  const text = decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  return { imageUrl, text };
}

/** Canonical stored form of a ticker: yahoo symbol ('BBCA.JK', '^JKSE'). */
export function normalizeTicker(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (t === "IHSG") return "^JKSE";
  if (t.startsWith("^") || t.endsWith(".JK")) return t;
  return `${t}.JK`;
}

/** Display form of a stored yahoo symbol: strip the .JK suffix, ^JKSE → IHSG. */
export function displayTicker(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (t === "^JKSE") return "IHSG";
  return t.replace(/\.JK$/, "");
}
