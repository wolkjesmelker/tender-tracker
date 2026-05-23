/**
 * Hybride sync-engine: SQLite is primaire opslag; Supabase is de cloud-mirror.
 *
 * Strategie:
 * - PUSH: rijen uit SQLite waarvan updated_at > last_push_watermark → upsert naar Supabase.
 * - PULL: rijen uit Supabase waarvan updated_at > last_pull_watermark → upsert naar SQLite.
 * - Conflict: LWW (Last-Write-Wins) op updated_at. Bij pull wint cloud-rij als die nieuwer is.
 * - Watermerk: opgeslagen in app_settings ('supabase_last_push_at', 'supabase_last_pull_at').
 *
 * JSON-velden: SQLite slaat ze op als TEXT; Supabase als jsonb.
 * Bij push: JSON.parse voor jsonb kolommen.
 * Bij pull: JSON.stringify.
 */

import log from 'electron-log'
import type { SupabaseSyncProgressPayload } from '../../shared/types'
import { getDb } from './connection'
import { getSupabaseClient } from './supabase-client'

type OnTablePushProgress = (e: { current: number; total: number; table: string }) => void

export type SyncStatus = {
  running: boolean
  lastPushAt: string | null
  lastPullAt: string | null
  lastError: string | null
  pushCount: number
  pullCount: number
  /** Alleen gezet na volledige upload: gelukte document-uploads naar Storage. */
  documentPushCount?: number
  documentPushFailed?: number
  /** Alleen gezet na volledige download: gedownloade documenten van Storage. */
  documentPullCount?: number
  documentPullFailed?: number
}

let _status: SyncStatus = {
  running: false,
  lastPushAt: null,
  lastPullAt: null,
  lastError: null,
  pushCount: 0,
  pullCount: 0,
}

/**
 * Wachtrij: `runSync`-aanroepen (achtergrond, «Sync nu», «Alles ophalen») lopen opeenvolgend, niet tegelijk.
 * De staart blijft «resolved» — ook na een throw — anders wachten latere taken voor altijd.
 */
let _syncTail: Promise<unknown> = Promise.resolve()

/** Na lokale wijzigingen: cloud-push debouncen (voorkomt API-spam). Standaard 20 s. */
let _debouncedPushTimer: ReturnType<typeof setTimeout> | null = null

export function requestDebouncedCloudPush(delayMs = 20_000): void {
  if (_debouncedPushTimer) clearTimeout(_debouncedPushTimer)
  _debouncedPushTimer = setTimeout(() => {
    _debouncedPushTimer = null
    void runSync('push').then(
      (st) => {
        if (st.lastError) log.warn('[sync] debounced push:', st.lastError)
      },
      (e: unknown) => log.warn('[sync] debounced push mislukt:', e),
    )
  }, delayMs)
}

type TableConfig = {
  name: string
  /** Columns that are stored as JSON strings in SQLite but jsonb in Supabase. */
  jsonColumns: string[]
  /** Whether this table has an updated_at column in SQLite (post-migration). */
  hasUpdatedAt: boolean
  /** Fallback timestamp column when table has no updated_at. */
  fallbackTimestamp?: string
}

/** Volgorde = FK-afhankelijkheden (Postgres): bron_websites vóór aanbestedingen en scrape_jobs. */
const SYNC_TABLES: TableConfig[] = [
  {
    name: 'bron_websites',
    jsonColumns: [],
    hasUpdatedAt: true,
  },
  {
    name: 'zoektermen',
    jsonColumns: [],
    hasUpdatedAt: true,
  },
  {
    name: 'criteria',
    jsonColumns: [],
    hasUpdatedAt: true,
  },
  {
    name: 'ai_vragen',
    jsonColumns: [],
    hasUpdatedAt: true,
  },
  {
    name: 'ai_prompts',
    jsonColumns: [],
    hasUpdatedAt: true,
  },
  {
    name: 'scrape_schema',
    jsonColumns: ['bron_website_ids', 'zoektermen'],
    hasUpdatedAt: true,
  },
  {
    name: 'bedrijfsprofielen',
    jsonColumns: ['extra_velden'],
    hasUpdatedAt: true,
  },
  {
    name: 'aanbestedingen',
    jsonColumns: [
      'document_urls',
      'ai_antwoorden',
      'criteria_scores',
      'bijlage_analyses',
      'bron_navigatie_links',
      'ai_extracted_fields',
      'tender_procedure_context',
      'risico_analyse',
      'risico_analyse_v2',
      'document_catalog_selected_keys',
    ],
    hasUpdatedAt: true,
  },
  {
    name: 'scrape_jobs',
    jsonColumns: ['resultaten'],
    hasUpdatedAt: true,
  },
  {
    name: 'agent_conversations',
    jsonColumns: ['metadata_json'],
    hasUpdatedAt: true,
  },
  {
    name: 'agent_document_fills',
    jsonColumns: ['field_options_json'],
    hasUpdatedAt: true,
  },
  {
    name: 'agent_learning_entries',
    jsonColumns: [],
    hasUpdatedAt: true,
  },
  {
    name: 'agent_pinned_notes',
    jsonColumns: [],
    hasUpdatedAt: true,
  },
  {
    name: 'agent_document_checklists',
    jsonColumns: [],
    hasUpdatedAt: true,
  },
]

const KEY_LAST_PUSH = 'supabase_last_push_at'
const KEY_LAST_PULL = 'supabase_last_pull_at'
const PUSH_WM_PREFIX = 'supabase_wm_push_'
const PULL_WM_PREFIX = 'supabase_wm_pull_'

function pushWatermarkKey(table: string): string {
  return `${PUSH_WM_PREFIX}${table}`
}

function pullWatermarkKey(table: string): string {
  return `${PULL_WM_PREFIX}${table}`
}

function deleteSettingsKeysGlob(globPattern: string): void {
  const db = getDb()
  const rows = db.prepare('SELECT key FROM app_settings WHERE key GLOB ?').all(globPattern) as { key: string }[]
  const del = db.prepare('DELETE FROM app_settings WHERE key = ?')
  for (const { key } of rows) del.run(key)
}

/** Alleen push-cursors wissen zodat een volledige upload opnieuw alle rijen meeneemt. */
function clearPushWatermarksOnly(): void {
  deleteSettingsKeysGlob(`${PUSH_WM_PREFIX}*`)
  setSetting(KEY_LAST_PUSH, '')
}

/** Alleen pull-cursors wissen zodat een volledige download de cloud opnieuw inleest. */
function clearPullWatermarksOnly(): void {
  deleteSettingsKeysGlob(`${PULL_WM_PREFIX}*`)
  setSetting(KEY_LAST_PULL, '')
}

function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
    .run(key, value)
}

/** Kolommen die alleen in SQLite bestaan (PostgREST weigert onbekende keys). */
const SQLITE_ONLY_COLUMNS = new Set(['encrypted_credentials', 'login_gebruikersnaam', 'login_wachtwoord'])

/** SQLite INTEGER 0/1 → Postgres boolean (ook zonder `is_`-prefix). */
const BOOL_01_COLUMNS = new Set([
  'field_required',
  'contradiction_flag',
  'user_touched',
  'is_manual_search',
  'done',
])

/** Parse TEXT JSON columns from a SQLite row into actual objects for Supabase. */
function prepareForSupabase(row: Record<string, unknown>, jsonColumns: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row }
  for (const col of SQLITE_ONLY_COLUMNS) {
    delete out[col]
  }
  for (const col of jsonColumns) {
    const v = out[col]
    if (typeof v === 'string' && v.trim()) {
      try {
        out[col] = JSON.parse(v)
      } catch {
        out[col] = null
      }
    } else if (v === undefined || v === '') {
      out[col] = null
    }
  }
  for (const [k, val] of Object.entries(out)) {
    if (typeof val === 'number' && (val === 0 || val === 1)) {
      if (k.startsWith('is_') || BOOL_01_COLUMNS.has(k)) {
        out[k] = val === 1
      }
    }
  }
  return out
}

/** Stringify jsonb columns from Supabase into TEXT for SQLite. */
function prepareForSqlite(
  row: Record<string, unknown>,
  jsonColumns: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row }
  for (const col of jsonColumns) {
    const v = out[col]
    if (v !== null && v !== undefined) {
      out[col] = JSON.stringify(v)
    }
  }
  // Convert Supabase booleans → 0/1 for SQLite
  for (const [k, val] of Object.entries(out)) {
    if (typeof val === 'boolean') {
      out[k] = val ? 1 : 0
    }
  }
  // Convert timestamptz to TEXT (SQLite stores as text)
  for (const [k, val] of Object.entries(out)) {
    if (typeof val === 'string' && k.endsWith('_at') && val.includes('T')) {
      // keep as-is; SQLite stores datetimes as TEXT
    }
  }
  // Remove user_id — not a column in SQLite
  delete out['user_id']
  return out
}

/** Kolom voor ORDER BY / watermerk bij push uit SQLite (na migratie v23/v24/v25: updated_at). */
function resolveSqlitePushTimestampColumn(
  tableName: string,
): { col: string } | { error: string } {
  const db = getDb()
  const getNames = () =>
    new Set(
      (db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]).map((c) => c.name),
    )

  let names = getNames()
  if (names.has('updated_at')) return { col: 'updated_at' }

  // Kolom ontbreekt — probeer hem direct toe te voegen (SQLite vereist constante DEFAULT, geen expr).
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2000-01-01 00:00:00'`)
    log.info(`[sync] resolveSqlitePushTimestampColumn: updated_at live toegevoegd op ${tableName}`)
  } catch {
    try {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN updated_at TEXT DEFAULT '2000-01-01 00:00:00'`)
      log.info(`[sync] resolveSqlitePushTimestampColumn: updated_at (nullable) live toegevoegd op ${tableName}`)
    } catch (e2: unknown) {
      log.warn(`[sync] resolveSqlitePushTimestampColumn: ALTER mislukt voor ${tableName}`, e2)
    }
  }

  names = getNames()
  if (names.has('updated_at')) return { col: 'updated_at' }
  if (names.has('created_at')) return { col: 'created_at' }

  return {
    error: `${tableName}: kolom updated_at ontbreekt lokaal en kon niet worden aangemaakt. Herstart de app.`,
  }
}

async function pushTable(
  tableName: string,
  jsonCols: string[],
  watermark: string | null
): Promise<{ count: number; maxPushedAt: string | null; error: string | null }> {
  const ts = resolveSqlitePushTimestampColumn(tableName)
  if ('error' in ts) {
    return { count: 0, maxPushedAt: null, error: ts.error }
  }
  const timestampCol = ts.col
  const db = getDb()
  const hasWm = watermark != null && String(watermark).trim() !== ''
  let total = 0
  let offset = 0
  let maxPushedAt: string | null = null
  const client = getSupabaseClient()

  while (true) {
    const rows = (
      hasWm
        ? db
            .prepare(
              `SELECT * FROM ${tableName} WHERE ${timestampCol} > ? ORDER BY ${timestampCol} ASC, id ASC LIMIT 500 OFFSET ?`,
            )
            .all(watermark, offset)
        : db
            .prepare(
              `SELECT * FROM ${tableName} ORDER BY ${timestampCol} ASC, id ASC LIMIT 500 OFFSET ?`,
            )
            .all(offset)
    ) as Record<string, unknown>[]

    if (rows.length === 0) break

    for (const r of rows) {
      const u = r[timestampCol]
      if (typeof u === 'string' && (!maxPushedAt || u > maxPushedAt)) maxPushedAt = u
    }

    const payload = rows.map((r) => prepareForSupabase(r, jsonCols))
    const { error } = await client.from(tableName).upsert(payload, { onConflict: 'id' })
    if (error) {
      log.warn(`[sync] push ${tableName}: ${error.message}`)
      return { count: total, maxPushedAt, error: error.message }
    }
    total += rows.length
    offset += rows.length
    if (rows.length < 500) break
  }
  return { count: total, maxPushedAt, error: null }
}

async function pullTable(
  tableName: string,
  jsonCols: string[],
  watermark: string | null
): Promise<{ upserted: number; maxRemoteUpdatedAt: string | null; error: string | null }> {
  const client = getSupabaseClient()
  const hasWm = watermark != null && String(watermark).trim() !== ''
  const db = getDb()
  let upserted = 0
  let from = 0
  let maxRemoteUpdatedAt: string | null = null

  const existingColNamesCache = new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]).map((c) => c.name),
  )

  while (true) {
    let q = client
      .from(tableName)
      .select('*')
      .order('updated_at', { ascending: true })
      .range(from, from + 499)
    if (hasWm) q = q.gt('updated_at', watermark)
    const { data, error } = await q
    if (error) {
      log.warn(`[sync] pull ${tableName}: ${error.message}`)
      return { upserted, maxRemoteUpdatedAt, error: error.message }
    }
    if (!data || data.length === 0) break

    for (const remoteRow of data as Record<string, unknown>[]) {
      const u = remoteRow.updated_at
      if (typeof u === 'string' && (!maxRemoteUpdatedAt || u > maxRemoteUpdatedAt)) maxRemoteUpdatedAt = u

      const localRow = prepareForSqlite(remoteRow, jsonCols)
      const cols = Object.keys(localRow)
      const safeCols = cols.filter((c) => existingColNamesCache.has(c))
      if (safeCols.length === 0) continue

      const safeRow: Record<string, unknown> = {}
      for (const c of safeCols) safeRow[c] = localRow[c]

      const colList = safeCols.join(', ')
      const placeholders = safeCols.map(() => '?').join(', ')
      const updates = safeCols
        .filter((c) => c !== 'id')
        .map((c) => `${c} = excluded.${c}`)
        .join(', ')

      db.prepare(
        `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders})
         ON CONFLICT(id) DO UPDATE SET ${updates}
         WHERE excluded.updated_at > ${tableName}.updated_at`,
      ).run(...safeCols.map((c) => safeRow[c]))
      upserted++
    }

    from += data.length
    if (data.length < 500) break
  }
  return { upserted, maxRemoteUpdatedAt, error: null }
}

export function getSyncStatus(): SyncStatus {
  const db = getDb()
  const tryGet = (k: string) => {
    const r = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(k) as
      | { value: string }
      | undefined
    return r?.value ?? null
  }
  return {
    ..._status,
    lastPushAt: tryGet(KEY_LAST_PUSH),
    lastPullAt: tryGet(KEY_LAST_PULL),
  }
}

async function runSyncImpl(
  direction: 'push' | 'pull' | 'both',
  onTablePushStart?: OnTablePushProgress,
): Promise<SyncStatus> {
  _status = { ..._status, running: true, lastError: null, pushCount: 0, pullCount: 0 }

  try {
    getSupabaseClient()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    log.warn('[sync] geen Supabase-client:', msg)
    _status = {
      running: false,
      lastPushAt: getSetting(KEY_LAST_PUSH),
      lastPullAt: getSetting(KEY_LAST_PULL),
      lastError: msg,
      pushCount: 0,
      pullCount: 0,
    }
    return _status
  }

  try {
    let totalPush = 0
    let totalPull = 0
    let firstError: string | null = null

    if (direction !== 'pull') {
      const legacyPush = getSetting(KEY_LAST_PUSH)
      const nTables = SYNC_TABLES.length
      for (let ti = 0; ti < SYNC_TABLES.length; ti++) {
        const table = SYNC_TABLES[ti]
        onTablePushStart?.({ current: ti + 1, total: nTables, table: table.name })
        try {
          let wm = getSetting(pushWatermarkKey(table.name))
          if (wm == null || wm === '') wm = legacyPush
          if (wm === '') wm = null
          const { count, maxPushedAt, error: pushErr } = await pushTable(
            table.name,
            table.jsonColumns,
            wm,
          )
          totalPush += count
          if (maxPushedAt) setSetting(pushWatermarkKey(table.name), maxPushedAt)
          if (pushErr && !firstError) {
            firstError = `${table.name} (push): ${pushErr}`
          }
        } catch (e: unknown) {
          log.warn(`[sync] push ${table.name} mislukt:`, e)
          if (!firstError) {
            firstError = `${table.name} (push): ${e instanceof Error ? e.message : String(e)}`
          }
        }
      }
      setSetting(KEY_LAST_PUSH, new Date().toISOString())
      log.info(`[sync] push voltooid: ${totalPush} rij(en)`)
    }

    if (direction !== 'push') {
      const legacyPull = getSetting(KEY_LAST_PULL)
      for (const table of SYNC_TABLES) {
        try {
          let wm = getSetting(pullWatermarkKey(table.name))
          if (wm == null || wm === '') wm = legacyPull
          if (wm === '') wm = null
          const { upserted, maxRemoteUpdatedAt, error: pullErr } = await pullTable(
            table.name,
            table.jsonColumns,
            wm,
          )
          totalPull += upserted
          if (maxRemoteUpdatedAt) setSetting(pullWatermarkKey(table.name), maxRemoteUpdatedAt)
          if (pullErr && !firstError) {
            firstError = `${table.name} (pull): ${pullErr}`
          }
        } catch (e: unknown) {
          log.warn(`[sync] pull ${table.name} mislukt:`, e)
          if (!firstError) {
            firstError = `${table.name} (pull): ${e instanceof Error ? e.message : String(e)}`
          }
        }
      }
      setSetting(KEY_LAST_PULL, new Date().toISOString())
      log.info(`[sync] pull voltooid: ${totalPull} rij(en)`)
    }

    _status = {
      running: false,
      lastPushAt: getSetting(KEY_LAST_PUSH),
      lastPullAt: getSetting(KEY_LAST_PULL),
      lastError: firstError,
      pushCount: totalPush,
      pullCount: totalPull,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('[sync] onverwachte fout:', msg)
    _status = { ..._status, running: false, lastError: msg }
  }

  return _status
}

export async function runSync(
  direction: 'push' | 'pull' | 'both' = 'both',
  onTablePushStart?: OnTablePushProgress,
): Promise<SyncStatus> {
  const result = _syncTail.then(() => runSyncImpl(direction, onTablePushStart))
  _syncTail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function emitFullPushProgress(
  fn: ((p: SupabaseSyncProgressPayload) => void) | undefined,
  percent: number,
  label: string
): void {
  if (!fn) return
  const p = Math.max(0, Math.min(100, percent))
  fn({ percent: p, label })
}

/** Eenmalige volledige upload van alle lokale data naar Supabase + bijlagen naar Storage. */
export async function runFullPush(
  onProgress?: (p: SupabaseSyncProgressPayload) => void,
): Promise<SyncStatus> {
  clearPushWatermarksOnly()
  const { countLocalDocumentsToUpload, pushAllLocalDocumentsToStorage } = await import('./supabase-storage')
  const docTotal = countLocalDocumentsToUpload()
  emitFullPushProgress(onProgress, 0, 'Tabellen uploaden (voorbereiden)…')

  const st = await runSync('push', (ev) => {
    const t = ev.total > 0 ? ev.current / ev.total : 1
    const percent = docTotal > 0 ? Math.round(t * 70) : Math.round(t * 100)
    emitFullPushProgress(
      onProgress,
      percent,
      `Tabel ${ev.table} (${ev.current}/${ev.total})`,
    )
  })
  if (st.lastError) {
    return st
  }
  if (docTotal === 0) {
    emitFullPushProgress(onProgress, 100, 'Geen bijlagen om te uploaden')
    const merged: SyncStatus = { ...st, documentPushCount: 0, documentPushFailed: 0 }
    _status = merged
    return merged
  }
  try {
    const doc = await pushAllLocalDocumentsToStorage((done, total, label) => {
      const ratio = total > 0 ? done / total : 1
      emitFullPushProgress(
        onProgress,
        70 + Math.round(ratio * 30),
        `Bijlagen: ${label} (${done}/${total})`,
      )
    })
    const merged: SyncStatus = {
      ...st,
      documentPushCount: doc.ok,
      documentPushFailed: doc.fail,
    }
    emitFullPushProgress(onProgress, 100, 'Klaar')
    _status = merged
    return merged
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    log.error('[sync] document-upload:', msg)
    const merged = { ...st, lastError: msg }
    _status = merged
    return merged
  }
}

/** Eenmalige volledige download van alle cloud-data + ontbrekende bijlagen uit Storage. */
export async function runFullPull(): Promise<SyncStatus> {
  clearPullWatermarksOnly()
  const st = await runSync('pull')
  if (st.lastError) return st
  try {
    const { downloadAllMissingDocumentsFromStorage } = await import('./supabase-storage')
    const doc = await downloadAllMissingDocumentsFromStorage()
    const merged: SyncStatus = {
      ...st,
      documentPullCount: doc.ok,
      documentPullFailed: doc.fail,
    }
    _status = merged
    return merged
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    log.error('[sync] document-download:', msg)
    const merged = { ...st, lastError: msg }
    _status = merged
    return merged
  }
}
