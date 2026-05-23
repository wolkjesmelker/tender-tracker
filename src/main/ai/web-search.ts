import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import { getDb } from '../db/connection'
import type { AgentWebSearchResult, StoredDocumentEntry } from '../../shared/types'
import { formatFetchFailure } from '../utils/http-resilience'
import { getTenderDocumentsDir, uniqueFileNameInDir } from '../utils/paths'
import { classifyWebSearchResultKind } from '../../shared/web-search-classify'

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
const DUCKDUCKGO_ENDPOINT = 'https://duckduckgo.com/html/'

function getBraveApiKey(): string {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = 'brave_search_api_key'`)
    .get() as { value?: string } | undefined
  return (row?.value || '').trim()
}

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export { classifyWebSearchResultKind }

function slugFilePart(title: string, max = 40): string {
  const t = String(title || 'zoekresultaat')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  const base = t.slice(0, max) || 'item'
  return base
}

function inferTypeLabelFromUrl(url: string): string {
  const m = String(url).match(/\.([a-z0-9]+)(?:$|[?#])/i)
  if (m) return m[1].toUpperCase()
  return 'WEB'
}

export function buildManualSearchExportText(input: {
  entryKind: 'doc_ref' | 'note'
  searchQuery: string
  title: string
  url: string
  snippet: string
  createdAtIso: string
}): string {
  const bron =
    input.entryKind === 'doc_ref'
      ? 'Documentkoppeling (extern bestand of download)'
      : 'Aantekening bij webpagina (geen direct document)'
  const lines: string[] = [
    '================================================================================',
    '  HANDMATIGE OPZOEKTACTIE',
    '================================================================================',
    `  Type bron: ${bron}`,
    '  (Toegevoegd via de internet-zoekfunctie in de Aanbestedingsagent; geen automatische',
    '   index — jij bepaalt welke resultaten in het dossier komen.)',
    '',
    `  Toegevoegd: ${input.createdAtIso.slice(0, 19).replace('T', ' ')} (lokaal)`,
    `  Zoekopdracht: ${input.searchQuery || '(niet opgegeven)'}`,
    '',
    '--------------------------------------------------------------------------------',
    'TITEL',
    '--------------------------------------------------------------------------------',
    input.title || '(zonder titel)',
    '',
    '--------------------------------------------------------------------------------',
    'URL',
    '--------------------------------------------------------------------------------',
    input.url || '(geen URL)',
    '',
    '--------------------------------------------------------------------------------',
    'SAMENVATTING (uit zoekresultaat)',
    '--------------------------------------------------------------------------------',
    input.snippet || '(geen fragment beschikbaar)',
    '',
    '================================================================================',
  ]
  return lines.join('\n') + '\n'
}

export type AgentSearchPinInputKind = 'auto' | 'doc_ref' | 'note'

export function addManualWebSearchToTender(input: {
  tenderId: string
  title: string
  url?: string
  snippet: string
  searchQuery?: string
  kind: AgentSearchPinInputKind
}):
  | { ok: true; id: string; textFileName: string; resolvedKind: 'doc_ref' | 'note' }
  | { ok: false; error: string } {
  const tenderId = String(input.tenderId || '').trim()
  const title = String(input.title || '').trim()
  const snippet = String(input.snippet || '').trim()
  const url = String(input.url || '').trim()
  const searchQuery = String(input.searchQuery || '').trim()
  if (!tenderId) return { ok: false, error: 'Geen tender geselecteerd.' }
  const summary = [title, snippet].filter(Boolean).join(' — ') || url
  if (!summary) return { ok: false, error: 'Geen inhoud om op te slaan.' }

  let resolvedKind: 'doc_ref' | 'note' =
    input.kind === 'auto' ? classifyWebSearchResultKind(url) : input.kind === 'doc_ref' ? 'doc_ref' : 'note'
  if (resolvedKind === 'doc_ref' && !url) {
    resolvedKind = 'note'
  }

  const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
  const nowIso = new Date().toISOString()
  const kindNl = resolvedKind === 'doc_ref' ? 'document' : 'aantekening'

  const textBody = buildManualSearchExportText({
    entryKind: resolvedKind,
    searchQuery: searchQuery || '',
    title: title || url || 'Zoekresultaat',
    url,
    snippet: snippet || '',
    createdAtIso: nowIso,
  })

  const destDir = getTenderDocumentsDir(tenderId)
  const preferred = `Handmatige_opzoek_${nowIso.slice(0, 10)}_${slugFilePart(title || 'resultaat')}.txt`
  const fileName = uniqueFileNameInDir(destDir, preferred)
  if (!fileName) return { ok: false, error: 'Bestandsnaam ongeldig.' }

  try {
    fs.writeFileSync(path.join(destDir, fileName), textBody, { encoding: 'utf8' })
  } catch (e) {
    log.error('[agent-web-search] exportschrijven mislukt:', e)
    return { ok: false, error: 'Tekstexport opslaan mislukt.' }
  }

  const db = getDb()
  try {
    db.prepare(
      `INSERT INTO agent_pinned_notes
       (id, tender_id, source_url, source_query, summary, entry_kind, is_manual_search, text_export_filename)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(id, tenderId, url || null, searchQuery || null, summary, resolvedKind, fileName)
  } catch (e) {
    log.error('[agent-web-search] pin INSERT mislukt:', e)
    try {
      fs.unlinkSync(path.join(destDir, fileName))
    } catch {
      /* ignore */
    }
    return { ok: false, error: 'Databasefout bij opslaan notitie.' }
  }

  // Bijlagenlijst: altijd de TXT; bij documentkoppeling ook de bron-URL
  try {
    const row = db.prepare('SELECT document_urls FROM aanbestedingen WHERE id = ?').get(tenderId) as
      | { document_urls: string | null }
      | undefined
    let docs: StoredDocumentEntry[] = []
    if (row?.document_urls?.trim()) {
      try {
        const arr = JSON.parse(row.document_urls) as unknown
        if (Array.isArray(arr)) docs = arr as StoredDocumentEntry[]
      } catch {
        docs = []
      }
    }

    const txtEntry: StoredDocumentEntry = {
      naam: `Handmatige opzoekactie — ${(title || 'Notitie').slice(0, 80)}`,
      localNaam: fileName,
      type: 'TXT',
      addedByUser: true,
    }

    const toAdd: StoredDocumentEntry[] = []
    if (resolvedKind === 'doc_ref' && url) {
      const hasUrl = docs.some((d) => (d.url || '').trim() === url)
      if (!hasUrl) {
        let linkNaam = (title || 'Extern document').slice(0, 200)
        try {
          const base = path.basename(new URL(url).pathname)
          if (base && base !== '/' && !title) linkNaam = base.slice(0, 200)
        } catch {
          /* keep title */
        }
        toAdd.push({
          url,
          naam: linkNaam,
          type: inferTypeLabelFromUrl(url),
          addedByUser: true,
        })
      }
    }
    const hasTxt = docs.some((d) => d.localNaam === fileName)
    if (!hasTxt) toAdd.push(txtEntry)

    if (toAdd.length) {
      const merged = [...docs, ...toAdd]
      db.prepare(
        `UPDATE aanbestedingen SET document_urls = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(JSON.stringify(merged), tenderId)
    }
  } catch (e) {
    log.warn('[agent-web-search] document_urls bijwerken mislukt:', e)
  }

  // Context voor latere analyses
  try {
    const row = db.prepare('SELECT ruwe_tekst FROM aanbestedingen WHERE id = ?').get(tenderId) as
      | { ruwe_tekst?: string }
      | undefined
    if (row) {
      const stamp = nowIso.slice(0, 10)
      const block = `\n\n[Handmatige opzoekactie · ${kindNl} · ${stamp}]${
        searchQuery ? ` (zoekopdracht: ${searchQuery})` : ''
      }${url ? ` · ${url}` : ''}\n${summary}\n(Export: ${fileName})`
      const existing = row.ruwe_tekst || ''
      if (!existing.includes(summary.slice(0, Math.min(80, summary.length)))) {
        db.prepare(
          `UPDATE aanbestedingen SET ruwe_tekst = ?, updated_at = datetime('now') WHERE id = ?`,
        ).run(existing + block, tenderId)
      }
    }
  } catch (e) {
    log.warn('[agent-web-search] pin-note in ruwe_tekst faalde:', e)
  }

  return { ok: true, id, textFileName: fileName, resolvedKind }
}

export function deleteAgentPinnedNote(pinId: string): { ok: true } | { ok: false; error: string } {
  const id = String(pinId || '').trim()
  if (!id) return { ok: false, error: 'id verplicht' }
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, tender_id, source_url, text_export_filename, entry_kind
       FROM agent_pinned_notes WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string
        tender_id: string
        source_url: string | null
        text_export_filename: string | null
        entry_kind: string | null
      }
    | undefined
  if (!row) return { ok: false, error: 'Item niet gevonden' }

  const tendRow = db.prepare('SELECT document_urls FROM aanbestedingen WHERE id = ?').get(row.tender_id) as
    | { document_urls: string | null }
    | undefined

  if (tendRow?.document_urls?.trim()) {
    try {
      const arr = JSON.parse(tendRow.document_urls) as StoredDocumentEntry[]
      if (Array.isArray(arr)) {
        const fn = row.text_export_filename
        const src = (row.source_url || '').trim()
        const isDoc = row.entry_kind === 'doc_ref'
        const next = arr.filter((d) => {
          if (fn && d.localNaam === fn) return false
          if (isDoc && src && (d.url || '').trim() === src) return false
          return true
        })
        if (next.length !== arr.length) {
          db.prepare(
            `UPDATE aanbestedingen SET document_urls = ?, updated_at = datetime('now') WHERE id = ?`,
          ).run(JSON.stringify(next), row.tender_id)
        }
      }
    } catch (e) {
      log.warn('[agent-web-search] document_urls filter bij verwijderen mislukt:', e)
    }
  }

  if (row.text_export_filename) {
    const dir = getTenderDocumentsDir(row.tender_id)
    const fp = path.join(dir, row.text_export_filename)
    try {
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) fs.unlinkSync(fp)
    } catch (e) {
      log.warn('[agent-web-search] exportbestand verwijderen mislukt:', e)
    }
  }

  db.prepare('DELETE FROM agent_pinned_notes WHERE id = ?').run(id)
  return { ok: true }
}

async function searchBrave(query: string, count: number): Promise<AgentWebSearchResult[]> {
  const apiKey = getBraveApiKey()
  if (!apiKey) return []
  const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}&count=${count}&country=nl`
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    })
  } catch (e) {
    throw formatFetchFailure(e, 'Brave Search niet bereikbaar', url)
  }
  if (!res.ok) {
    throw new Error(`Brave Search API fout: ${res.status}`)
  }
  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
  }
  const results = data.web?.results ?? []
  return results.slice(0, count).map((r) => ({
    title: stripHtml(r.title || ''),
    url: r.url || '',
    snippet: stripHtml(r.description || ''),
  }))
}

/** Fallback wanneer geen Brave-sleutel is ingesteld. Parseert de HTML-resultatenpagina van DuckDuckGo. */
async function searchDuckDuckGo(query: string, count: number): Promise<AgentWebSearchResult[]> {
  const url = `${DUCKDUCKGO_ENDPOINT}?q=${encodeURIComponent(query)}&kl=nl-nl`
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
      },
    })
  } catch (e) {
    throw formatFetchFailure(e, 'DuckDuckGo niet bereikbaar', url)
  }
  if (!res.ok) throw new Error(`DuckDuckGo fout: ${res.status}`)
  const html = await res.text()

  const items: AgentWebSearchResult[] = []
  const blockRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) && items.length < count) {
    let u = m[1]
    try {
      if (u.startsWith('//')) u = 'https:' + u
      const link = new URL(u)
      if (link.hostname.endsWith('duckduckgo.com')) {
        const real = link.searchParams.get('uddg')
        if (real) u = decodeURIComponent(real)
      }
    } catch {
      /* keep original */
    }
    items.push({
      title: stripHtml(m[2]),
      url: u,
      snippet: stripHtml(m[3]),
    })
  }
  return items
}

export async function searchWeb(query: string, count = 5): Promise<AgentWebSearchResult[]> {
  const q = String(query || '').trim()
  if (!q) return []
  try {
    if (getBraveApiKey()) {
      const r = await searchBrave(q, count)
      if (r.length > 0) return r
    }
  } catch (e) {
    log.warn('[agent-web-search] Brave fout, val terug op DuckDuckGo:', e)
  }
  try {
    return await searchDuckDuckGo(q, count)
  } catch (e) {
    log.warn('[agent-web-search] DuckDuckGo fout:', e)
    return []
  }
}

export function listPinnedNotes(tenderId: string): Array<{
  id: string
  tender_id: string
  source_url?: string
  source_query?: string
  summary: string
  created_at: string
  entry_kind: 'doc_ref' | 'note'
  is_manual_search: boolean
  text_export_filename?: string
}> {
  const rows = getDb()
    .prepare(
      `SELECT id, tender_id, source_url, source_query, summary, created_at,
              COALESCE(entry_kind, 'note') AS entry_kind,
              COALESCE(is_manual_search, 1) AS is_manual_search,
              text_export_filename
       FROM agent_pinned_notes
       WHERE tender_id = ?
       ORDER BY created_at DESC`,
    )
    .all(tenderId) as Array<{
    id: string
    tender_id: string
    source_url?: string
    source_query?: string
    summary: string
    created_at: string
    entry_kind: string
    is_manual_search: number
    text_export_filename?: string
  }>
  return rows.map((r) => ({
    ...r,
    entry_kind: r.entry_kind === 'doc_ref' ? 'doc_ref' : 'note',
    is_manual_search: r.is_manual_search === 1,
  }))
}
