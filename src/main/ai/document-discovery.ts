import log from 'electron-log'
import { getDb } from '../db/connection'
import {
  fetchBronPaginaDetails,
  resolveCanonicalBronUrlForAnalysis,
  type DocumentInfo,
} from '../scraping/document-fetcher'
import { expandZipEntriesInDocumentList } from '../scraping/zip-document-expand'
import {
  attachLinksToTimeline,
  buildMinimalProcedureContext,
  mergeProcedurePortals,
} from '../scraping/procedure-context'
import type { BronNavigatieLink } from '../../shared/types'
import { omitZipDownloadsWhenPartsAlreadyInList } from '../../shared/document-entry'
import { buildNavigatieLinksFromText, mergeNavigatieLinkRows } from '../utils/bron-inventory'
import { aiService } from './ai-service'
import { extractFirstJsonObject } from './parse-ai-json'

export interface DiscoverProgress {
  step: string
  percentage: number
}

function normalizeUrl(u: string): string {
  try {
    return new URL(u.trim()).href.split('#')[0]
  } catch {
    return ''
  }
}

/** URLs in platte tekst (TenderNed/Mercell/downloads). */
export function extractDocumentUrlsFromPlainText(text: string): DocumentInfo[] {
  if (!text) return []
  const re = /https?:\/\/[^\s\]\}"'<>)\],]+/gi
  const seen = new Set<string>()
  const out: DocumentInfo[] = []
  const t = text.slice(0, 500_000)
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    let u = m[0].replace(/[.,;:)\]}>]+$/g, '')
    try {
      const url = new URL(u)
      const host = url.hostname.toLowerCase()
      const path = url.pathname.toLowerCase()
      const isDoc =
        /\.(pdf|zip|docx?|xlsx?|xml|csv|ods|odt)$/i.test(path) ||
        host.includes('tenderned.nl') ||
        host.includes('mercell') ||
        host.includes('negometrix') ||
        host.includes('s2c.') ||
        path.includes('/document') ||
        path.includes('/download') ||
        path.includes('/bijlage') ||
        path.includes('/content') ||
        /questionnaire|vragenlijst|questionnair|formtemplate|tenderresponse|submission/i.test(path)
      if (!isDoc) continue
      const norm = normalizeUrl(url.href)
      if (!norm || seen.has(norm)) continue
      seen.add(norm)
      const fileName = decodeURIComponent(path.split('/').pop() || 'document') || 'document'
      const ext = fileName.includes('.') ? (fileName.split('.').pop() || '').slice(0, 20) : ''
      out.push({ url: norm, naam: fileName.slice(0, 240), type: ext })
    } catch {
      /* skip */
    }
  }
  return out
}

function docListKey(d: DocumentInfo): string {
  const u = d.url?.trim()
  if (u) {
    const norm = normalizeUrl(u)
    if (norm) {
      try {
        return new URL(norm).href.split('#')[0].split('?')[0]
      } catch {
        return norm.split('?')[0]
      }
    }
  }
  if (d.localNaam?.trim()) return `local:${d.localNaam.trim()}`
  return ''
}

function mergeDocumentLists(...lists: DocumentInfo[][]): DocumentInfo[] {
  const map = new Map<string, DocumentInfo>()
  for (const list of lists) {
    for (const d of list) {
      const key = docListKey(d)
      if (!key) continue
      const prev = map.get(key)
      if (!prev) {
        map.set(key, { ...d })
        continue
      }
      const localNaam = d.localNaam?.trim() || prev.localNaam?.trim() || undefined
      const naam =
        d.naam?.trim() && (!prev.naam?.trim() || d.naam.trim().length > (prev.naam?.trim().length || 0))
          ? d.naam.trim()
          : prev.naam?.trim() || d.naam?.trim() || 'Document'
      map.set(key, {
        url: d.url?.trim() || prev.url?.trim() || '',
        naam,
        type: d.type?.trim() || prev.type?.trim() || '',
        ...(localNaam ? { localNaam } : {}),
        ...(d.bronZipLabel?.trim() || prev.bronZipLabel?.trim()
          ? { bronZipLabel: d.bronZipLabel?.trim() || prev.bronZipLabel?.trim() }
          : {}),
      })
    }
  }
  return [...map.values()]
}

function parseStoredDocumentUrls(json: string | null | undefined): DocumentInfo[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr
      .map((x: any) => ({
        url: String(x.url || ''),
        localNaam: x.localNaam ? String(x.localNaam) : undefined,
        naam: String(x.naam || 'Document'),
        type: String(x.type || ''),
        bronZipLabel: x.bronZipLabel ? String(x.bronZipLabel) : undefined,
      }))
      .filter((d: DocumentInfo) => Boolean(d.url?.trim() || d.localNaam?.trim()))
  } catch {
    return []
  }
}

/** Alleen URL's die letterlijk in excerpt voorkomen (geen hallucinaties). */
function filterDocsUrlInExcerpt(docs: DocumentInfo[], excerpt: string): DocumentInfo[] {
  return docs.filter(d => d.url && excerpt.includes(d.url))
}

async function aiSuggestExtraDocuments(
  excerpt: string,
  already: DocumentInfo[],
  titel: string
): Promise<DocumentInfo[]> {
  const excerptSlice = excerpt.slice(0, 120_000)
  if (excerptSlice.length < 50) return []

  const user = `Aanbesteding: ${titel.slice(0, 500)}

Hieronder staat geplakte tekst van de bronpagina (TenderNed/Mercell/e.d.). 

REGELS:
- Geef ALLEEN JSON-object: {"documenten":[{"url":"...","naam":"...","type":"..."}]}
- Elke "url" MOET exact als substring in de geplakte tekst voorkomen (copy-paste).
- Alleen echte tender-documenten of officiële downloadlinks; geen generieke menu-URL's.
- Laat documenten weg die al in deze lijst zitten: ${JSON.stringify(already.map(d => d.url).slice(0, 80))}

TEKST:
${excerptSlice}`

  const raw = await aiService.chat(
    [
      {
        role: 'system',
        content:
          'Je bent een assistent voor aanbestedingsdocumenten. Antwoord uitsluitend met geldige JSON, geen markdown. Verzin nooit URL\'s.',
      },
      { role: 'user', content: user },
    ],
    { preferJsonOutput: true }
  )

  const jsonStr = extractFirstJsonObject(raw) || raw.trim()
  let parsed: { documenten?: unknown }
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    log.warn('document-discovery: AI JSON parse failed')
    return []
  }
  const arr = parsed.documenten
  if (!Array.isArray(arr)) return []

  const out: DocumentInfo[] = []
  for (const x of arr as any[]) {
    const url = typeof x?.url === 'string' ? x.url.trim() : ''
    if (!url || !excerptSlice.includes(url)) continue
    out.push({
      url: normalizeUrl(url) || url,
      naam: String(x.naam || 'Document').slice(0, 240),
      type: String(x.type || '').slice(0, 30),
    })
  }
  return out
}

type BronDetails = Awaited<ReturnType<typeof fetchBronPaginaDetails>>

/**
 * Schrijft documentlijst + navigatie + procedure naar de DB.
 * @param markComplete Zet `document_fetch_completed_at` wanneer de volledige discovery-keten klaar is.
 */
function persistDiscoveryState(
  tenderId: string,
  tenderRow: Record<string, unknown>,
  details: BronDetails,
  merged: DocumentInfo[],
  resolved: string,
  markComplete: boolean,
): void {
  const db = getDb()
  if (
    details.beschrijving &&
    details.beschrijving.length > (String(tenderRow.beschrijving || '').length || 0)
  ) {
    try {
      db.prepare('UPDATE aanbestedingen SET beschrijving = ?, ruwe_tekst = ? WHERE id = ?').run(
        details.beschrijving.slice(0, 5000),
        (details.volledigeTekst || '').slice(0, 50000),
        tenderId,
      )
    } catch (e) {
      log.warn('document-discovery: beschrijving update failed', e)
    }
  } else if (details.volledigeTekst) {
    try {
      db.prepare('UPDATE aanbestedingen SET ruwe_tekst = ? WHERE id = ?').run(
        details.volledigeTekst.slice(0, 50000),
        tenderId,
      )
    } catch {
      /* ignore */
    }
  }

  const textHarvest = [
    tenderRow.beschrijving,
    details.beschrijving,
    details.volledigeTekst || '',
    tenderRow.ruwe_tekst,
  ]
    .filter((x): x is string => Boolean(x && String(x).trim()))
    .join('\n\n')
  let navExisting: { url: string; titel: string; categorie: string }[] = []
  try {
    const ex = JSON.parse(String(tenderRow.bron_navigatie_links || '[]'))
    if (Array.isArray(ex)) {
      navExisting = ex
        .filter((x: unknown) => x && typeof (x as { url?: string }).url === 'string')
        .map((x: unknown) => {
          const o = x as { url: string; titel?: string; categorie?: string }
          return {
            url: String(o.url),
            titel: String(o.titel || o.url),
            categorie: String(o.categorie || 'Gerelateerde link'),
          }
        })
    }
  } catch {
    navExisting = []
  }
  const navMerged = mergeNavigatieLinkRows(navExisting, buildNavigatieLinksFromText(textHarvest))
  const linkRowsForProc: BronNavigatieLink[] = navMerged.map((n) => ({
    titel: n.titel,
    url: n.url,
    categorie: n.categorie,
  }))
  let procCtx =
    details.procedureContext ?? (resolved.trim() ? buildMinimalProcedureContext(resolved) : undefined)
  if (procCtx && linkRowsForProc.length) {
    procCtx = mergeProcedurePortals(procCtx, linkRowsForProc)
    procCtx = attachLinksToTimeline(procCtx, linkRowsForProc)
  }

  if (markComplete) {
    db.prepare(
      `UPDATE aanbestedingen SET document_urls = ?, bron_navigatie_links = ?, tender_procedure_context = ?, updated_at = datetime('now'), document_fetch_completed_at = datetime('now') WHERE id = ?`,
    ).run(
      JSON.stringify(merged),
      JSON.stringify(navMerged),
      procCtx ? JSON.stringify(procCtx) : null,
      tenderId,
    )
  } else {
    db.prepare(
      `UPDATE aanbestedingen SET document_urls = ?, bron_navigatie_links = ?, tender_procedure_context = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(
      JSON.stringify(merged),
      JSON.stringify(navMerged),
      procCtx ? JSON.stringify(procCtx) : null,
      tenderId,
    )
  }
}

export interface PendingDocumentFetchRow {
  id: string
  titel: string
}

/** Aanbestedingen (niet-upload) waarbij post-scrape documentophaling nog niet is afgerond. */
export function getPendingDocumentFetchRows(): PendingDocumentFetchRow[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT id, titel FROM aanbestedingen
       WHERE document_fetch_completed_at IS NULL
         AND bron_url IS NOT NULL AND TRIM(bron_url) != ''
         AND is_upload = 0
       ORDER BY created_at ASC`,
    )
    .all() as PendingDocumentFetchRow[]
}

export async function discoverDocumentsFromBronWithAi(
  tenderId: string,
  settings: Record<string, string>,
  onProgress: (p: DiscoverProgress) => void
): Promise<{ success: true; documentCount: number } | { success: false; error: string }> {
  const db = getDb()
  let tender = db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(tenderId) as Record<
    string,
    unknown
  >
  if (!tender) {
    return { success: false, error: 'Aanbesteding niet gevonden' }
  }
  if (!String(tender.bron_url || '').trim()) {
    return { success: false, error: 'Geen bron-URL voor tracking' }
  }

  const resolved = resolveCanonicalBronUrlForAnalysis(String(tender.bron_url as string))

  onProgress({ step: 'Bron tracking: tabbladen & API (TenderNed/Mercell)…', percentage: 12 })
  let details: Awaited<ReturnType<typeof fetchBronPaginaDetails>>
  try {
    let scrapeFloor = 12
    details = await fetchBronPaginaDetails(resolved, {
      tenderId,
      onProgress: ({ step, percentage }) => {
        const mapped = 12 + Math.round(Math.max(0, Math.min(5, percentage - 3)) * 2)
        scrapeFloor = Math.max(scrapeFloor, Math.min(40, mapped))
        onProgress({ step, percentage: scrapeFloor })
      },
    })
  } catch (e: any) {
    log.error('document-discovery fetch failed', e)
    return { success: false, error: e?.message || 'Tracking mislukt' }
  }

  onProgress({ step: 'Documentlinks uit tekst en bestaande lijst samenvoegen…', percentage: 45 })
  const existing = parseStoredDocumentUrls(tender.document_urls as string | null | undefined)
  const fromText = extractDocumentUrlsFromPlainText(details.volledigeTekst || '')
  let merged = mergeDocumentLists(existing, details.documenten || [], fromText)

  onProgress({ step: 'ZIP-bundels uitpakken (documentlijst)…', percentage: 50 })
  merged = omitZipDownloadsWhenPartsAlreadyInList(merged)
  merged = await expandZipEntriesInDocumentList(
    tenderId,
    merged,
    details.sessionPartition,
    resolved
  )

  try {
    persistDiscoveryState(tenderId, tender, details, merged, resolved, false)
    tender = db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(tenderId) as Record<
      string,
      unknown
    >
  } catch (e: unknown) {
    log.warn('document-discovery: tussentijdse opslag mislukt', e)
  }

  onProgress({ step: 'AI controleert op aanvullende documentlinks (alleen uit de tekst)…', percentage: 62 })
  try {
    aiService.configure(settings)
    if (await aiService.isAvailable()) {
      const aiExtra = await aiSuggestExtraDocuments(
        details.volledigeTekst || '',
        merged,
        String(tender.titel || ''),
      )
      merged = mergeDocumentLists(merged, filterDocsUrlInExcerpt(aiExtra, details.volledigeTekst || ''))
    }
  } catch (e: any) {
    log.warn('document-discovery: AI stap overgeslagen', e?.message)
  }

  onProgress({ step: 'ZIP opnieuw controleren (na AI-links)…', percentage: 72 })
  merged = omitZipDownloadsWhenPartsAlreadyInList(merged)
  merged = await expandZipEntriesInDocumentList(
    tenderId,
    merged,
    details.sessionPartition,
    resolved
  )

  onProgress({ step: 'Opslaan in database…', percentage: 88 })

  try {
    persistDiscoveryState(tenderId, tender, details, merged, resolved, true)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Opslaan mislukt'
    return { success: false, error: msg }
  }

  onProgress({ step: `Klaar — ${merged.length} document(en)`, percentage: 100 })
  log.info(`document-discovery: tender ${tenderId} → ${merged.length} documenten`)
  return { success: true, documentCount: merged.length }
}
