import { BrowserWindow, session, type DownloadItem } from 'electron'
import log from 'electron-log'
import fs from 'fs'
import path from 'path'
import {
  assertSafeDocumentFileName,
  getDocumentsPath,
  getTenderDocumentsDir,
  listTenderDocumentFiles,
  resolveTenderDocumentFile,
} from '../utils/paths'
import {
  detectDocumentLocation,
  extractMercellUrls,
  isTenderNedMercellImportedNotice,
  pickPreferredMercellUrl,
  textMentionsMercell,
} from '../ai/location-detector'
import type { StoredDocumentEntry, TenderProcedureContext } from '../../shared/types'
import { isZipDocumentEntryLike } from '../../shared/document-entry'
import { buildMinimalProcedureContext, buildTenderProcedureContextFromTnsApi } from './procedure-context'

export type DocumentInfo = StoredDocumentEntry

export interface BronPaginaDetails {
  beschrijving: string
  documenten: DocumentInfo[]
  volledigeTekst: string
  /** Voor downloads met zelfde cookies als ingelogde bron-sessie */
  sessionPartition?: string
  procedureContext?: TenderProcedureContext
}

/** Tussentijdse voortgang tijdens `fetchBronPaginaDetails` (kan lang duren door API + verborgen browser). */
export type BronFetchOnProgress = (p: { step: string; percentage: number }) => void

const TENDERNED_TAB_LABELS = ['Details', 'Publicatie', 'Documenten', 'Vraag en antwoord']
const MERCELL_TAB_LABELS = [
  'Details',
  'Documenten',
  'Documents',
  'Files',
  'Bestanden',
  'Bijlagen',
  'Downloads',
  'Vragenlijst',
  'Vragenlijsten',
  'Questionnaire',
  'Questionnaires',
  'Forms',
  'Formulieren',
  'Q&A',
  'Questions',
  'Notities',
]

/**
 * Mercell toont vaak alleen verwijzingen tot je «EXPORTEER TENDER» gebruikt; dan verschijnen
 * downloadbare bestanden / een bundel. Voer uit vóór tab-scrape (verborgen BrowserWindow).
 */
const MERCELL_CLICK_EXPORT_TENDER_JS = `(function() {
  function norm(s) { return (s || '').replace(/\\s+/g, ' ').trim().toLowerCase(); }
  function allClickables(root, acc) {
    acc = acc || [];
    if (!root) return acc;
    try {
      var sel = root.querySelectorAll('button, a[href], [role="button"], input[type="button"], input[type="submit"]');
      for (var i = 0; i < sel.length; i++) acc.push(sel[i]);
      var all = root.querySelectorAll('*');
      for (var j = 0; j < all.length; j++) {
        var sh = all[j].shadowRoot;
        if (sh) allClickables(sh, acc);
      }
      var iframes = root.querySelectorAll('iframe');
      for (var fi = 0; fi < iframes.length; fi++) {
        try {
          var idoc = iframes[fi].contentDocument;
          if (idoc) allClickables(idoc, acc);
        } catch (eIf) {}
      }
    } catch (e) {}
    return acc;
  }
  function scoreText(t) {
    t = norm(t);
    if (!t || t.length > 160) return 0;
    if (t.indexOf('exporteer') !== -1 && t.indexOf('tender') !== -1) return 100;
    if (t.indexOf('tender exporteren') !== -1) return 100;
    if (t.indexOf('export tender') !== -1) return 98;
    if (t.indexOf('download tender') !== -1) return 96;
    if (t === 'exporteer tender' || t.indexOf('exporteer tender') !== -1) return 100;
    if (t.indexOf('export') !== -1 && t.indexOf('tender') !== -1) return 92;
    return 0;
  }
  function robustClick(el) {
    try { el.click(); return; } catch (e1) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch (e2) {}
  }
  var nodes = allClickables(document, []);
  var best = null, bestScore = 0, bestLabel = '';
  for (var k = 0; k < nodes.length; k++) {
    var el = nodes[k];
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    var txt = norm(el.textContent || el.innerText || '');
    var aria = norm(el.getAttribute('aria-label') || '');
    var title = norm(el.getAttribute('title') || '');
    var tid = norm(el.getAttribute('data-testid') || '');
    var sc = Math.max(scoreText(txt), scoreText(aria), scoreText(title));
    if (tid.indexOf('export') !== -1 && tid.indexOf('tender') !== -1) sc = Math.max(sc, 90);
    if (sc > bestScore) {
      bestScore = sc;
      best = el;
      bestLabel = (txt || aria || title).slice(0, 100);
    }
  }
  if (best && bestScore >= 90) {
    try { best.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}
    robustClick(best);
    return { clicked: true, label: bestLabel, score: bestScore };
  }
  return { clicked: false, label: '', score: bestScore };
})()`
const TED_TAB_LABELS = ['Documents', 'Documenten', 'PDF', 'Annexes', 'Bijlagen', 'Lots']
const BELGIUM_TAB_LABELS = [
  'Documenten',
  'Documents',
  'Publicatie',
  'Details',
  'Bijkomende informatie',
  'Overzicht',
]
const GENERIC_TAB_LABELS = ['Documenten', 'Documents', 'Details', 'Downloads', 'Bijlagen', 'Attachments']

interface TabScrapeTiming {
  startExpandMs: number
  preClickMs: number
  afterClickMs: number
  postExpandMs: number
}

/** Kortere waits: SPA’s zijn meestal binnen ~1,5 s stabiel na tabklik. */
const TAB_SCRAPE_TIMING_FAST: TabScrapeTiming = {
  startExpandMs: 350,
  preClickMs: 120,
  afterClickMs: 1500,
  postExpandMs: 200,
}

/** TenderNed Angular-tabbladen soms traag; iets langere waits na tabklik. */
const TAB_SCRAPE_TIMING_TENDERNED: TabScrapeTiming = {
  startExpandMs: 450,
  preClickMs: 160,
  afterClickMs: 2400,
  postExpandMs: 280,
}

/** Voorkom oneindig hangen op loadURL / executeJavaScript (login, netwerk, SPA). */
const PAGE_LOAD_TIMEOUT_MS = 55_000
const TAB_SCRIPT_TIMEOUT_MS = 150_000
/** Max wachten op Mercell native export-download(s) na tab-scrape. */
const MERCELL_NATIVE_DOWNLOAD_WAIT_MS = 110_000
const DOCUMENT_DOWNLOAD_TIMEOUT_MS = 120_000
const TNS_JSON_TIMEOUT_MS = 35_000

const TNS_PUBLICATIES_BASE = 'https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties'

function tendernedTnsHeaders(): HeadersInit {
  return {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (compatible; TenderTracker/1.0)',
  }
}

/**
 * Openbare TenderNed TNS JSON (zelfde bron als scrape). Geen browser nodig — voorkomt vastlopers
 * door SPA/tab-kliks. Document-URLs: …/publicaties/{id}/documenten/.../content
 */
export async function fetchTenderNedFromTnsApi(publicatieId: string): Promise<BronPaginaDetails | null> {
  const id = String(publicatieId).replace(/[^0-9]/g, '')
  if (!id) return null

  try {
    const headers = tendernedTnsHeaders()
    const [detailRes, docRes] = await Promise.all([
      raceTimeout(
        fetch(`${TNS_PUBLICATIES_BASE}/${id}`, { headers }),
        TNS_JSON_TIMEOUT_MS,
        'TenderNed TNS detail'
      ),
      raceTimeout(
        fetch(`${TNS_PUBLICATIES_BASE}/${id}/documenten`, { headers }),
        TNS_JSON_TIMEOUT_MS,
        'TenderNed TNS documenten'
      ),
    ])
    if (!detailRes.ok) {
      log.warn(`TenderNed TNS detail ${id}: HTTP ${detailRes.status}`)
      return null
    }
    const d = (await detailRes.json()) as Record<string, unknown>

    const documenten: DocumentInfo[] = []
    try {
      if (docRes.ok) {
        const dj = (await docRes.json()) as {
          documenten?: Record<string, unknown>[]
          links?: { downloadZip?: { href?: string } }
        }
        for (const doc of dj.documenten || []) {
          const links =
            (doc.links as { download?: { href?: string } } | undefined) ||
            (doc.link as { download?: { href?: string } } | undefined)
          const href = links?.download?.href
          if (!href || typeof href !== 'string') continue
          const abs = href.startsWith('http') ? href : `https://www.tenderned.nl${href}`
          const td = doc.typeDocument as { code?: string } | undefined
          documenten.push({
            url: abs,
            naam: String(doc.documentNaam || 'document').slice(0, 220),
            type: String(td?.code || 'pdf').toLowerCase(),
          })
        }
        const zipHref = dj.links?.downloadZip?.href
        if (zipHref && typeof zipHref === 'string') {
          const abs = zipHref.startsWith('http') ? zipHref : `https://www.tenderned.nl${zipHref}`
          documenten.push({
            url: abs,
            naam: `TenderNed alle documenten (${id}).zip`,
            type: 'zip',
          })
        }
      } else {
        log.warn(`TenderNed TNS documenten ${id}: HTTP ${docRes.status}`)
      }
    } catch (e: unknown) {
      log.warn(`TenderNed TNS documentenlijst ${id}:`, e)
    }

    const lines: string[] = ['=== TenderNed publicatie (openbare TNS API) ===']
    const push = (label: string, val: unknown) => {
      if (val === null || val === undefined || val === '') return
      if (typeof val === 'object') {
        try {
          lines.push(`${label}: ${JSON.stringify(val)}`)
        } catch {
          lines.push(`${label}: [object]`)
        }
      } else {
        lines.push(`${label}: ${val}`)
      }
    }

    push('Publicatie-id', d.publicatieId)
    push('Kenmerk', d.kenmerk)
    push('Titel', d.aanbestedingNaam)
    push('Opdrachtgever', d.opdrachtgeverNaam)
    push('Beschrijving', d.opdrachtBeschrijving)
    push('Type opdracht', d.typeOpdrachtCode)
    push('Procedure', d.procedureCode)
    push('Publicatiedatum', d.publicatieDatum)
    push('Sluitingsdatum inschrijving', d.sluitingsDatum)
    push('Sluitingsdatum marktconsultatie', d.sluitingsDatumMarktconsultatie)
    push('CPV-codes', d.cpvCodes)
    push('NUTS', d.nutsCodes)
    push(
      'Trefwoorden',
      [d.trefwoord1, d.trefwoord2, d.trefwoord3, d.trefwoord4].filter(Boolean).join('; ')
    )
    push('Type publicatie', d.typePublicatie)
    push('Publicatiecode', d.publicatieCode)
    push('Aanbesteding status', d.aanbestedingStatus)

    const beschrijving = String(d.opdrachtBeschrijving || '').slice(0, 12000)
    const volledigeTekst = lines.join('\n').slice(0, 200_000)

    log.info(`TenderNed TNS API ${id}: ${documenten.length} documenten, ${volledigeTekst.length} tekens`)

    const procedureContext = buildTenderProcedureContextFromTnsApi(d as Record<string, unknown>, {
      publicatieId: id,
      bronUrl: `https://www.tenderned.nl/aankondigingen/overzicht/${id}`,
    })

    return {
      beschrijving,
      documenten: filterRealDocumentLinks(documenten),
      volledigeTekst,
      sessionPartition: undefined,
      procedureContext,
    }
  } catch (e: unknown) {
    log.warn(`fetchTenderNedFromTnsApi(${id}):`, e)
    return null
  }
}

function raceTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}: timeout na ${Math.round(ms / 1000)}s`))
    }, ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/** Geen echte bijlagen: social, tracking, of “deel”-links die TenderNed soms als <a> toont. */
const OFFSITE_NON_DOCUMENT_RE =
  /linkedin\.com|licdn\.com|facebook\.com|fb\.com|twitter\.com|^https?:\/\/x\.com\/|instagram\.com|whatsapp\.com|tiktok\.com|youtube\.com\/watch|youtu\.be|pinterest\.com|shareArticle|sharing\/share-offsite|intent\/tweet|addthis\.com/i

export function isSkippableOffsiteDocumentUrl(url: string): boolean {
  if (!url?.trim()) return false
  try {
    return OFFSITE_NON_DOCUMENT_RE.test(url)
  } catch {
    return true
  }
}

/** ZIP-bundel uit bron (TenderNed “alle documenten” of .zip-URL). */
export function isZipDocumentEntry(d: DocumentInfo): boolean {
  return isZipDocumentEntryLike(d)
}

/** Dedup-sleutel voor URL- én lokaal-opgeslagen bijlagen (Mercell native download). */
export function documentEntryDedupKey(d: DocumentInfo): string {
  const u = d.url?.trim()
  if (u) {
    try {
      return `url:${new URL(u).href.split('#')[0]}`
    } catch {
      return `url:${u.split('#')[0]}`
    }
  }
  const loc = d.localNaam?.trim()
  if (loc) return `local:${loc}`
  return ''
}

function mergeDocumentInfosDeduped(docs: DocumentInfo[]): DocumentInfo[] {
  const map = new Map<string, DocumentInfo>()
  for (const d of docs) {
    const k = documentEntryDedupKey(d)
    if (!k) continue
    if (!map.has(k)) map.set(k, d)
  }
  return [...map.values()]
}

function filterRealDocumentLinks(docs: DocumentInfo[]): DocumentInfo[] {
  return docs.filter((d) => {
    if (d?.localNaam?.trim() && !d?.url?.trim()) return true
    return Boolean(d?.url && !isSkippableOffsiteDocumentUrl(d.url))
  })
}

function isMercellHostHint(url: string): boolean {
  return /mercell\.(com|eu)|negometrix\.com|s2c\.mercell/i.test(url)
}

function safeMercellDownloadBaseName(suggested: string): string {
  const raw = (suggested || 'mercell-export.zip').trim()
  const base = path.basename(raw).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'mercell_export.zip'
  return assertSafeDocumentFileName(base) || 'mercell_export.zip'
}

function mercellUrlsFromTenderNedDocLinks(docs: DocumentInfo[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const d of docs) {
    if (!d?.url) continue
    const u = d.url.toLowerCase()
    if (!u.includes('mercell') && !u.includes('negometrix') && !u.includes('s2c.mercell')) continue
    try {
      const h = new URL(d.url).href.split('#')[0]
      if (!seen.has(h)) {
        seen.add(h)
        out.push(h)
      }
    } catch {
      /* skip */
    }
  }
  return out
}

/** Combineer openbare TNS-JSON met tab-scrape (Q&A, extra links) zonder dubbele URLs. */
function mergeBronPaginaDetails(
  api: BronPaginaDetails | null | undefined,
  page: BronPaginaDetails | null | undefined
): BronPaginaDetails {
  const aHas =
    api &&
    ((api.beschrijving && api.beschrijving.trim().length > 0) ||
      (api.volledigeTekst && api.volledigeTekst.trim().length > 0) ||
      (api.documenten && api.documenten.length > 0))
  const bHas =
    page &&
    ((page.beschrijving && page.beschrijving.trim().length > 0) ||
      (page.volledigeTekst && page.volledigeTekst.trim().length > 0) ||
      (page.documenten && page.documenten.length > 0))

  if (!aHas && !bHas) return { beschrijving: '', documenten: [], volledigeTekst: '' }
  if (aHas && !bHas) return { ...api! }
  if (!aHas && bHas) return { ...page! }

  const a = api!
  const b = page!
  const docMap = new Map<string, DocumentInfo>()
  const docKey = (d: DocumentInfo) => {
    const u = d.url?.trim()
    if (u) {
      try {
        return new URL(u).href.split('#')[0].split('?')[0]
      } catch {
        return u.split('?')[0].split('#')[0]
      }
    }
    if (d.localNaam?.trim()) return `local:${d.localNaam.trim()}`
    return ''
  }
  for (const d of [...(a.documenten || []), ...(b.documenten || [])]) {
    const k = docKey(d)
    if (!k) continue
    const ex = docMap.get(k)
    if (!ex) {
      docMap.set(k, { ...d })
      continue
    }
    const localNaam = d.localNaam?.trim() || ex.localNaam?.trim() || undefined
    docMap.set(k, {
      url: d.url?.trim() || ex.url?.trim() || '',
      naam:
        d.naam?.trim() && (!ex.naam?.trim() || d.naam.trim().length > (ex.naam?.trim().length || 0))
          ? d.naam.trim()
          : ex.naam?.trim() || d.naam?.trim() || 'Document',
      type: d.type?.trim() || ex.type?.trim() || '',
      ...(localNaam ? { localNaam } : {}),
      ...(d.bronZipLabel?.trim() || ex.bronZipLabel?.trim()
        ? { bronZipLabel: d.bronZipLabel?.trim() || ex.bronZipLabel?.trim() }
        : {}),
    })
  }
  const beschrijving =
    (a.beschrijving?.length || 0) >= (b.beschrijving?.length || 0) ? a.beschrijving : b.beschrijving
  const volledigeTekst = [a.volledigeTekst?.trim(), b.volledigeTekst?.trim()]
    .filter(Boolean)
    .join('\n\n---\n\n')
    .slice(0, 200_000)
  const procedureContext = a.procedureContext ?? b.procedureContext
  return {
    beschrijving: (beschrijving || '').slice(0, 12_000),
    documenten: [...docMap.values()],
    volledigeTekst,
    procedureContext,
  }
}

/** Publieke TenderNed-URL → numeriek publicatie-id */
export function extractTenderNedPublicatieId(bronUrl: string): string | null {
  const u = bronUrl.trim()
  const canon =
    u.match(/\/aankondigingen\/(?:overzicht|details|bekendmaking)\/(\d{4,})(?:\/|[?#]|$)/i) ||
    u.match(/[?&]publicatie(?:Id)?=(\d{4,})/i)
  if (canon) return canon[1]
  const m =
    u.match(/tenderned\.nl\/[^?\s#]+\/(\d{4,})(?:\/?|[?#])/) ||
    u.match(/\/aankondigingen\/[^?\s#]+\/(\d{4,})/) ||
    u.match(/\/publicat(?:ie|ies)\/(\d{4,})(?:\/|[?#]|$)/i) ||
    u.match(/\/(\d{6,})\/?(?:\?|#|$)/)
  return m?.[1] ?? null
}

/**
 * Zelfde bron als in de app (knop «Bekijk op bron»): protocol + voor TenderNed altijd
 * de canonieke overzichtspagina met tabbladen.
 */
export function resolveCanonicalBronUrlForAnalysis(bronUrl: string): string {
  let url = bronUrl.trim()
  if (!url) return url
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('tenderned.nl')) {
      const id = extractTenderNedPublicatieId(url)
      if (id) return `https://www.tenderned.nl/aankondigingen/overzicht/${id}`
    }
  } catch {
    return bronUrl.trim()
  }
  return url
}

function getPartitionForBronUrl(url: string): string | undefined {
  try {
    const h = new URL(url).hostname.toLowerCase()
    if (h.includes('tenderned.nl')) return 'persist:auth-tenderned'
    if (h.includes('mercell') || h.includes('negometrix') || h.includes('s2c.')) return 'persist:auth-mercell'
    if (h.includes('publicprocurement.be') || h.includes('ebuyprocurement')) return 'persist:auth-belgium'
    return undefined
  } catch {
    return undefined
  }
}

/** Zelfde sessie als bij inloggen op de bron — voor downloads na ophalen uit DB. */
export function getSessionPartitionForBronUrl(bronUrl?: string): string | undefined {
  if (!bronUrl?.trim()) return undefined
  let u = bronUrl.trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  return getPartitionForBronUrl(u)
}

/**
 * Hoofdingang: laadt de echte bron-URL, klikt door tabbladen (zoals op TenderNed:
 * Details, Publicatie, Documenten, Vraag en antwoord), verzamelt tekst en documentlinks.
 * Gebruikt dezelfde auth-partitie als bij inloggen op die bron (indien van toepassing).
 */
export async function fetchBronPaginaDetails(
  bronUrl: string,
  options?: { onProgress?: BronFetchOnProgress; tenderId?: string }
): Promise<BronPaginaDetails> {
  const empty = (): BronPaginaDetails => ({
    beschrijving: '',
    documenten: [],
    volledigeTekst: '',
  })

  if (!bronUrl?.trim()) return empty()
  let url = bronUrl.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`

  const op = options?.onProgress
  const tenderIdOpt = options?.tenderId?.trim() || undefined

  try {
    const host = new URL(url).hostname.toLowerCase()
    const partition = getPartitionForBronUrl(url)

    if (host.includes('tenderned.nl')) {
      const id = extractTenderNedPublicatieId(url)
      const loadUrl = id ? `https://www.tenderned.nl/aankondigingen/overzicht/${id}` : url
      op?.({
        step: id
          ? `TenderNed: TNS-API en browservenster starten (publicatie ${id})…`
          : 'TenderNed: browservenster starten…',
        percentage: 3,
      })
      // Altijd tab-scrape in de browser (Details, Publicatie, Documenten, V&A); TNS-API parallel voor snellere/betrouwbare document-URLs + merge.
      const tnsPromise = id ? fetchTenderNedFromTnsApi(id) : Promise.resolve(null)
      void tnsPromise
        .then(() => {
          op?.({
            step: 'TenderNed: openbare API-data binnen; tabbladen-tracking loopt nog of is klaar…',
            percentage: 4,
          })
        })
        .catch(() => {})
      const browserPromise = fetchTenderPageWithTabs(
        loadUrl,
        TENDERNED_TAB_LABELS,
        partition,
        4800,
        TAB_SCRAPE_TIMING_TENDERNED,
        op,
        tenderIdOpt
      )
      const [tns, browserTabs] = await Promise.all([tnsPromise, browserPromise])
      op?.({
        step: 'TenderNed: API + tabbladen samengevoegd; documentlijst opbouwen…',
        percentage: 8,
      })
      let merged = mergeBronPaginaDetails(tns, browserTabs)
      const realDocs = filterRealDocumentLinks(merged.documenten)
      const importedMercellNotice = isTenderNedMercellImportedNotice(merged.volledigeTekst || '')

      log.info(
        `TenderNed bron samengevoegd (${id || 'geen id'}): API-docs ${tns?.documenten?.length ?? 0}, tab-docs ${browserTabs.documenten.length}, totaal ${realDocs.length}${importedMercellNotice ? '; geïmporteerde Mercell-aankondiging (TenderNed → Mercell als documentbron)' : ''}`
      )

      // ── Mercell: vaak gelinkt vanaf TenderNed (o.a. blauwe balk “geïmporteerde aankondiging”, linktekst “Mercell”);
      // altijd TenderNed (API + tabbladen) én Mercell proberen; dedup op URL; bij import voorkeur Mercell-bestanden.
      const mercellInText = extractMercellUrls(merged.volledigeTekst || '')
      const mercellInLinks = mercellUrlsFromTenderNedDocLinks(realDocs)
      const allMercellCandidates = [...new Set([...mercellInText, ...mercellInLinks])]
      const shouldFetchMercellByUrl = allMercellCandidates.length > 0
      const shouldRunLocationDetector =
        !!merged.volledigeTekst &&
        allMercellCandidates.length === 0 &&
        (textMentionsMercell(merged.volledigeTekst) || importedMercellNotice)

      if (shouldFetchMercellByUrl || shouldRunLocationDetector) {
        let mercellUrlToFetch: string | null = null
        let mercellExtraNote = ''
        const tryUrlsOrdered: string[] = []

        if (shouldFetchMercellByUrl) {
          const preferred = pickPreferredMercellUrl(allMercellCandidates)!
          mercellUrlToFetch = preferred
          tryUrlsOrdered.push(...allMercellCandidates)
          mercellExtraNote =
            (importedMercellNotice ? 'Geïmporteerde aankondiging op TenderNed — primaire documenten op Mercell. ' : '') +
            `Mercell/Negometrix gelinkt vanaf TenderNed (${allMercellCandidates.length} URL(s)); documenten daar opgehaald.`
          log.info(
            `TenderNed (${id}): Mercell-kandidaten ${allMercellCandidates.length}, voorkeur ${preferred}`
          )
        }

        if (!mercellUrlToFetch && shouldRunLocationDetector) {
          log.info(`TenderNed (${id}): locationDetector (Mercell genoemd, geen parseerbare URL)`)
          try {
            const { getDb } = await import('../db/connection')
            const dbSettings = (getDb().prepare(
              "SELECT key, value FROM app_settings WHERE key IN ('openai_detection_api_key', 'ai_api_key', 'ai_provider')"
            ).all() as { key: string; value: string }[]).reduce<Record<string, string>>(
              (acc, r) => { acc[r.key] = r.value; return acc },
              {}
            )
            const detectionKey =
              dbSettings.openai_detection_api_key ||
              (dbSettings.ai_provider === 'openai' ? dbSettings.ai_api_key : undefined)

            const detection = await detectDocumentLocation(
              merged.volledigeTekst,
              url,
              detectionKey || undefined
            )

            log.info(
              `LocationDetector result: platform=${detection.platform} url=${detection.mercellUrl} confidence=${detection.confidence}`
            )

            if (
              detection.mercellUrl &&
              (detection.platform === 'mercell' || detection.platform === 'negometrix')
            ) {
              mercellUrlToFetch = detection.mercellUrl
              if (!tryUrlsOrdered.includes(detection.mercellUrl)) {
                tryUrlsOrdered.unshift(detection.mercellUrl)
              }
              mercellExtraNote = detection.additionalInfo || mercellExtraNote
            } else if (detection.platform !== 'none') {
              log.info(`LocationDetector: ${detection.platform} — ${detection.additionalInfo}`)
            }
          } catch (detErr: unknown) {
            log.warn('LocationDetector mislukt:', detErr)
          }
        }

        if (mercellUrlToFetch && tryUrlsOrdered.length === 0) {
          tryUrlsOrdered.push(mercellUrlToFetch)
        }

        const orderedUnique = [...new Set([mercellUrlToFetch!, ...tryUrlsOrdered].filter(Boolean))].slice(0, 6)

        if (mercellUrlToFetch) {
          let mercellFetchYieldedDocs = false
          for (let ti = 0; ti < orderedUnique.length; ti++) {
            const tryUrl = orderedUnique[ti]
            try {
              op?.({
                step: `Mercell/Negometrix: pagina ${ti + 1}/${orderedUnique.length} openen; tabbladen- en documenttracking…`,
                percentage: 8,
              })
              log.info(`Mercell ophalen (${ti + 1}/${orderedUnique.length}): ${tryUrl}`)
              const mercellPartition = getPartitionForBronUrl(tryUrl)
              const mercellResult = await fetchTenderPageWithTabs(
                tryUrl,
                MERCELL_TAB_LABELS,
                mercellPartition,
                4800,
                TAB_SCRAPE_TIMING_TENDERNED,
                op,
                tenderIdOpt
              )
              const mercellDocs = filterRealDocumentLinks(mercellResult.documenten)
              log.info(`Mercell: ${mercellDocs.length} documenten bij ${tryUrl}`)

              const docMap = new Map<string, DocumentInfo>()
              for (const d of [...realDocs, ...mercellDocs]) {
                const k = documentEntryDedupKey(d)
                if (!k) continue
                if (!docMap.has(k)) docMap.set(k, d)
              }
              let mergedDocs = [...docMap.values()]

              if (importedMercellNotice && mercellDocs.length > 0) {
                mergedDocs = mergedDocs.filter((d) => {
                  if (!d.url) return true
                  const u = d.url.toLowerCase()
                  if (!u.includes('tenderned.nl')) return true
                  if (/\/papi\/[^/]*\/publicaties\/\d+\/documenten\//i.test(d.url)) return false
                  if (/downloadzip|\/documenten\/zip/i.test(u)) return false
                  return true
                })
                log.info(
                  `TenderNed import-Mercell: TenderNed-API/tijdelijke bijlagen uit lijst gehaald; ${mergedDocs.length} document(en) over (Mercell + overig).`
                )
              }

              const mercellNote =
                `\n\n=== Documenten / tekst Mercell (${tryUrl}) ===\n` +
                `${mercellExtraNote ? mercellExtraNote + '\n' : ''}` +
                mercellResult.volledigeTekst.slice(0, 80_000)

              merged = {
                beschrijving: merged.beschrijving || mercellResult.beschrijving,
                documenten: mergedDocs,
                volledigeTekst: (merged.volledigeTekst + mercellNote).slice(0, 200_000),
                sessionPartition: mercellPartition || partition,
                procedureContext: merged.procedureContext,
              }

              if (mercellDocs.length > 0) {
                mercellFetchYieldedDocs = true
                break
              }
            } catch (e: unknown) {
              log.warn(`Mercell fetch mislukt voor ${tryUrl}:`, e)
            }
          }
          if (importedMercellNotice && mercellUrlToFetch && !mercellFetchYieldedDocs) {
            log.warn(
              `TenderNed (${id}): geïmporteerde Mercell-melding maar geen documenten op Mercell opgehaald — controleer Mercell-sessie (inlog) of OpenAI-detectiesleutel voor URL-herkenning.`
            )
          }
        }
      }

      return {
        ...merged,
        sessionPartition: merged.sessionPartition ?? partition,
        documenten: filterRealDocumentLinks(merged.documenten),
        procedureContext: merged.procedureContext ?? buildMinimalProcedureContext(url),
      }
    }

    if (host.includes('mercell.com') || host.includes('negometrix') || host.includes('s2c.mercell')) {
      op?.({ step: 'Mercell: pagina laden en tabbladen tracking…', percentage: 3 })
      const r = await fetchTenderPageWithTabs(
        url,
        MERCELL_TAB_LABELS,
        partition,
        4800,
        TAB_SCRAPE_TIMING_TENDERNED,
        op,
        tenderIdOpt
      )
      return {
        ...r,
        sessionPartition: partition,
        documenten: filterRealDocumentLinks(r.documenten),
        procedureContext: buildMinimalProcedureContext(url),
      }
    }

    if (host.includes('ted.europa.eu')) {
      op?.({ step: 'TED: pagina laden en documenttabbladen tracking…', percentage: 3 })
      const r = await fetchTenderPageWithTabs(
        url,
        TED_TAB_LABELS,
        undefined,
        3500,
        TAB_SCRAPE_TIMING_FAST,
        op,
        tenderIdOpt
      )
      return {
        ...r,
        documenten: filterRealDocumentLinks(r.documenten),
        procedureContext: buildMinimalProcedureContext(url),
      }
    }

    if (host.includes('publicprocurement.be') || host.includes('ebuyprocurement')) {
      op?.({ step: 'Belgische aanbestedingspagina laden en tracking…', percentage: 3 })
      const r = await fetchTenderPageWithTabs(
        url,
        BELGIUM_TAB_LABELS,
        partition,
        4000,
        TAB_SCRAPE_TIMING_FAST,
        op,
        tenderIdOpt
      )
      return {
        ...r,
        sessionPartition: partition,
        documenten: filterRealDocumentLinks(r.documenten),
        procedureContext: buildMinimalProcedureContext(url),
      }
    }

    op?.({ step: 'Bronpagina laden en documenttabbladen tracking…', percentage: 3 })
    const r = await fetchTenderPageWithTabs(
      url,
      GENERIC_TAB_LABELS,
      partition,
      3200,
      TAB_SCRAPE_TIMING_FAST,
      op,
      tenderIdOpt
    )
    return {
      ...r,
      sessionPartition: partition,
      documenten: filterRealDocumentLinks(r.documenten),
      procedureContext: buildMinimalProcedureContext(url),
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    log.warn(`fetchBronPaginaDetails failed: ${msg}`)
    return empty()
  }
}

/**
 * @deprecated Gebruik fetchBronPaginaDetails(tender.bron_url). Behouden voor oude aanroepen.
 */
export async function fetchTenderNedDetails(publicatieId: string): Promise<BronPaginaDetails> {
  return fetchBronPaginaDetails(`https://www.tenderned.nl/aankondigingen/overzicht/${publicatieId}`)
}

function buildTabScrapeScript(tabLabelsJson: string, timing: TabScrapeTiming): string {
  const te = timing
  return `
(async function() {
  const TAB_LABELS = ${tabLabelsJson};
  const sleep = (ms) => new Promise(function(r) { setTimeout(r, ms); });

  function normalize(s) {
    return (s || '').replace(/\\s+/g, ' ').trim();
  }

  function isBlockedSocialOrShare(href) {
    if (!href) return true;
    var h = href.toLowerCase();
    if (h.indexOf('//x.com') !== -1) return true;
    return /linkedin\\.com|licdn\\.com|facebook\\.com|fb\\.com|twitter\\.com|instagram\\.com|whatsapp\\.com|tiktok\\.com|youtu\\.be|youtube\\.com\\/watch|sharearticle|sharing\\/share-offsite|intent\\/tweet|pinterest\\.com/i.test(h);
  }

  function looksLikeDocLink(href, text) {
    if (!href || href.indexOf('javascript:') === 0) return false;
    if (isBlockedSocialOrShare(href)) return false;
    var t = (text || '').toLowerCase();
    var h = href.toLowerCase();
    if (/tenderned\\.nl\\/papi\\/tenderned-rs-tns\\/v2\\/publicaties\\/\\d+\\/documenten\\/\\d+\\/content/i.test(h)) return true;
    if (/tenderned\\.nl\\/papi\\/[^?]+\\/content/i.test(h)) return true;
    if (/\\/documenten\\/(zip|[^?]+\\/content)/i.test(h)) return true;
    if (/(mercell\\.com|negometrix\\.com|s2c\\.mercell)/i.test(h) && (
      /\\.(pdf|docx?|xlsx?|zip|rar|xml|csv)(\\?|$)/i.test(h) ||
      /(\\/file\\/|\\/files\\/|\\/download|\\/attachment|\\/bijlage|\\/api\\/)/i.test(h)
    )) return true;
    if (/\\.(pdf|docx?|xlsx?|zip|rar|xml)(\\?|$)/i.test(h)) return true;
    if (/\\/document\\/|\\/bijlage\\/|\\/download\\/|\\/attachment\\/|\\/bestand\\/|filedownload|getfile/i.test(h)) return true;
    if (t.length < 140 && /download|bijlage|pdf|document|bestek|offerte|zip|excel|word/i.test(t)) return true;
    // Mercell/Negometrix: vragenlijsten en formulieren hebben vaak geen bestandsextensie in de URL (SPA/API-paden).
    if (/(mercell\\.com|negometrix\\.com|s2c\\.mercell)/i.test(h)) {
      if (/login|sign-?in|oauth|authorize|account\\/(?:login|register)|\\/help|\\/support|notifications|\\/today|\\/search|\\/discover|\\/home(?![a-z])/i.test(h)) return false;
      if (/(questionnaire|vragenlijst|questionnair|formtemplate|tenderresponse|bidresponse|submission|inschrijving|response\\/|\\/forms\\/|\\/form\\/)/i.test(h)) return true;
      if (t.length < 220 && /(vragenlijst|questionnaire|\\buea\\b|uniform europees|referentieverklaring|gunningscriteria|kwalitatief|\\bprijs\\b|bewijsmiddel)/i.test(t)) return true;
    }
    return false;
  }

  function collectDocLinksInRoot(root) {
    var docs = [];
    var seen = {};
    var links = root.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var href = link.href || '';
      var text = normalize(link.textContent) || 'Document';
      var hasDl = link.hasAttribute && link.hasAttribute('download');
      if (!hasDl && !looksLikeDocLink(href, text)) continue;
      if (hasDl && (!href || href.indexOf('javascript:') === 0 || isBlockedSocialOrShare(href))) continue;
      var key = href.split('#')[0].split('?')[0];
      if (seen[key]) continue;
      seen[key] = true;
      var ext = (href.match(/\\.([a-z0-9]+)(?:\\?|$)/i) || [,'pdf'])[1] || 'pdf';
      docs.push({
        url: href,
        naam: text.slice(0, 220),
        type: String(ext).toLowerCase()
      });
    }
    return docs;
  }

  function collectDocLinks() {
    var out = collectDocLinksInRoot(document);
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var fi = 0; fi < iframes.length; fi++) {
        try {
          var idoc = iframes[fi].contentDocument;
          if (idoc) {
            var inner = collectDocLinksInRoot(idoc);
            for (var j = 0; j < inner.length; j++) out.push(inner[j]);
          }
        } catch (eIf) {}
      }
    } catch (eI) {}
    return out;
  }

  function querySelectorAllDeep(selector, root) {
    root = root || document;
    var acc = [];
    try {
      var nodes = root.querySelectorAll(selector);
      for (var i = 0; i < nodes.length; i++) acc.push(nodes[i]);
      var all = root.querySelectorAll('*');
      for (var j = 0; j < all.length; j++) {
        var sh = all[j].shadowRoot;
        if (sh) {
          var inner = querySelectorAllDeep(selector, sh);
          for (var k = 0; k < inner.length; k++) acc.push(inner[k]);
        }
      }
    } catch (e0) {}
    return acc;
  }

  function isMercellPortalHref(href) {
    if (!href || href.indexOf('javascript:') === 0) return false;
    if (isBlockedSocialOrShare(href)) return false;
    var h = href.toLowerCase();
    if (h.indexOf('mercell') === -1 && h.indexOf('negometrix') === -1 && h.indexOf('s2c.mercell') === -1) return false;
    if (/login|sign-?in|oauth|authorize|\\/account\\/(?:login|register)|\\/help|\\/support|register|password|wachtwoord|reset-password/i.test(h)) return false;
    try {
      var pu = new URL(href);
      var path = (pu.pathname || '').replace(/\\/+$/, '');
      if (!path || path === '/') return false;
    } catch (eM) { return false; }
    return true;
  }

  function collectMercellPortalsFromRoot(root) {
    var links = querySelectorAllDeep('a[href]', root);
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href || '';
      if (!isMercellPortalHref(href)) continue;
      var key = href.split('#')[0].split('?')[0];
      if (mercellPortalSeen[key]) continue;
      mercellPortalSeen[key] = true;
      mercellPortalList.push(href);
    }
  }

  function absorbMercellPortals() {
    collectMercellPortalsFromRoot(document);
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var fi = 0; fi < iframes.length; fi++) {
        try {
          var idoc = iframes[fi].contentDocument;
          if (idoc) collectMercellPortalsFromRoot(idoc);
        } catch (eIf2) {}
      }
    } catch (eI2) {}
  }

  function tabLabelMatches(el, want) {
    var t = normalize(el.textContent).toLowerCase();
    var aria = (el.getAttribute && el.getAttribute('aria-label') || '').toLowerCase();
    var title = (el.getAttribute && el.getAttribute('title') || '').toLowerCase();
    if (t.length > 120) t = t.slice(0, 120);
    if (t === want || t.indexOf(want) === 0) return true;
    if (want.length >= 6 && t.indexOf(want) !== -1) return true;
    if (aria && (aria === want || aria.indexOf(want) !== -1)) return true;
    if (title && (title === want || title.indexOf(want) !== -1)) return true;
    return false;
  }

  function findClickableTab(label) {
    var want = label.toLowerCase();
    var selectors = [
      '[role="tablist"] [role="tab"]',
      '[role="tab"]',
      'button.mdc-tab',
      '.mdc-tab',
      '[class*="mat-mdc-tab"]',
      '.mat-mdc-tab',
      'button[class*="tab"]',
      'a[class*="tab"]',
      '.nav-link[role="tab"]',
      'ul[role="tablist"] li button',
      'ul[role="tablist"] li a',
      '[class*="Tabs"] button',
      '[class*="tabs"] button',
      'nav[role="tablist"] button',
      'nav[role="tablist"] a',
      '[class*="tab-label"]',
      'button[data-testid*="tab"]'
    ];
    for (var s = 0; s < selectors.length; s++) {
      var nodes = querySelectorAllDeep(selectors[s], document);
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        var tag = (el.tagName || '').toLowerCase();
        if (tag === 'svg' || tag === 'path') continue;
        if (!tabLabelMatches(el, want)) continue;
        var a = el.tagName && el.tagName.toLowerCase() === 'a' ? el : el.closest('a');
        if (a && a.href && isBlockedSocialOrShare(a.href)) continue;
        return el;
      }
    }
    return null;
  }

  function robustClick(el) {
    try {
      el.click();
      return;
    } catch (e1) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch (e2) {}
  }

  function expandCollapsed() {
    document.querySelectorAll('[aria-expanded="false"]').forEach(function(el) {
      try { el.click(); } catch (e) {}
    });
  }

  var mergeKeys = {};
  var mercellPortalSeen = {};
  var mercellPortalList = [];
  var allDocs = [];
  function mergeDocs(arr) {
    for (var i = 0; i < arr.length; i++) {
      var d = arr[i];
      var k = d.url.split('?')[0];
      if (!mergeKeys[k]) {
        mergeKeys[k] = true;
        allDocs.push(d);
      }
    }
  }

  var sections = [];

  expandCollapsed();
  await sleep(${te.startExpandMs});
  absorbMercellPortals();
  mergeDocs(collectDocLinks());
  sections.push('=== Initieel (zichtbare pagina) ===\\n' + (document.body.innerText || '').slice(0, 20000));

  for (var ti = 0; ti < TAB_LABELS.length; ti++) {
    var tabName = TAB_LABELS[ti];
    var el = findClickableTab(tabName);
    if (!el) {
      sections.push('\\n=== Tab "' + tabName + '" (knop niet gevonden) ===\\n');
      continue;
    }
    try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e2) {}
    await sleep(${te.preClickMs});
    robustClick(el);
    await sleep(${te.afterClickMs});
    expandCollapsed();
    await sleep(${te.postExpandMs});
    absorbMercellPortals();
    mergeDocs(collectDocLinks());
    sections.push('\\n=== ' + tabName + ' ===\\n' + (document.body.innerText || '').slice(0, 65000));
  }

  // Klik "Download (aanbestedingsstukken)" knoppen die een documentenlijst ontsluiten.
  // Dit zijn knoppen/links die GEEN echte navigatie doen maar een panel/modal openen.
  var downloadKeywords = ['exporteer tender', 'export tender', 'download tender', 'download', 'stukken downloaden', 'aanbestedingsstukken', 'bestekstukken', 'tender document', 'download all', 'alle documenten', 'vragenlijst', 'vragenlijsten', 'questionnaire', 'uea'];
  function looksLikeDownloadAction(el) {
    var t = normalize(el.textContent).toLowerCase();
    if (!t || t.length > 100) return false;
    return downloadKeywords.some(function(kw) { return t.indexOf(kw) !== -1; });
  }
  var downloadCandidates = querySelectorAllDeep('button, [role="button"], a[href="#"], a[href="javascript:void(0)"]', document);
  for (var bi = 0; bi < downloadCandidates.length; bi++) {
    var btn = downloadCandidates[bi];
    if (!looksLikeDownloadAction(btn)) continue;
    try {
      btn.scrollIntoView({ block: 'center', behavior: 'instant' });
      robustClick(btn);
    } catch (eBt) {}
  }
  await sleep(1500);
  mergeDocs(collectDocLinks());
  sections.push('\\n=== Na download-actie (knoppen geklikt) ===\\n' + (document.body.innerText || '').slice(0, 30000));

  if (mercellPortalList.length) {
    sections.push('\\n=== Mercell/Negometrix (portal-URL uit pagina, o.a. geïmporteerde aankondiging) ===\\n' + mercellPortalList.join('\\n'));
  }

  var beschrijving = '';
  var descSections = document.querySelectorAll(
    '[class*="beschrijving"], [class*="description"], [class*="omschrijving"], main, article, [class*="detail-content"]'
  );
  for (var di = 0; di < descSections.length; di++) {
    var tx = descSections[di].innerText && descSections[di].innerText.trim();
    if (tx && tx.length > beschrijving.length) beschrijving = tx;
  }
  if (!beschrijving) beschrijving = (document.body.innerText || '').slice(0, 12000);

  return {
    beschrijving: beschrijving.slice(0, 12000),
    documenten: allDocs,
    volledigeTekst: sections.join('\\n').slice(0, 200000)
  };
})()
`
}

async function fetchTenderPageWithTabs(
  loadUrl: string,
  tabLabels: string[],
  partition: string | undefined,
  initialWaitMs: number,
  tabTiming: TabScrapeTiming = TAB_SCRAPE_TIMING_FAST,
  onProgress?: BronFetchOnProgress,
  tenderId?: string
): Promise<BronPaginaDetails> {
  log.info(`fetchTenderPageWithTabs: ${loadUrl} (tabs: ${tabLabels.join(', ')})`)

  const nativeDownloadDocs: DocumentInfo[] = []
  const pendingDownloadPromises: Promise<void>[] = []
  let mercellDownloadHandler: ((_event: import('electron').Event, item: DownloadItem) => void) | null = null

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      ...(partition ? { partition } : {}),
    },
  })

  const tid = tenderId?.trim()
  if (tid && isMercellHostHint(loadUrl)) {
    const tenderDir = getTenderDocumentsDir(tid)
    fs.mkdirSync(tenderDir, { recursive: true })
    mercellDownloadHandler = (_event, item: DownloadItem) => {
      const suggested = item.getFilename()
      const baseName = safeMercellDownloadBaseName(suggested)
      const fullPath = path.join(tenderDir, baseName)
      try {
        item.setSavePath(fullPath)
      } catch (e: unknown) {
        log.warn(`Mercell setSavePath mislukt voor ${baseName}:`, e)
        return
      }
      const doneP = new Promise<void>((resolve) => {
        item.once('done', async (_e, state) => {
          try {
            if (state !== 'completed') {
              log.warn(`Mercell native download niet voltooid (${state}): ${baseName}`)
              resolve()
              return
            }
            if (!fs.existsSync(fullPath)) {
              resolve()
              return
            }
            const st = fs.statSync(fullPath)
            if (st.size < 20) {
              resolve()
              return
            }
            const buf = fs.readFileSync(fullPath)
            const lower = baseName.toLowerCase()
            const isZip = lower.endsWith('.zip') || (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b)
            if (isZip) {
              const { fileEntries } = await extractZipBufferToTenderDir(buf, tenderDir, baseName)
              nativeDownloadDocs.push(...fileEntries)
              try {
                fs.unlinkSync(fullPath)
              } catch {
                /* noop */
              }
              log.info(`Mercell export-ZIP uitgepakt: ${fileEntries.length} bestand(en) uit ${baseName}`)
            } else {
              const ext = path.extname(baseName).slice(1).toLowerCase() || 'bin'
              nativeDownloadDocs.push({
                localNaam: path.basename(fullPath),
                naam: (suggested || baseName).slice(0, 220),
                type: ext,
                bronZipLabel: 'Mercell-export',
              })
              log.info(`Mercell export-bestand opgeslagen: ${baseName}`)
            }
          } catch (err: unknown) {
            log.warn('Mercell native download verwerken mislukt:', err)
          }
          resolve()
        })
      })
      pendingDownloadPromises.push(doneP)
    }
    win.webContents.session.on('will-download', mercellDownloadHandler)
  }

  const cleanupDownloads = () => {
    if (mercellDownloadHandler) {
      win.webContents.session.removeListener('will-download', mercellDownloadHandler)
      mercellDownloadHandler = null
    }
  }

  win.webContents.setWindowOpenHandler((details) => {
    log.warn(`Geen extra venster tijdens bron-fetch (o.a. voorkomt LinkedIn-deel popups): ${details.url}`)
    return { action: 'deny' }
  })

  const userAgent =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'

  try {
    onProgress?.({
      step: `Pagina laden: ${loadUrl.replace(/^https?:\/\//i, '').slice(0, 72)}…`,
      percentage: 5,
    })
    try {
      await raceTimeout(
        win.loadURL(loadUrl, { userAgent }),
        PAGE_LOAD_TIMEOUT_MS,
        'Bronpagina laden (loadURL)'
      )
    } catch (loadErr: unknown) {
      const msg = loadErr instanceof Error ? loadErr.message : String(loadErr)
      log.warn(`fetchTenderPageWithTabs load voor ${loadUrl}: ${msg}`)
      try {
        win.webContents.stop()
      } catch {
        /* noop */
      }
    }

    onProgress?.({
      step: 'Pagina geladen; wachten op opbouw (SPA) en daarna tabbladen tracking…',
      percentage: 6,
    })
    await new Promise((r) => setTimeout(r, initialWaitMs))

    // ── Login/privacy-pagina detectie voor Mercell ────────────────────────────
    if (loadUrl.includes('mercell') || loadUrl.includes('negometrix') || loadUrl.includes('s2c.mercell')) {
      const landedUrl = win.webContents.getURL()
      const isLoginPage = /login|identity\.s2c|Account\/Login|signin|aanmelden/i.test(landedUrl)
      if (isLoginPage) {
        log.warn(
          `fetchTenderPageWithTabs: Mercell-URL "${loadUrl}" leidde naar login-pagina "${landedUrl}" — sessie verlopen/niet ingelogd`
        )
        cleanupDownloads()
        return { beschrijving: '', documenten: [], volledigeTekst: '' }
      }
      try {
        const titleRaw = await win.webContents.executeJavaScript('document.title || ""')
        const title = String(titleRaw)
        if (/inloggen|log in|sign in|privacyverklaring|privacy policy|privacybeleid/i.test(title)) {
          log.warn(
            `fetchTenderPageWithTabs: Mercell-pagina heeft login/privacy-titel "${title}" — sessie verlopen`
          )
          cleanupDownloads()
          return { beschrijving: '', documenten: [], volledigeTekst: '' }
        }
      } catch {
        /* noop */
      }
    }

    // ── Mercell: «EXPORTEER TENDER» — zonder deze stap zijn vaak alleen verwijzingen zichtbaar ──
    const landedForMercell = win.webContents.getURL() || ''
    const isMercellDetailFetch =
      /mercell\.(com|eu)|negometrix\.com|s2c\.mercell/i.test(loadUrl) ||
      /mercell\.(com|eu)|negometrix\.com|s2c\.mercell/i.test(landedForMercell)
    if (isMercellDetailFetch) {
      onProgress?.({
        step: 'Mercell: «EXPORTEER TENDER» / export-knop (documentbundle)…',
        percentage: 6,
      })
      const runExportClick = async (): Promise<{ clicked?: boolean; label?: string; score?: number }> => {
        return (await win.webContents.executeJavaScript(MERCELL_CLICK_EXPORT_TENDER_JS)) as {
          clicked?: boolean
          label?: string
          score?: number
        }
      }
      try {
        let exportResult = await runExportClick()
        if (exportResult?.clicked) {
          log.info(
            `Mercell export-knop geklikt (score=${exportResult.score ?? '?'}): "${(exportResult.label || '').slice(0, 80)}"`
          )
          await new Promise((r) => setTimeout(r, 4500))
        } else {
          log.info(
            `Mercell: geen export-knop (score=${exportResult?.score ?? 0}) — herpoging over 2s — tender ${tid || '—'} url ${loadUrl.slice(0, 120)}`
          )
          await new Promise((r) => setTimeout(r, 2000))
          exportResult = await runExportClick()
          if (exportResult?.clicked) {
            log.info(`Mercell export-knop 2e poging OK: "${(exportResult.label || '').slice(0, 80)}"`)
            await new Promise((r) => setTimeout(r, 4500))
          } else if (tid) {
            log.warn(
              `Mercell: na 2 pogingen geen export-knop — geen native ZIP verwacht; tender ${tid}`
            )
          }
        }
      } catch (exportErr: unknown) {
        const em = exportErr instanceof Error ? exportErr.message : String(exportErr)
        log.warn(`Mercell export-klik script: ${em.slice(0, 200)}`)
      }
    }

    const tabHint = tabLabels.slice(0, 6).join(' · ')
    onProgress?.({
      step: `Tabbladen doorlopen (${tabHint || 'documenten'}) — kan tot ~${Math.ceil(
        TAB_SCRIPT_TIMEOUT_MS / 60000
      )} min duren bij trage bron…`,
      percentage: 7,
    })
    const script = buildTabScrapeScript(JSON.stringify(tabLabels), tabTiming)
    let result: BronPaginaDetails | null = null
    try {
      result = (await raceTimeout(
        win.webContents.executeJavaScript(script),
        TAB_SCRIPT_TIMEOUT_MS,
        'Tab-tracking (executeJavaScript)'
      )) as BronPaginaDetails | null
    } catch (scriptErr: unknown) {
      const msg = scriptErr instanceof Error ? scriptErr.message : String(scriptErr)
      log.warn(`fetchTenderPageWithTabs script voor ${loadUrl}: ${msg}`)
    }

    onProgress?.({
      step: 'Tabbladen-tracking op deze URL afgerond',
      percentage: 8,
    })

    if (tid && isMercellHostHint(loadUrl) && mercellDownloadHandler) {
      onProgress?.({
        step: 'Mercell: wachten op export-download(s) naar interne opslag…',
        percentage: 8,
      })
      await new Promise((r) => setTimeout(r, 3000))
      if (pendingDownloadPromises.length > 0) {
        await Promise.race([
          Promise.all(pendingDownloadPromises),
          new Promise<void>((r) => setTimeout(r, MERCELL_NATIVE_DOWNLOAD_WAIT_MS)),
        ])
      } else {
        await new Promise((r) => setTimeout(r, 2000))
      }
      if (nativeDownloadDocs.length === 0 && pendingDownloadPromises.length > 0) {
        log.warn(
          `Mercell: export-download(s) gestart maar geen bestanden verwerkt — tender ${tid} (timeout of lege response)`
        )
      }
    }

    cleanupDownloads()

    const base = result || {
      beschrijving: '',
      documenten: [],
      volledigeTekst: '',
    }
    const documenten = mergeDocumentInfosDeduped([...(base.documenten || []), ...nativeDownloadDocs])
    return {
      ...base,
      documenten,
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.warn(`fetchTenderPageWithTabs failed for ${loadUrl}: ${msg}`)
    cleanupDownloads()
    return { beschrijving: '', documenten: [], volledigeTekst: '' }
  } finally {
    cleanupDownloads()
    win.close()
  }
}

function downloadRequestHeaders(targetUrl: string): Record<string, string> {
  const lower = targetUrl.toLowerCase()
  const h: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
  }
  if (lower.includes('.zip') || /\/documenten\/zip|downloadzip/i.test(lower)) {
    h.Accept = 'application/zip, application/octet-stream, */*'
  }
  if (/tenderned\.nl/i.test(targetUrl)) {
    h.Referer = 'https://www.tenderned.nl/'
  }
  return h
}

async function readResponseBody(response: Response): Promise<{ buffer: Buffer; contentType: string }> {
  const contentType = response.headers.get('content-type') || ''
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, contentType }
}

export async function fetchBufferFromUrl(url: string, sessionPartition?: string): Promise<{ buffer: Buffer; contentType: string }> {
  const headers = downloadRequestHeaders(url)
  const tryGlobal = () =>
    raceTimeout(
      fetch(url, { headers, redirect: 'follow' }),
      DOCUMENT_DOWNLOAD_TIMEOUT_MS,
      'Bijlage download'
    )

  if (sessionPartition) {
    try {
      const ses = session.fromPartition(sessionPartition)
      const response = await raceTimeout(
        ses.fetch(url, { bypassCustomProtocolHandlers: true, headers }),
        DOCUMENT_DOWNLOAD_TIMEOUT_MS,
        'Bijlage download (sessie)'
      )
      if (response.ok) {
        return readResponseBody(response)
      }
      log.warn(`Bijlage sessie-fetch HTTP ${response.status} voor ${url.slice(0, 120)} — opnieuw zonder sessie`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.warn(`Bijlage sessie-fetch mislukt (${msg.slice(0, 120)}) — opnieuw zonder sessie`)
    }
  }

  const response = await tryGlobal()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return readResponseBody(response)
}

/**
 * Download een document naar userData/documents/{tenderId}/ en extraheer tekst.
 * Gebruikt optioneel de auth-sessie van de bron (zelfde cookies als bij inloggen).
 */
/** Tekst uit reeds opgeslagen lokaal bestand (o.a. uitgepakte ZIP-onderdelen). */
export async function readLocalDocumentAndExtractText(
  tenderId: string,
  localNaam: string,
  logicalName: string
): Promise<string> {
  const resolved = resolveTenderDocumentFile(tenderId, localNaam)
  if (!resolved) {
    log.warn(`Lokaal document niet gevonden: ${tenderId}/${localNaam}`)
    return ''
  }
  const buffer = fs.readFileSync(resolved.fullPath)
  const lower = logicalName.toLowerCase()
  if (isZipArchive(buffer, '', '', localNaam)) {
    log.warn(`Lokaal bestand is ZIP (onverwacht): ${localNaam}`)
    return `[ZIP ${logicalName}: gebruik uitgepakte onderdelen]`
  }
  const looksPdf = lower.includes('.pdf') || buffer.slice(0, 5).toString('ascii') === '%PDF-'
  if (looksPdf) return await extractPdfText(buffer)
  if (/\.xlsx?$/i.test(lower)) {
    return await extractXlsxText(buffer, logicalName)
  }
  if (/\.docx?$/i.test(lower)) {
    return await extractDocxText(buffer, logicalName)
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return extractHtmlText(buffer.toString('utf-8'))
  }
  if (['.txt', '.csv', '.md', '.json'].some((e) => lower.endsWith(e))) {
    return buffer.toString('utf-8').replace(/\0/g, '').slice(0, 100_000)
  }
  if (lower.endsWith('.xml')) {
    return extractHtmlText(buffer.toString('utf-8'))
  }
  const text = buffer.toString('utf-8')
  if (text.match(/[\x00-\x08\x0E-\x1F]/)) {
    return `[Bijlage: ${logicalName} - binair bestand, tekst niet extraheerbaar]`
  }
  return text.slice(0, 50000)
}

const MIN_STORED_FILE_BYTES = 100

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Zoekt een bestaand bestand in de tender-opslag (internal-document-store / legacy documents)
 * dat bij de logische documentnaam hoort: exacte safe naam, conflict-variant base_1.ext, enz.
 */
export function findBestLocalStoredFileName(
  tenderId: string,
  docName: string,
  preferredLocalNaam?: string,
): string | null {
  if (preferredLocalNaam?.trim()) {
    const r = resolveTenderDocumentFile(tenderId, preferredLocalNaam.trim())
    if (r && r.size > MIN_STORED_FILE_BYTES) return preferredLocalNaam.trim()
  }

  const safe =
    String(docName || '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120) || 'document'
  const exact = resolveTenderDocumentFile(tenderId, safe)
  if (exact && exact.size > MIN_STORED_FILE_BYTES) return safe

  const ext = path.extname(safe)
  const base = ext ? safe.slice(0, -ext.length) : safe
  if (!base) return null

  const files = listTenderDocumentFiles(tenderId)
  const candidates: { naam: string; size: number }[] = []
  for (const f of files) {
    if (f.size <= MIN_STORED_FILE_BYTES) continue
    if (f.naam === safe) {
      candidates.push(f)
      continue
    }
    if (ext) {
      if (f.naam.startsWith(`${base}_`) && f.naam.endsWith(ext)) {
        const mid = f.naam.slice(base.length + 1, -ext.length)
        if (/^\d+$/.test(mid)) candidates.push(f)
      }
    } else if (f.naam === base || new RegExp(`^${escapeRegExp(base)}_\\d+$`).test(f.naam)) {
      candidates.push(f)
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.size - a.size)
  return candidates[0].naam
}

export type DownloadExtractResult = { text: string; savedLocalName?: string }

export type DownloadExtractOptions = {
  /** DB-veld localNaam: wordt als eerste pad geprobeerd. */
  preferredLocalNaam?: string
  /** Uitzondering: negeer lokale kopie en haal opnieuw van de bron-URL. */
  forceNetworkDownload?: boolean
}

export async function downloadAndExtractText(
  docUrl: string,
  docName: string,
  tenderId: string,
  sessionPartition?: string,
  options?: DownloadExtractOptions,
): Promise<DownloadExtractResult> {
  if (!options?.forceNetworkDownload) {
    const localPick = findBestLocalStoredFileName(tenderId, docName, options?.preferredLocalNaam)
    if (localPick) {
      const resolved = resolveTenderDocumentFile(tenderId, localPick)
      if (resolved && resolved.size > MIN_STORED_FILE_BYTES) {
        log.info(`Lokaal bestand hergebruikt (download overgeslagen): ${localPick}`)
        const text = await readLocalDocumentAndExtractText(tenderId, localPick, docName)
        return { text, savedLocalName: localPick }
      }
    }
  }

  log.info(`Downloading document: ${docUrl}`)

  try {
    const { buffer, contentType } = await fetchBufferFromUrl(docUrl, sessionPartition)

    const docsDir = getDocumentsPath()
    const tenderDir = path.join(docsDir, tenderId)
    fs.mkdirSync(tenderDir, { recursive: true })

    let safeFileName = docName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
    if (!safeFileName) safeFileName = 'document'

    if (isZipArchive(buffer, contentType, docUrl, safeFileName)) {
      log.info(`ZIP-archief gedownload, uitpakken zonder .zip op schijf te bewaren: ${docName}`)
      const { combinedText } = await extractZipBufferToTenderDir(buffer, tenderDir, docName)
      return { text: combinedText }
    }

    let filePath = path.join(tenderDir, safeFileName)
    let n = 1
    while (fs.existsSync(filePath)) {
      const ext = path.extname(safeFileName) || ''
      const base = ext ? safeFileName.slice(0, -ext.length) : safeFileName
      safeFileName = `${base}_${n}${ext}`
      filePath = path.join(tenderDir, safeFileName)
      n++
    }
    fs.writeFileSync(filePath, buffer)

    const lowerUrl = docUrl.toLowerCase()
    const looksPdf =
      contentType.includes('pdf') ||
      lowerUrl.includes('.pdf') ||
      buffer.slice(0, 5).toString('ascii') === '%PDF-'

    if (looksPdf) {
      const text = await extractPdfText(buffer)
      return { text, savedLocalName: safeFileName }
    }

    if (
      /\.xlsx?$/i.test(lowerUrl) ||
      contentType.includes('spreadsheetml') ||
      contentType.includes('excel')
    ) {
      return {
        text: await extractXlsxText(buffer, docName),
        savedLocalName: safeFileName,
      }
    }
    if (/\.docx?$/i.test(lowerUrl) || contentType.includes('wordprocessingml') || contentType.includes('msword')) {
      return {
        text: await extractDocxText(buffer, docName),
        savedLocalName: safeFileName,
      }
    }

    if (contentType.includes('html') || docUrl.toLowerCase().endsWith('.html')) {
      return { text: extractHtmlText(buffer.toString('utf-8')), savedLocalName: safeFileName }
    }

    const text = buffer.toString('utf-8')
    if (text.match(/[\x00-\x08\x0E-\x1F]/)) {
      log.info(`Binary document, cannot extract text: ${docName}`)
      return {
        text: `[Bijlage: ${docName} - binair bestand, tekst niet extraheerbaar]`,
        savedLocalName: safeFileName,
      }
    }
    return { text: text.slice(0, 50000), savedLocalName: safeFileName }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.warn(`Document extraction failed for ${docUrl}: ${msg}`)
    return { text: '' }
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = require('pdf-parse')
    const data = await pdfParse(buffer)
    log.info(`PDF extracted: ${data.numpages} pages, ${data.text?.length || 0} chars`)
    return data.text?.slice(0, 100000) || ''
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.warn(`PDF parse failed: ${msg}`)
    return ''
  }
}

async function extractDocxText(buffer: Buffer, fileName: string): Promise<string> {
  try {
    const mammoth = require('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    const text = (result.value || '').trim()
    log.info(`DOCX extracted "${fileName}": ${text.length} chars`)
    return text.slice(0, 100_000)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.warn(`DOCX parse failed for "${fileName}": ${msg}`)
    return `[Bijlage: ${fileName} — Word-bestand kon niet worden gelezen: ${msg}]`
  }
}

async function extractXlsxText(buffer: Buffer, fileName: string): Promise<string> {
  try {
    const XLSX = require('xlsx')
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const lines: string[] = []
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
      if (csv.trim()) {
        lines.push(`=== Werkblad: ${sheetName} ===`)
        lines.push(csv.trim())
      }
    }
    const text = lines.join('\n')
    log.info(`XLSX extracted "${fileName}": ${text.length} chars, ${workbook.SheetNames.length} sheet(s)`)
    return text.slice(0, 100_000)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.warn(`XLSX parse failed for "${fileName}": ${msg}`)
    return `[Bijlage: ${fileName} — Excel-bestand kon niet worden gelezen: ${msg}]`
  }
}

function extractHtmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50000)
}

const ZIP_MAX_ENTRIES = 200
const ZIP_MAX_ENTRY_BYTES = 40 * 1024 * 1024
const ZIP_MAX_COMBINED_TEXT = 450_000

function isZipArchive(buffer: Buffer, contentType: string, docUrl: string, fileName: string): boolean {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false
  const ct = contentType.toLowerCase()
  if (ct.includes('application/zip') || ct.includes('application/x-zip-compressed')) return true
  const hint = `${docUrl} ${fileName}`.toLowerCase()
  if (hint.includes('.zip')) return true
  const a = buffer[2]
  const b = buffer[3]
  return (
    (a === 0x03 && b === 0x04) ||
    (a === 0x05 && b === 0x06) ||
    (a === 0x07 && b === 0x08)
  )
}

export type ZipExtractResult = { combinedText: string; fileEntries: DocumentInfo[] }

/** ZIP naar tender-map uitpakken — geen .zip-bestand zelf bewaren. */
export async function extractZipBufferToTenderDir(
  buffer: Buffer,
  tenderDir: string,
  logicalName: string
): Promise<ZipExtractResult> {
  const looksPkZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
  if (!looksPkZip) {
    const sniff = buffer.slice(0, 400).toString('utf-8').toLowerCase()
    if (sniff.includes('<!doctype') || sniff.includes('<html') || sniff.includes('inloggen')) {
      log.warn(`ZIP-download voor "${logicalName}" lijkt HTML (login/redirect) — geen archief`)
      return {
        combinedText: `[ZIP ${logicalName}: geen archief ontvangen (mogelijk inloggen op TenderNed nodig via Instellingen)]`,
        fileEntries: [],
      }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AdmZip = require('adm-zip')
  let zip: InstanceType<typeof AdmZip>
  try {
    zip = new AdmZip(buffer)
  } catch (e: unknown) {
    log.warn('ZIP openen mislukt:', e)
    return {
      combinedText: `[ZIP ${logicalName}: ongeldig of beschadigd archief]`,
      fileEntries: [],
    }
  }

  const entries = zip.getEntries().filter((e: { isDirectory: boolean }) => !e.isDirectory)
  const zipStem = logicalName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.zip$/i, '')
    .slice(0, 60) || 'zip'

  const parts: string[] = [
    `=== ZIP-archief: ${logicalName} — ${entries.length} bestand(en), uitgepakt naar interne opslag ===`,
  ]
  const fileEntries: DocumentInfo[] = []
  let processed = 0
  let totalTextChars = 0

  for (let i = 0; i < entries.length; i++) {
    if (processed >= ZIP_MAX_ENTRIES) {
      parts.push(`\n[… maximaal ${ZIP_MAX_ENTRIES} bestanden uit ZIP verwerkt]`)
      break
    }
    const entry = entries[i]
    const raw = entry.entryName.replace(/\\/g, '/')
    if (raw.includes('..')) continue
    const base = path.posix.basename(raw)
    if (!base || base === '.DS_Store' || base.startsWith('._') || raw.includes('__MACOSX/')) continue
    const declared = entry.header.size
    if (declared > ZIP_MAX_ENTRY_BYTES) {
      parts.push(`\n--- ${base} (overgeslagen: bestand te groot) ---`)
      continue
    }

    let data: Buffer
    try {
      data = entry.getData()
    } catch {
      parts.push(`\n--- ${base} (uitlezen uit ZIP mislukt) ---`)
      continue
    }

    let outName = `${zipStem}_${processed + 1}_${base.replace(/[^a-zA-Z0-9._-]/g, '_')}`.slice(0, 200)
    let outPath = path.join(tenderDir, outName)
    let n = 1
    while (fs.existsSync(outPath)) {
      const ext = path.extname(outName)
      const stem = ext ? outName.slice(0, -ext.length) : outName
      outPath = path.join(tenderDir, `${stem}_${n}${ext}`)
      n++
    }
    fs.writeFileSync(outPath, data)
    const diskName = path.basename(outPath)
    processed++

    const extLower = path.extname(base).toLowerCase()
    const typeFromExt = extLower.startsWith('.') ? extLower.slice(1) : extLower || 'bin'
    fileEntries.push({
      localNaam: diskName,
      naam: base,
      type: typeFromExt,
      bronZipLabel: logicalName,
    })

    let text = ''
    if (extLower === '.pdf' || data.slice(0, 5).toString('ascii') === '%PDF-') {
      text = await extractPdfText(data)
    } else if (extLower === '.html' || extLower === '.htm') {
      text = extractHtmlText(data.toString('utf-8'))
    } else if (['.txt', '.csv', '.md', '.json'].includes(extLower)) {
      text = data.toString('utf-8').replace(/\0/g, '').slice(0, 100_000)
    } else if (extLower === '.xml') {
      text = extractHtmlText(data.toString('utf-8'))
    } else if (/\.xlsx?$/i.test(extLower)) {
      text = await extractXlsxText(data, base)
    } else if (/\.docx?$/i.test(extLower)) {
      text = await extractDocxText(data, base)
    } else {
      const sample = data.subarray(0, Math.min(8000, data.length)).toString('utf-8')
      if (!/[\x00-\x08\x0E-\x1F]/.test(sample)) {
        text = data.toString('utf-8').slice(0, 100_000)
      } else {
        text = `[Geen leesbare tekst in analyse: ${base}]`
      }
    }

    if (text.trim()) {
      const chunk = `\n--- Uit ZIP (${logicalName}): ${base} ---\n${text.trim()}`
      if (totalTextChars + chunk.length > ZIP_MAX_COMBINED_TEXT) {
        parts.push(`\n[… tekst uit ZIP afgekapt na ${ZIP_MAX_COMBINED_TEXT} tekens voor AI-context]`)
        break
      }
      totalTextChars += chunk.length
      parts.push(chunk)
    }
  }

  log.info(`ZIP ${logicalName}: ${processed} bestand(en) uitgepakt naar ${tenderDir}`)
  return { combinedText: parts.join('\n'), fileEntries }
}
