// In-memory login throttle: after MAX failures inside WINDOW, a key (email or IP)
// is locked for LOCK. ponytail: per-process memory — fine for the single web
// replica; move to a Postgres table if the web tier ever scales out.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;

type Entry = { failures: number; first: number; lockedUntil: number };
const entries = new Map<string, Entry>();

export function isLocked(key: string, now = Date.now()): boolean {
  return (entries.get(key)?.lockedUntil ?? 0) > now;
}

export function recordFailure(key: string, now = Date.now()): void {
  const e = entries.get(key);
  const fresh = !e || now - e.first > WINDOW_MS;
  const next = fresh ? { failures: 1, first: now, lockedUntil: 0 } : { ...e, failures: e.failures + 1 };
  if (next.failures >= MAX_FAILURES) next.lockedUntil = now + LOCK_MS;
  entries.set(key, next);
  if (entries.size > 10_000) entries.delete(entries.keys().next().value!); // bound memory
}

export function clearFailures(key: string): void {
  entries.delete(key);
}
