import { readFileSync, writeFileSync } from 'node:fs'

// Liveness for the long-running loops (runner, worker), which serve no HTTP.
// Each loop iteration stamps a file; the k8s/compose probe fails when the stamp
// goes stale, so a process that is alive but stuck gets restarted.
export const HEARTBEAT_FILE = process.env.HEARTBEAT_FILE ?? '/tmp/folionix-heartbeat'

export function beat(): void {
  try {
    writeFileSync(HEARTBEAT_FILE, String(Date.now()))
  } catch (err) {
    console.warn('[heartbeat] write failed:', err instanceof Error ? err.message : err)
  }
}

/** Probe entry: `node dist/utils/heartbeat.js 1800` exits 1 when older than N seconds. */
export function isFresh(maxAgeSec: number, now = Date.now()): boolean {
  try {
    return now - Number(readFileSync(HEARTBEAT_FILE, 'utf8')) < maxAgeSec * 1000
  } catch {
    return false
  }
}

if (process.argv[1]?.endsWith('heartbeat.js') || process.argv[1]?.endsWith('heartbeat.ts')) {
  process.exit(isFresh(Number(process.argv[2]) || 1800) ? 0 : 1)
}
