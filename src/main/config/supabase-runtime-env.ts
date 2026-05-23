import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import log from 'electron-log'

const URL_KEY = 'NEXT_PUBLIC_SUPABASE_URL'
const ANON_KEY = 'NEXT_PUBLIC_SUPABASE_ANON_KEY'

/** Env-sleutels die direct worden doorgeschreven naar process.env (naast Supabase). */
const EXTRA_ENV_KEYS = [
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'MOONSHOT_API_KEY',
  'MOONSHOT_BASE_URL',
  'BRAVE_SEARCH_API_KEY',
  'LICENSE_SERVER_URL',
  'LICENSE_PRODUCT_KEY',
] as const

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (k) out[k] = v
  }
  return out
}

function readEnvFile(file: string): Record<string, string> | null {
  try {
    if (!fs.existsSync(file)) return null
    return parseEnvFile(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    log.debug(`[supabase-env] ${file}:`, e)
    return null
  }
}

/**
 * Vult `process.env` met Supabase-keys uit `.env`-achtige bestanden, zodat de geïnstalleerde app
 * (inclusief bestanden uit de DMG) geen lege Vite-`define` hoeft: plaats `supabase.env` in
 * Application Support, of houd lokaal `tender-tracker/.env` bij ontwikkel-bouws.
 * Laatste kandidaten in de lijst hebben voorrang (Application Support wint dus over monorepo).
 */
export function loadSupabaseRuntimeEnv(): void {
  const mainDir = __dirname
  const candidates: string[] = [
    path.join(mainDir, '../../../.env'),
    path.join(mainDir, '../../../.env.local'),
    path.join(mainDir, '../../.env'),
    path.join(mainDir, '../../.env.local'),
  ]
  try {
    const ad = app.getPath('appData')
    const ud = app.getPath('userData')
    candidates.push(
      path.join(ad, 'tender-tracker', '.env'),
      path.join(ad, 'tender-tracker', 'supabase.env'),
      path.join(ad, 'TenderTracker', '.env'),
      path.join(ad, 'TenderTracker', 'supabase.env'),
      path.join(ud, '.env'),
      path.join(ud, 'supabase.env'),
    )
  } catch (e) {
    log.debug('[supabase-env] getPath appData/userData:', e)
  }

  for (const p of candidates) {
    const data = readEnvFile(p)
    if (!data) continue
    let loaded = false
    // Supabase (met korte aliasnamen)
    if (data[URL_KEY]) { process.env[URL_KEY] = data[URL_KEY]!; loaded = true }
    if (data[ANON_KEY]) { process.env[ANON_KEY] = data[ANON_KEY]!; loaded = true }
    if (data.SUPABASE_URL) { process.env.SUPABASE_URL = data.SUPABASE_URL; loaded = true }
    if (data.SUPABASE_ANON_KEY) { process.env.SUPABASE_ANON_KEY = data.SUPABASE_ANON_KEY; loaded = true }
    // Overige API-sleutels (AI-providers, licentie, zoeken)
    for (const key of EXTRA_ENV_KEYS) {
      if (data[key]) { process.env[key] = data[key]!; loaded = true }
    }
    if (loaded) log.info(`[runtime-env] Ingelezen: ${p}`)
  }
}
