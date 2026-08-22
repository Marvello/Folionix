"use client";

// Deploy version shown in the sidebar footer. Prefers the git SHA + build date
// baked into the image at build time (NEXT_PUBLIC_GIT_SHA / NEXT_PUBLIC_BUILD_DATE),
// falling back to NEXT_PUBLIC_APP_VERSION (the deploy tag) when unset — e.g. a
// bare `latest` deploy or local dev. Mirrors the Telegram bot's version banner.
const REPO_URL = "https://github.com/Marvello/Folionix";

const env = (key: string): string =>
  (typeof window !== "undefined" ? (window as unknown as Record<string, unknown>).__ENV as Record<string, string> | undefined : undefined)?.[key] ?? "";

/** "2026-07-20T07:41:00Z" → "20 Jul 2026". Empty on unparseable/missing. */
function fmtBuildDate(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function Version() {
  const sha = env("NEXT_PUBLIC_GIT_SHA");
  const buildDate = fmtBuildDate(env("NEXT_PUBLIC_BUILD_DATE"));
  const isSha = /^[0-9a-f]{7,40}$/i.test(sha);

  // Fall back to the deploy tag when no SHA was baked in.
  const raw = isSha ? sha : env("NEXT_PUBLIC_APP_VERSION");
  if (!raw) return null;

  const short = raw.length > 7 ? raw.slice(0, 7) : raw;
  const label = `v${short}`;

  return (
    <p className="mt-3 px-3 text-xs text-tdim" title={buildDate ? `Built ${buildDate}` : undefined}>
      {isSha ? (
        <a
          href={`${REPO_URL}/commit/${sha}`}
          target="_blank"
          rel="noreferrer"
          className="hover:text-tmuted"
        >
          {label}
        </a>
      ) : (
        label
      )}
      {buildDate && <span className="text-tdim"> · {buildDate}</span>}
    </p>
  );
}
