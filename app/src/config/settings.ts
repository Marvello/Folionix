// app/src/config/settings.ts
// Overlays rows from public.app_settings onto process.env so every existing
// `process.env.X` read picks up dashboard edits without a restart. Only keys in
// the lib/settings.ts whitelist are applied, and each is re-validated.
import { getPool } from '../db/db'
import { SETTING_KEYS, validateSetting } from '../../../lib/settings'

const SYNC_MS = 60_000

// .env values as they were at boot, so deleting a DB row restores them.
const bootEnv: Record<string, string | undefined> = {}
for (const k of SETTING_KEYS) bootEnv[k] = process.env[k]

/** Pure overlay: DB value if valid, else the boot .env value (unset if none). */
export function applySettings(rows: { key: string; value: string }[], env: NodeJS.ProcessEnv = process.env): void {
  const db = new Map<string, string>()
  for (const r of rows) {
    if (!SETTING_KEYS.has(r.key)) continue
    try {
      db.set(r.key, validateSetting(r.key, r.value))
    } catch (err) {
      console.warn(`[settings] ignoring invalid ${r.key}="${r.value}": ${(err as Error).message}`)
    }
  }
  for (const k of SETTING_KEYS) {
    const v = db.get(k) ?? bootEnv[k]
    if (v === undefined) delete env[k]
    else env[k] = v
  }
}

export async function syncSettings(): Promise<void> {
  try {
    const { rows } = await getPool().query<{ key: string; value: string }>('SELECT key, value FROM app_settings')
    applySettings(rows)
  } catch (err) {
    // Keep the last applied values; a DB blip must not reset settings to .env.
    console.error('[settings] sync failed, keeping current values:', (err as Error).message)
  }
}

/** Apply once now, then re-sync every minute for the life of the process. */
export async function startSettingsSync(): Promise<void> {
  await syncSettings()
  setInterval(() => void syncSettings(), SYNC_MS).unref()
}
