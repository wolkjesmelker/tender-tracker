import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { resetSupabaseClientCache } from '../db/supabase-client'
import { IPC } from '../../shared/constants'

/**
 * Vul lege app_settings-waarden aan met omgevingsvariabelen uit .env(.local).
 * Dit laat ontwikkelaars lokaal werken zonder sleutels in de Settings-UI in te voeren,
 * terwijl productiegebruikers hun eigen sleutels via Instellingen kunnen opgeven.
 */
function applyEnvFallbacks(settings: Record<string, string>): void {
  const provider = (settings['ai_provider'] || 'openai').trim()

  // Hoofd-AI-sleutel: kies op basis van actieve provider
  if (!settings['ai_api_key']) {
    if ((provider === 'claude' || provider === 'anthropic') && process.env.ANTHROPIC_API_KEY) {
      settings['ai_api_key'] = process.env.ANTHROPIC_API_KEY
    } else if (provider === 'moonshot' && process.env.MOONSHOT_API_KEY) {
      settings['ai_api_key'] = process.env.MOONSHOT_API_KEY
    } else if (provider === 'gemini' && process.env.GEMINI_API_KEY) {
      settings['ai_api_key'] = process.env.GEMINI_API_KEY
    } else if (process.env.OPENAI_API_KEY) {
      settings['ai_api_key'] = process.env.OPENAI_API_KEY
    }
  }

  // Vaste env → settings mappings
  const directMappings: Array<[string, string | undefined]> = [
    ['openai_detection_api_key', process.env.OPENAI_API_KEY],
    ['moonshot_api_key', process.env.MOONSHOT_API_KEY],
    ['moonshot_api_base', process.env.MOONSHOT_BASE_URL],
    ['brave_search_api_key', process.env.BRAVE_SEARCH_API_KEY],
  ]

  for (const [key, envVal] of directMappings) {
    if (!settings[key] && envVal) settings[key] = envVal
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_GET, (_event, key: string) => {
    const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
    const dbValue = row?.value ?? ''
    if (dbValue) return dbValue
    // Env-fallback voor lege DB-waarden
    const tmp: Record<string, string> = { [key]: '' }
    applyEnvFallbacks(tmp)
    return tmp[key] || null
  })

  ipcMain.handle(IPC.SETTINGS_SET, (_event, key: string, value: string) => {
    getDb().prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
    ).run(key, value, value)
    if (key === 'supabase_url' || key === 'supabase_anon_key') {
      resetSupabaseClientCache()
    }
    return { success: true }
  })

  ipcMain.handle(IPC.SETTINGS_GET_ALL, () => {
    const rows = getDb().prepare('SELECT key, value FROM app_settings').all() as { key: string, value: string }[]
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = row.value
    }
    applyEnvFallbacks(settings)
    return settings
  })
}
