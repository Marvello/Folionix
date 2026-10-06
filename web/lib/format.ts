// Brand: currency is always written with an explicit code (`IDR 12,450,000`),
// never a bare symbol, so a multi-currency portfolio is never ambiguous. One
// locale (en-US: comma thousands, dot decimals) for every money, count and
// percent figure, and the sign always leads the code (`-IDR 1,234`).
const LOCALE = "en-US";

/** Plain number in the app locale (lots, grams, units). */
export const fmtNum = (v: number, maxDecimals = 0): string =>
  v.toLocaleString(LOCALE, { maximumFractionDigits: maxDecimals });

/** Format an amount in any currency; IDR defaults to 0 dp, others to 2. */
export function fmtCurrency(
  v: number | null | undefined,
  currency = "IDR",
  decimals?: number,
): string {
  if (v == null) return "N/A";
  const dp = decimals ?? (currency === "IDR" ? 0 : 2);
  const body = Math.abs(v).toLocaleString(LOCALE, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  return `${v < 0 ? "-" : ""}${currency} ${body}`;
}

export const fmtIdr = (v: number | null | undefined, decimals = 0): string =>
  fmtCurrency(v, "IDR", decimals);

/**
 * Compact format for small viewports / metric cards (e.g., IDR 1.2B / IDR 450M
 * / IDR 12.5K). Pass an empty prefix for a plain count (shares, not money);
 * that is the only difference, so there is one function rather than two.
 */
export function fmtIdrCompact(v: number | null | undefined, prefix = "IDR "): string {
  if (v == null) return "N/A";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) {
    return `${sign}${prefix}${(abs / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (abs >= 1_000_000_000) {
    return `${sign}${prefix}${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${prefix}${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${prefix}${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}${prefix}${abs.toLocaleString(LOCALE)}`;
}

/** Percent with a fixed number of decimals, no sign handling. */
export const fmtPctAbs = (dp = 1) => (v: number): string => `${v.toFixed(dp)}%`;

/**
 * Explicit sign for a delta: `+IDR 1,234`, `-IDR 1,234`, `+2.5%`. A value that
 * renders as zero (incl. -0.4 at 0 dp) gets no sign. `fmt` formats the
 * absolute value, so every formatter above composes with it.
 */
export function fmtSigned(v: number, fmt: (n: number) => string = fmtPctAbs()): string {
  const body = fmt(Math.abs(v));
  if (body === fmt(0)) return body;
  return `${v < 0 ? "-" : "+"}${body}`;
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

/**
 * Today's calendar date in WIB as YYYY-MM-DD, for comparing against a plain
 * `date` column. `toISOString().slice(0, 10)` is the UTC date, which is a day
 * behind between 00:00 and 07:00 WIB.
 */
export function wibDateKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(d);
}

/** News older than this is hidden from the feeds (stale RSS lingering in cache). */
export const NEWS_MAX_AGE_DAYS = 30;

/** ISO cutoff for the oldest news to show; use as `.gte("published_at", …)`. */
export function newsCutoffIso(days = NEWS_MAX_AGE_DAYS): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** True when `dt` is older than `maxAgeMs`. Pairs with fmtAgo on freshness tags;
 *  the clock read lives here so (server) component renders stay lint-pure. */
export function isStale(dt: string | Date, maxAgeMs: number): boolean {
  return Date.now() - new Date(dt).getTime() > maxAgeMs;
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
/** Gain/loss tone for a card; flat (0) stays neutral, matching dirGlyph's ◆. */
export function tone(n: number | null | undefined): "up" | "down" | undefined {
  if (n == null || isFlat(n)) return undefined;
  return n > 0 ? "up" : "down";
}

/** Rounds to zero on screen (whole-rupiah cards): float residue like 1e-9 must read flat, not ▲. */
const isFlat = (n: number): boolean => Math.abs(n) < 0.5;

export function dirGlyph(n: number | null | undefined): string {
  if (n == null || isFlat(n)) return "◆";
  return n > 0 ? "▲" : "▼";
}

/** Newest fetch timestamp across a set of dated rows, for data-freshness tags. */
export function newestFetchedAt(rows: { fetched_at?: string | null }[]): string | null {
  return rows.reduce<string | null>(
    (acc, r) => (r.fetched_at && (!acc || r.fetched_at > acc) ? r.fetched_at : acc),
    null,
  );
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
