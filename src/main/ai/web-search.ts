import log from 'electron-log'
import { getDb } from '../db/connection'
import type { AgentWebSearchResult } from '../../shared/types'
import { formatFetchFailure } from '../utils/http-resilience'

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
    let url = m[1]
    try {
      if (url.startsWith('//')) url = 'https:' + url
      const u = new URL(url)
      if (u.hostname.endsWith('duckduckgo.com')) {
        const real = u.searchParams.get('uddg')
        if (real) url = decodeURIComponent(real)
      }
    } catch {
      /* keep original */
    }
    items.push({
      title: stripHtml(m[2]),
      url,
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

export function pinSearchResultToTender(input: {
  tenderId: string
  url?: string
  query?: string
  summary: string
}): { id: string } {
  const id = (Math.random().toString(36).slice(2) + Date.now().toString(36))
  const db = getDb()
  db.prepare(
    `INSERT INTO agent_pinned_notes (id, tender_id, source_url, source_query, summary)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.tenderId, input.url ?? null, input.query ?? null, input.summary)

  // Neem ook een compacte notitie op in ruwe_tekst zodat latere analyses het meepakken.
  try {
    const row = db.prepare('SELECT ruwe_tekst FROM aanbestedingen WHERE id = ?').get(input.tenderId) as
      | { ruwe_tekst?: string }
      | undefined
    if (row) {
      const stamp = new Date().toISOString().slice(0, 10)
      const block = `\n\n[Agent-notitie · ${stamp}]${input.query ? ` (query: ${input.query})` : ''}${
        input.url ? ` · bron: ${input.url}` : ''
      }\n${input.summary}`
      const existing = row.ruwe_tekst || ''
      if (!existing.includes(input.summary.slice(0, 80))) {
        db.prepare(
          `UPDATE aanbestedingen SET ruwe_tekst = ?, updated_at = datetime('now') WHERE id = ?`,
        ).run(existing + block, input.tenderId)
      }
    }
  } catch (e) {
    log.warn('[agent-web-search] pin-note toevoegen aan ruwe_tekst faalde:', e)
  }

  return { id }
}

export function listPinnedNotes(tenderId: string): Array<{
  id: string
  tender_id: string
  source_url?: string
  source_query?: string
  summary: string
  created_at: string
}> {
  return getDb()
    .prepare(
      `SELECT id, tender_id, source_url, source_query, summary, created_at
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
  }>
}
