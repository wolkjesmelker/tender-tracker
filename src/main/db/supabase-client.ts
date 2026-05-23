import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js'
import log from 'electron-log'
import { getDb } from './connection'

// Build-time constants injected by Vite from .env.local
declare const __SUPABASE_URL__: string
declare const __SUPABASE_ANON_KEY__: string

let _client: SupabaseClient | null = null

function readFromAppSettings(): { url: string; key: string } {
  try {
    const db = getDb()
    const u = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('supabase_url') as
      | { value: string }
      | undefined
    const k = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('supabase_anon_key') as
      | { value: string }
      | undefined
    return { url: (u?.value ?? '').trim(), key: (k?.value ?? '').trim() }
  } catch {
    return { url: '', key: '' }
  }
}

function fromProcessEnv(): { url: string; key: string } {
  const url =
    (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const key =
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
  return { url, key }
}

function resolveUrlAndKey(): { url: string; key: string } {
  const fromBuild = {
    u: (typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : '').trim(),
    k: (typeof __SUPABASE_ANON_KEY__ !== 'undefined' ? __SUPABASE_ANON_KEY__ : '').trim(),
  }
  const st = readFromAppSettings()
  const pe = fromProcessEnv()
  return {
    url: st.url || pe.url || fromBuild.u,
    key: st.key || pe.k || fromBuild.k,
  }
}

/** Roep na wijziging van `supabase_url` / `supabase_anon_key` in app_settings. */
export function resetSupabaseClientCache(): void {
  _client = null
}

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    const { url, key } = resolveUrlAndKey()

    if (!url || !key) {
      const msg =
        'Geen Supabase-URL/anon key. Vul «Supabase-verbinding» hierboven in Instellingen, of zet in ~/Library/Application Support/tender-tracker/ een bestand supabase.env met NEXT_PUBLIC_SUPABASE_URL en NEXT_PUBLIC_SUPABASE_ANON_KEY, of bouw lokaal met .env in tender-tracker (npm run build).'
      log.error(`[supabase] ${msg}`)
      throw new Error(msg)
    }

    _client = createSupabaseClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    log.info('[supabase] Client aangemaakt met anon-key')
  }
  return _client
}

/**
 * Eenvoudige check: kan de anon-client de sync-tabellen lezen?
 * Faalt bij ontbrekende URL/key of te strikte RLS (migratie `rls_anon_*`).
 */
export async function checkSupabaseConnection(): Promise<{ ok: boolean; error: string | null }> {
  try {
    const { error } = await getSupabaseClient().from('aanbestedingen').select('id').limit(1)
    if (error) {
      return {
        ok: false,
        error: `${error.message} — Controleer of in Supabase de policies voor rol «anon» actief zijn (migratie rls_anon in SQL Editor).`,
      }
    }
    return { ok: true, error: null }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}
