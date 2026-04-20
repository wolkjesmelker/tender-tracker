/**
 * Dev-only HTTP API server voor de browser (VITE_WEB_ONLY=1) build.
 * Opent dezelfde SQLite database als de Electron-app via sql.js (puur JavaScript,
 * geen native module nodig) en stelt alle IPC-kanalen beschikbaar via:
 *
 *   POST /api/ipc   body: { channel: string, args: unknown[] }
 *   GET  /health
 *
 * Start: node scripts/dev-api-server.cjs
 * Of via package.json: npm run dev:web
 */

'use strict'

const http = require('http')
const path = require('path')
const os = require('os')
const fs = require('fs')
const crypto = require('crypto')

// ---------------------------------------------------------------------------
// DB path detection
// ---------------------------------------------------------------------------
function resolveDbPath() {
  if (process.env.TENDER_DB_PATH) return process.env.TENDER_DB_PATH
  const home = os.homedir()
  const platform = process.platform
  const candidates = []
  if (platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support')
    candidates.push(
      path.join(base, 'TenderTracker', 'tender-tracker.db'),
      path.join(base, 'tender-tracker', 'tender-tracker.db'),
    )
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    candidates.push(
      path.join(appData, 'TenderTracker', 'tender-tracker.db'),
      path.join(appData, 'tender-tracker', 'tender-tracker.db'),
    )
  } else {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config')
    candidates.push(
      path.join(configHome, 'TenderTracker', 'tender-tracker.db'),
      path.join(configHome, 'tender-tracker', 'tender-tracker.db'),
    )
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch { /* skip */ }
  }
  return candidates[0] || path.join(home, 'Library', 'Application Support', 'tender-tracker', 'tender-tracker.db')
}

function resolveAppDataPath() {
  if (process.env.TENDER_APP_DATA) return process.env.TENDER_APP_DATA
  return path.dirname(resolveDbPath())
}

// ---------------------------------------------------------------------------
// Local document helpers (mirrors paths.ts without Electron)
// ---------------------------------------------------------------------------
function listTenderDocumentFiles(tenderId) {
  const byName = new Map()
  const appDataPath = resolveAppDataPath()
  const roots = [
    path.join(appDataPath, 'internal-document-store'),
    path.join(appDataPath, 'documents'),
  ]
  for (const root of roots) {
    const dir = path.join(root, tenderId)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue
    for (const naam of fs.readdirSync(dir)) {
      const p = path.join(dir, naam)
      try {
        const st = fs.statSync(p)
        if (!st.isFile()) continue
        const prev = byName.get(naam)
        if (!prev || st.size >= prev.size) byName.set(naam, { naam, size: st.size })
      } catch { /* skip */ }
    }
  }
  return Array.from(byName.values()).sort((a, b) => a.naam.localeCompare(b.naam))
}

function resolveTenderDocumentFile(tenderId, fileName) {
  const safe = String(fileName || '').trim()
  if (!safe || safe.includes('..') || safe.includes('/') || safe.includes('\\') || safe.includes('\0')) return null
  if (!tenderId?.trim()) return null
  const appDataPath = resolveAppDataPath()
  const roots = [
    path.join(appDataPath, 'internal-document-store'),
    path.join(appDataPath, 'documents'),
  ]
  for (const root of roots) {
    const dir = path.join(root, tenderId)
    const fullPath = path.join(dir, safe)
    try {
      if (path.resolve(fullPath) !== path.resolve(dir, safe)) continue
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return { fullPath, size: fs.statSync(fullPath).size }
      }
    } catch { /* skip */ }
  }
  return null
}

// ---------------------------------------------------------------------------
// Open database via sql.js (pure-JS, werkt met elke Node.js versie)
// ---------------------------------------------------------------------------
const DB_PATH = resolveDbPath()
console.log(`[dev-api] Database pad: ${DB_PATH}`)

if (!fs.existsSync(DB_PATH)) {
  console.error(`\n[dev-api] FOUT: Database niet gevonden op:\n  ${DB_PATH}\n`)
  console.error('Zorg dat de TenderTracker Electron-app minstens één keer is gestart om de database aan te maken.')
  console.error('Of stel het pad handmatig in via: TENDER_DB_PATH=/pad/naar/db.db npm run dev:web\n')
  process.exit(1)
}

const initSqlJs = require('sql.js')

let DB = null   // sql.js Database instance

/** Laad DB opnieuw van schijf (leest de actuele inhoud). */
function reloadDb() {
  const fileBuffer = fs.readFileSync(DB_PATH)
  DB = new SQL.Database(fileBuffer)
  DB.run('PRAGMA journal_mode = WAL')
  DB.run('PRAGMA foreign_keys = ON')
}

/** Schrijf DB terug naar schijf na wijzigingen. */
function persistDb() {
  const data = DB.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

/** Voer een SELECT uit en geef rijen als array van objecten terug. */
function all(sql, params = []) {
  const stmt = DB.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

/** Voer een SELECT uit en geef één rij (of undefined) terug. */
function get(sql, params = []) {
  const rows = all(sql, params)
  return rows[0]
}

/** Voer een INSERT/UPDATE/DELETE uit. Persist naar schijf. */
function run(sql, params = []) {
  DB.run(sql, params)
  persistDb()
}

// Initialise sql.js (async, maar we wachten voor we de server starten)
let SQL = null

async function startServer() {
  SQL = await initSqlJs()
  reloadDb()
  console.log('[dev-api] Database geopend via sql.js ✓')

  // -------------------------------------------------------------------------
  // IPC channel handlers
  // -------------------------------------------------------------------------

  function buildUpdateQuery(table, id, data, excludeKeys = ['id', 'created_at']) {
    const fields = Object.keys(data).filter(k => !excludeKeys.includes(k))
    if (fields.length === 0) return get(`SELECT * FROM ${table} WHERE id = ?`, [id])
    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => data[f] ?? null)
    run(`UPDATE ${table} SET ${setClause}, updated_at = datetime('now') WHERE id = ?`, [...values, id])
    return get(`SELECT * FROM ${table} WHERE id = ?`, [id])
  }

  const handlers = {
    // ---- Tenders ----
    'tenders:list': ([filters]) => {
      let query = 'SELECT * FROM aanbestedingen'
      const conditions = []
      const params = []

      if (filters?.status) { conditions.push('status = ?'); params.push(filters.status) }
      if (filters?.bron_website_id) { conditions.push('bron_website_id = ?'); params.push(filters.bron_website_id) }
      if (filters?.search) {
        conditions.push('(titel LIKE ? OR beschrijving LIKE ? OR opdrachtgever LIKE ?)')
        const s = `%${filters.search}%`
        params.push(s, s, s)
      }
      if (filters?.minScore !== undefined) { conditions.push('totaal_score >= ?'); params.push(filters.minScore) }
      if (filters?.createdToday) { conditions.push("DATE(created_at) = DATE('now')") }
      if (filters?.urgentOnly) {
        conditions.push("sluitingsdatum IS NOT NULL AND DATE(sluitingsdatum) BETWEEN DATE('now') AND DATE('now', '+7 days')")
      }

      if (filters?.showVerlopen === true) {
        conditions.push("sluitingsdatum IS NOT NULL AND DATE(sluitingsdatum) < DATE('now')")
      } else if (filters?.showVerlopen !== 'all') {
        conditions.push(
          "(sluitingsdatum IS NULL OR TRIM(COALESCE(sluitingsdatum,'')) = '' OR DATE(sluitingsdatum) IS NULL OR DATE(sluitingsdatum) >= DATE('now'))"
        )
      }

      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ')
      query += ' ORDER BY datetime(created_at) DESC, COALESCE(totaal_score, 0) DESC'
      if (filters?.limit) { query += ' LIMIT ?'; params.push(filters.limit) }

      return all(query, params)
    },

    'tenders:get': ([id]) => {
      const row = get('SELECT * FROM aanbestedingen WHERE id = ?', [id])
      if (!row) return null
      return { ...row, local_document_files: listTenderDocumentFiles(id) }
    },

    'tenders:update': ([id, data]) => {
      const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'created_at')
      if (fields.length === 0) return
      const setClause = fields.map(f => `${f} = ?`).join(', ')
      const values = fields.map(f => data[f] ?? null)
      run(`UPDATE aanbestedingen SET ${setClause}, updated_at = datetime('now') WHERE id = ?`, [...values, id])
      return get('SELECT * FROM aanbestedingen WHERE id = ?', [id])
    },

    'tenders:delete': ([id]) => {
      run('DELETE FROM aanbestedingen WHERE id = ?', [id])
      return { success: true }
    },

    'tenders:delete-many': ([ids]) => {
      if (!Array.isArray(ids) || ids.length === 0) return { success: true, deleted: 0 }
      let deleted = 0
      for (const id of ids) {
        try { DB.run('DELETE FROM aanbestedingen WHERE id = ?', [id]); deleted++ } catch { /* skip */ }
      }
      persistDb()
      return { success: true, deleted }
    },

    'tenders:stats': () => {
      const total = (get('SELECT COUNT(*) as c FROM aanbestedingen') || {}).c || 0
      const active = (get("SELECT COUNT(*) as c FROM aanbestedingen WHERE status IN ('gevonden','gekwalificeerd','in_aanbieding')") || {}).c || 0
      const today = (get("SELECT COUNT(*) as c FROM aanbestedingen WHERE DATE(created_at) = DATE('now')") || {}).c || 0
      const urgent = (get("SELECT COUNT(*) as c FROM aanbestedingen WHERE sluitingsdatum IS NOT NULL AND DATE(sluitingsdatum) BETWEEN DATE('now') AND DATE('now', '+7 days')") || {}).c || 0
      const avgRow = get('SELECT AVG(totaal_score) as avg FROM aanbestedingen WHERE totaal_score IS NOT NULL')
      return { totaalAanbestedingen: total, actieveAanbestedingen: active, gevondenVandaag: today, urgentDeadlines: urgent, gemiddeldeScore: avgRow?.avg ?? 0 }
    },

    'tenders:normalize-on-open': () => ({ success: true, updated: false }),
    'tenders:discover-documents': () => ({ success: false, error: 'Niet beschikbaar in browser-modus' }),

    'tenders:local-doc-read': ([payload]) => {
      const resolved = resolveTenderDocumentFile(payload?.tenderId, payload?.fileName)
      if (!resolved) return { success: false, error: 'Bestand niet gevonden' }
      const ext = path.extname(payload.fileName).toLowerCase()
      const MAX_BYTES = 20 * 1024 * 1024
      if (resolved.size > MAX_BYTES) {
        return { success: true, kind: 'no_preview', mime: 'application/octet-stream', size: resolved.size, reason: 'large' }
      }
      try {
        const buffer = fs.readFileSync(resolved.fullPath)
        if (['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
          const mime = ext === '.pdf' ? 'application/pdf' : `image/${ext.slice(1)}`
          return { success: true, kind: 'inline', mime, dataBase64: buffer.toString('base64') }
        }
        if (ext === '.svg') return { success: true, kind: 'inline', mime: 'image/svg+xml', dataBase64: buffer.toString('base64') }
        return { success: true, kind: 'text', text: buffer.toString('utf-8') }
      } catch (e) {
        return { success: false, error: e.message }
      }
    },

    'tenders:local-doc-save-as': () => ({ success: false, error: 'Opslaan-dialoog niet beschikbaar in browser' }),
    'tenders:local-doc-open-external': () => ({ success: false, error: 'Extern openen niet beschikbaar in browser' }),
    'tenders:bron-doc-preview': () => ({ success: false, error: 'Document preview niet beschikbaar in browser' }),
    'tenders:bron-doc-save-as': () => ({ success: false, error: 'Opslaan niet beschikbaar in browser' }),
    'tenders:bron-doc-open-external': () => ({ success: false, error: 'Extern openen niet beschikbaar in browser' }),

    // ---- Sources ----
    'sources:list': () => all('SELECT * FROM bron_websites ORDER BY naam'),
    'sources:get': ([id]) => get('SELECT * FROM bron_websites WHERE id = ?', [id]),

    'sources:create': ([data]) => {
      const id = crypto.randomUUID().replace(/-/g, '')
      run('INSERT INTO bron_websites (id, naam, url, login_url, auth_type, vakgebied, zoekpad) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, data.naam, data.url, data.login_url ?? null, data.auth_type ?? 'none', data.vakgebied ?? 'Infrastructuur', data.zoekpad ?? null])
      return get('SELECT * FROM bron_websites WHERE id = ?', [id])
    },

    'sources:update': ([id, data]) => buildUpdateQuery('bron_websites', id, data),

    'sources:delete': ([id]) => {
      run('DELETE FROM bron_websites WHERE id = ?', [id])
      return { success: true }
    },

    // ---- Criteria ----
    'criteria:list': () => all('SELECT * FROM criteria ORDER BY volgorde, naam'),

    'criteria:create': ([data]) => {
      const id = crypto.randomUUID().replace(/-/g, '')
      run('INSERT INTO criteria (id, naam, beschrijving, gewicht, volgorde) VALUES (?, ?, ?, ?, ?)',
        [id, data.naam, data.beschrijving ?? null, data.gewicht ?? 10, data.volgorde ?? 0])
      return get('SELECT * FROM criteria WHERE id = ?', [id])
    },

    'criteria:update': ([id, data]) => {
      const fields = Object.keys(data).filter(k => k !== 'id')
      if (fields.length === 0) return get('SELECT * FROM criteria WHERE id = ?', [id])
      const setClause = fields.map(f => `${f} = ?`).join(', ')
      run(`UPDATE criteria SET ${setClause} WHERE id = ?`, [...fields.map(f => data[f] ?? null), id])
      return get('SELECT * FROM criteria WHERE id = ?', [id])
    },

    'criteria:delete': ([id]) => {
      run('DELETE FROM criteria WHERE id = ?', [id])
      return { success: true }
    },

    // ---- Zoektermen ----
    'zoektermen:list': () => all('SELECT * FROM zoektermen ORDER BY volgorde, term'),

    'zoektermen:create': ([data]) => {
      const id = crypto.randomUUID().replace(/-/g, '')
      run('INSERT INTO zoektermen (id, term, categorie, volgorde) VALUES (?, ?, ?, ?)',
        [id, data.term, data.categorie ?? null, data.volgorde ?? 0])
      return get('SELECT * FROM zoektermen WHERE id = ?', [id])
    },

    'zoektermen:update': ([id, data]) => {
      const fields = Object.keys(data).filter(k => k !== 'id')
      if (fields.length === 0) return get('SELECT * FROM zoektermen WHERE id = ?', [id])
      const setClause = fields.map(f => `${f} = ?`).join(', ')
      run(`UPDATE zoektermen SET ${setClause} WHERE id = ?`, [...fields.map(f => data[f] ?? null), id])
      return get('SELECT * FROM zoektermen WHERE id = ?', [id])
    },

    'zoektermen:delete': ([id]) => {
      run('DELETE FROM zoektermen WHERE id = ?', [id])
      return { success: true }
    },

    // ---- AI Vragen ----
    'ai-vragen:list': () => all('SELECT * FROM ai_vragen ORDER BY volgorde, vraag'),

    'ai-vragen:create': ([data]) => {
      const id = crypto.randomUUID().replace(/-/g, '')
      run('INSERT INTO ai_vragen (id, vraag, categorie, is_standaard, volgorde) VALUES (?, ?, ?, ?, ?)',
        [id, data.vraag, data.categorie ?? null, data.is_standaard ? 1 : 0, data.volgorde ?? 0])
      return get('SELECT * FROM ai_vragen WHERE id = ?', [id])
    },

    'ai-vragen:update': ([id, data]) => {
      const fields = Object.keys(data).filter(k => k !== 'id')
      if (fields.length === 0) return get('SELECT * FROM ai_vragen WHERE id = ?', [id])
      const setClause = fields.map(f => `${f} = ?`).join(', ')
      run(`UPDATE ai_vragen SET ${setClause} WHERE id = ?`, [...fields.map(f => data[f] ?? null), id])
      return get('SELECT * FROM ai_vragen WHERE id = ?', [id])
    },

    'ai-vragen:delete': ([id]) => {
      run('DELETE FROM ai_vragen WHERE id = ?', [id])
      return { success: true }
    },

    // ---- AI Prompts ----
    'ai-prompts:list': () => all('SELECT * FROM ai_prompts ORDER BY type, naam'),
    'ai-prompts:get': ([id]) => get('SELECT * FROM ai_prompts WHERE id = ?', [id]),

    'ai-prompts:create': ([data]) => {
      const id = crypto.randomUUID().replace(/-/g, '')
      run('INSERT INTO ai_prompts (id, naam, type, agent_naam, prompt_tekst, beschrijving) VALUES (?, ?, ?, ?, ?, ?)',
        [id, data.naam, data.type, data.agent_naam ?? null, data.prompt_tekst, data.beschrijving ?? null])
      return get('SELECT * FROM ai_prompts WHERE id = ?', [id])
    },

    'ai-prompts:update': ([id, data]) => {
      const fields = Object.keys(data).filter(k => k !== 'id')
      if (fields.length === 0) return get('SELECT * FROM ai_prompts WHERE id = ?', [id])
      const setClause = fields.map(f => `${f} = ?`).join(', ')
      run(`UPDATE ai_prompts SET ${setClause} WHERE id = ?`, [...fields.map(f => data[f] ?? null), id])
      return get('SELECT * FROM ai_prompts WHERE id = ?', [id])
    },

    'ai-prompts:delete': ([id]) => {
      run('DELETE FROM ai_prompts WHERE id = ?', [id])
      return { success: true }
    },

    // ---- Settings ----
    'settings:get': ([key]) => {
      const row = get('SELECT value FROM app_settings WHERE key = ?', [key])
      return row?.value ?? null
    },

    'settings:set': ([key, value]) => {
      run("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')",
        [key, value, value])
      return { success: true }
    },

    'settings:get-all': () => {
      const rows = all('SELECT key, value FROM app_settings')
      const out = {}
      for (const r of rows) out[r.key] = r.value
      return out
    },

    'risico:ui-replay': () => null,

    'analysis:ui-replay': () => null,

    'tenders:bron-embed-partition': () => ({ partition: null }),

    'tokens:get-stats': () => {
      reloadDb()
      const empty = {
        last7days: { byModel: [], totalTokens: 0, totalInput: 0, totalOutput: 0 },
        recent: { byModel: [], totalTokens: 0 },
      }
      try {
        const rows7d = all(
          `SELECT provider, model,
                  SUM(input_tokens)  AS input_tokens,
                  SUM(output_tokens) AS output_tokens
           FROM ai_token_usage
           WHERE created_at >= datetime('now', '-7 days')
           GROUP BY provider, model
           ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC`,
        )
        const byModel7d = rows7d.map((r) => {
          const inputTokens = Math.floor(Number(r.input_tokens) || 0)
          const outputTokens = Math.floor(Number(r.output_tokens) || 0)
          return {
            provider: r.provider,
            model: r.model,
            label: r.model ? `${r.provider} · ${r.model}` : r.provider,
            inputTokens,
            outputTokens,
            total: inputTokens + outputTokens,
          }
        })
        const totalInput = byModel7d.reduce((s, r) => s + r.inputTokens, 0)
        const totalOutput = byModel7d.reduce((s, r) => s + r.outputTokens, 0)
        const rowsRecent = all(
          `SELECT provider, model,
                  SUM(input_tokens)  AS input_tokens,
                  SUM(output_tokens) AS output_tokens
           FROM ai_token_usage
           WHERE created_at >= datetime('now', '-8 hours')
           GROUP BY provider, model
           ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC`,
        )
        const byModelRecent = rowsRecent.map((r) => {
          const inputTokens = Math.floor(Number(r.input_tokens) || 0)
          const outputTokens = Math.floor(Number(r.output_tokens) || 0)
          return {
            provider: r.provider,
            model: r.model,
            label: r.model ? `${r.provider} · ${r.model}` : r.provider,
            inputTokens,
            outputTokens,
            total: inputTokens + outputTokens,
          }
        })
        return {
          last7days: {
            byModel: byModel7d,
            totalTokens: totalInput + totalOutput,
            totalInput,
            totalOutput,
          },
          recent: {
            byModel: byModelRecent,
            totalTokens: byModelRecent.reduce((s, r) => s + r.total, 0),
          },
        }
      } catch {
        return empty
      }
    },

    'diagnostics:ai-snapshot': () => ({
      collectedAt: new Date().toISOString(),
      databasePath: '(browser dev)',
      llmChunkConcurrency: 3,
      busyWork: { refCount: 0, powerSaveActive: false },
      pipeline: {
        batchRunning: false,
        batchCurrent: 0,
        batchTotal: 0,
        batchCurrentId: '',
        batchCurrentTitle: '',
        singleRunning: false,
        singleAnalysisId: null,
        pendingSingleAnalysisIds: [],
        pendingPostScrapeIdsCount: 0,
        analysisPipelineBusy: false,
      },
      risico: { running: false, aanbestedingId: null, queuedCount: 0, lastProgress: null },
      checkpoints: [],
      tokenEventsRecent: [],
      tokenEventsLast2Min: 0,
      tokenEventsLast15Min: 0,
      tokenEventsLast6h: 0,
      kimiTokenEventsLast6h: 0,
      tenderSignals: {
        withCheckpoint: 0,
        withScoreNoRisico: 0,
        withRisico: 0,
        staleCheckpoints: 0,
      },
      aiSettings: {
        ai_provider: '(dev)',
        ai_model: '(dev)',
        moonshotBaseConfigured: false,
        kimiCliPathConfigured: false,
        ollamaBaseUrl: '(dev)',
        hasAiApiKey: false,
        hasMoonshotKey: false,
      },
      hints: ['In de browser-dev-modus is dit een lege snapshot. Gebruik de desktop-app voor echte gegevens.'],
    }),

    // ---- Scheduler ----
    'scheduler:list': () => all('SELECT * FROM scrape_schema ORDER BY naam'),

    'scheduler:create': ([data]) => {
      const id = crypto.randomUUID().replace(/-/g, '')
      run('INSERT INTO scrape_schema (id, naam, cron_expressie, bron_website_ids, zoektermen) VALUES (?, ?, ?, ?, ?)',
        [id, data.naam, data.cron_expressie, JSON.stringify(data.bron_website_ids), data.zoektermen ? JSON.stringify(data.zoektermen) : null])
      return get('SELECT * FROM scrape_schema WHERE id = ?', [id])
    },

    'scheduler:update': ([id, data]) => {
      const fields = Object.keys(data).filter(k => k !== 'id')
      if (fields.length === 0) return get('SELECT * FROM scrape_schema WHERE id = ?', [id])
      const setClause = fields.map(f => `${f} = ?`).join(', ')
      const values = fields.map(f => {
        const v = data[f]
        return Array.isArray(v) ? JSON.stringify(v) : (v ?? null)
      })
      run(`UPDATE scrape_schema SET ${setClause} WHERE id = ?`, [...values, id])
      return get('SELECT * FROM scrape_schema WHERE id = ?', [id])
    },

    'scheduler:delete': ([id]) => {
      run('DELETE FROM scrape_schema WHERE id = ?', [id])
      return { success: true }
    },

    'scheduler:toggle': ([id]) => {
      const row = get('SELECT * FROM scrape_schema WHERE id = ?', [id])
      if (!row) return null
      const newActive = row.is_actief ? 0 : 1
      run('UPDATE scrape_schema SET is_actief = ? WHERE id = ?', [newActive, id])
      return get('SELECT * FROM scrape_schema WHERE id = ?', [id])
    },

    // ---- Scraping (read-only in browser) ----
    'scraping:jobs': () => all('SELECT * FROM scrape_jobs ORDER BY created_at DESC LIMIT 100'),
    'scraping:delete-jobs': ([payload]) => {
      if (payload?.all === true) {
        const row = get('SELECT COUNT(*) AS c FROM scrape_jobs')
        const n = row?.c ?? 0
        run('DELETE FROM scrape_jobs')
        return { success: true, deleted: n }
      }
      const ids = [...new Set((payload?.ids ?? []).filter((id) => typeof id === 'string' && id.length > 0))]
      if (ids.length === 0) return { success: false, error: 'Geen items geselecteerd' }
      const ph = ids.map(() => '?').join(',')
      const found = all(`SELECT id FROM scrape_jobs WHERE id IN (${ph})`, ids)
      run(`DELETE FROM scrape_jobs WHERE id IN (${ph})`, ids)
      return { success: true, deleted: found.length }
    },
    'scraping:start': () => ({ success: false, error: 'Scraping niet beschikbaar in browser-modus' }),
    'scraping:stop': () => ({ success: false }),

    'scraping:pending-document-fetch': () => {
      try {
        const rows = all(
          `SELECT id, titel FROM aanbestedingen WHERE document_fetch_completed_at IS NULL AND bron_url IS NOT NULL AND TRIM(bron_url) != '' AND is_upload = 0 ORDER BY created_at ASC`,
        )
        return { count: rows.length, items: rows }
      } catch {
        return { count: 0, items: [] }
      }
    },
    'scraping:resume-document-fetch': () => ({
      success: false,
      error: 'Hervatten documentophalen is alleen beschikbaar in de desktop-app.',
    }),
    'scraping:stop-document-fetch': () => ({
      success: false,
      error: 'Stoppen documentophalen is alleen beschikbaar in de desktop-app.',
    }),

    // ---- Auth ----
    'auth:status': () => ({}),
    'auth:open-login': () => ({ success: false, error: 'Login niet beschikbaar in browser-modus' }),
    'auth:logout': () => ({ success: true }),

    // ---- Analysis ----
    // Tweede argument `opts` (discardCheckpoint) wordt genegeerd in browser-modus
    'analysis:start': () => ({ success: false, error: 'AI-analyse niet beschikbaar in browser-modus' }),
    'analysis:resume': () => ({ success: false, error: 'AI-analyse niet beschikbaar in browser-modus' }),
    'analysis:pause': () => ({ success: true }),
    'analysis:stop': () => ({ success: true }),
    'analysis:checkpoint-get': () => ({
      hasCheckpoint: false,
      stage: null,
      configMismatch: false,
    }),
    'analysis:batch-start': () => ({ success: false, error: 'AI-analyse niet beschikbaar in browser-modus' }),
    'analysis:batch-all-start': () => ({ success: false, error: 'AI-analyse niet beschikbaar in browser-modus' }),
    'analysis:batch-status': () => ({ running: false, queue: [], current: null }),

    // ---- Export ----
    'export:generate': () => ({ success: false, error: 'Export niet beschikbaar in browser-modus' }),

    // ---- Cloud back-up (desktop only) ----
    'backup:select-cloud-folder': () => ({ ok: false, error: 'Alleen beschikbaar in de desktop-app', path: null }),
    'backup:get-manifest': () => ({ ok: true, manifest: null }),
    'backup:run-mirror-sync': () => ({ ok: false, error: 'Alleen beschikbaar in de desktop-app' }),

    // ---- App shell ----
    'app:version': () => require('../package.json').version + '-web',
    'license:status': () => ({ ok: true, reason: 'web-dev', message: 'Browser-modus: licentie niet gecontroleerd' }),
    'license:refresh': () => ({ ok: true, reason: 'web-dev', message: 'Browser-modus: licentie niet gecontroleerd' }),
    'app:check-updates': () => null,
    'app:download-update': () => null,
    'app:install-update': () => null,
  }

  // -------------------------------------------------------------------------
  // HTTP server
  // -------------------------------------------------------------------------
  const PORT = parseInt(process.env.DEV_API_PORT || '3001', 10)

  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS })
      res.end(JSON.stringify({ status: 'ok', db: DB_PATH }))
      return
    }

    if (req.method !== 'POST' || req.url !== '/api/ipc') {
      res.writeHead(404, { 'Content-Type': 'application/json', ...CORS_HEADERS })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', async () => {
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
        return
      }

      const { channel, args = [] } = parsed
      const handler = handlers[channel]

      if (!handler) {
        console.warn(`[dev-api] Onbekend kanaal: "${channel}"`)
        res.writeHead(404, { 'Content-Type': 'application/json', ...CORS_HEADERS })
        res.end(JSON.stringify({ error: `Onbekend kanaal: ${channel}` }))
        return
      }

      try {
        const result = await Promise.resolve(handler(args))
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS })
        res.end(JSON.stringify({ result: result ?? null }))
      } catch (e) {
        console.error(`[dev-api] Fout bij kanaal "${channel}":`, e.message)
        res.writeHead(500, { 'Content-Type': 'application/json', ...CORS_HEADERS })
        res.end(JSON.stringify({ error: e.message || 'Interne fout' }))
      }
    })
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[dev-api] API server draait op http://127.0.0.1:${PORT}/api/ipc ✓`)
    console.log(`[dev-api] Health: http://127.0.0.1:${PORT}/health`)
  })

  process.on('SIGINT', () => {
    if (DB) DB.close()
    server.close()
    process.exit(0)
  })
}

startServer().catch(e => {
  console.error('[dev-api] Opstartfout:', e)
  process.exit(1)
})
