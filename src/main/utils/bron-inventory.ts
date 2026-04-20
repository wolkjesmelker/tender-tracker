import type { DocumentInfo } from '../scraping/document-fetcher'
import { isSkippableOffsiteDocumentUrl } from '../scraping/document-fetcher'

export type BronNavigatieLinkRow = {
  titel: string
  url: string
  categorie: string
}

const URL_IN_TEXT_RE = /https?:\/\/[^\s\)<>"']+/gi

function stripTrailingPunct(u: string): string {
  return u.replace(/[.,;:!?)'\]]+$/g, '')
}

/** Alle http(s)-URL's uit platte tekst (bronpagina, API-dump, tab-tekst). */
export function extractUrlsFromPlainText(text: string): string[] {
  if (!text?.trim()) return []
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(URL_IN_TEXT_RE)
  while ((m = re.exec(text)) !== null) {
    let u = stripTrailingPunct(m[0])
    if (u.length < 15) continue
    try {
      const norm = new URL(u).href.split('#')[0]
      const key = norm.split('?')[0]
      if (seen.has(key)) continue
      if (isSkippableOffsiteDocumentUrl(norm)) continue
      seen.add(key)
      out.push(norm)
    } catch {
      /* skip */
    }
  }
  return out
}

export function categorizeBronUrl(url: string): string {
  const u = url.toLowerCase()
  if (u.includes('mercell') || u.includes('negometrix') || u.includes('s2c.mercell')) {
    return 'Extern platform (bijv. Mercell / Negometrix)'
  }
  if (u.includes('tenderned.nl') && (u.includes('/documenten/') || u.includes('/content'))) {
    return 'TenderNed — document of download'
  }
  if (u.includes('tenderned.nl')) return 'TenderNed — pagina of functionaliteit'
  if (u.includes('ted.europa.eu') || u.includes('eforms') || u.includes('europa.eu')) {
    return 'EU / eForms / Europese aanbesteding'
  }
  if (u.includes('overheid.nl') || u.includes('rijksoverheid.nl')) return 'Overheid.nl'
  if (/\.pdf(\?|$|#)/i.test(u)) return 'Direct PDF-bestand'
  if (/\.(zip|docx?|xlsx?)(\?|$|#)/i.test(u)) return 'Direct download (office / archief)'
  if (u.includes('procedure') || u.includes('wet') || u.includes('juridisch')) {
    return 'Procedure of regelgeving (vermoed)'
  }
  return 'Gerelateerde link'
}

function lineContaining(text: string, url: string): string {
  const idx = text.indexOf(url)
  if (idx === -1) return ''
  const start = text.lastIndexOf('\n', idx - 1) + 1
  const end = text.indexOf('\n', idx)
  return text.slice(start, end === -1 ? undefined : end).trim()
}

function titelFromContext(url: string, line: string): string {
  const stripped = line
    .replace(url, '')
    .replace(/^[:\s\-–—•]+|[:\s\-–—•]+$/g, '')
    .trim()
  if (stripped.length >= 6 && stripped.length < 220) return stripped
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean)
    const last = path[path.length - 1] || 'link'
    return decodeURIComponent(last).replace(/\+/g, ' ').slice(0, 160)
  } catch {
    return url.slice(0, 100)
  }
}

/** Unieke navigatielinks met categorie + leesbare titel (voor UI + JSON-kolom). */
export function buildNavigatieLinksFromText(text: string): BronNavigatieLinkRow[] {
  const urls = extractUrlsFromPlainText(text)
  const byKey = new Map<string, BronNavigatieLinkRow>()
  for (const url of urls) {
    const key = url.split('?')[0]
    if (byKey.has(key)) continue
    const line = lineContaining(text, url)
    byKey.set(key, {
      url,
      titel: titelFromContext(url, line),
      categorie: categorizeBronUrl(url),
    })
  }
  return [...byKey.values()].slice(0, 100)
}

export function mergeNavigatieLinkRows(existing: BronNavigatieLinkRow[], found: BronNavigatieLinkRow[]): BronNavigatieLinkRow[] {
  const m = new Map<string, BronNavigatieLinkRow>()
  for (const row of [...existing, ...found]) {
    const k = row.url.split('?')[0]
    if (!m.has(k)) m.set(k, row)
  }
  return [...m.values()]
}

function looksLikeDownloadableTenderDoc(url: string): boolean {
  const u = url.toLowerCase()
  if (isSkippableOffsiteDocumentUrl(url)) return false
  if (u.includes('tenderned.nl') && u.includes('documenten') && u.includes('content')) return true
  if (u.includes('tenderned.nl') && /\/documenten\/\d+/i.test(u)) return true
  if (/\.(pdf|zip|docx?|xls[xm]?)(\?|$|#)/i.test(u)) return true
  if (u.includes('download') && (u.includes('aanbesteding') || u.includes('tender') || u.includes('publicat'))) {
    return true
  }
  if ((u.includes('mercell') || u.includes('negometrix')) && (u.includes('file') || u.includes('document') || u.includes('download'))) {
    return true
  }
  return false
}

function guessDocNaam(url: string): string {
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean)
    const last = p[p.length - 1] || 'document'
    return decodeURIComponent(last).replace(/\+/g, ' ').slice(0, 180)
  } catch {
    return 'document'
  }
}

function guessDocType(url: string): string {
  const u = url.toLowerCase()
  if (u.endsWith('.pdf') || u.includes('pdf')) return 'pdf'
  if (u.endsWith('.zip')) return 'zip'
  if (u.endsWith('.docx')) return 'docx'
  if (u.endsWith('.doc')) return 'doc'
  if (u.endsWith('.xlsx') || u.endsWith('.xls')) return 'xlsx'
  return 'link'
}

/** Extra document-URL's uit lange brontekst (naast API-lijst), voor maximale inventarisatie. */
export function extractSupplementaryDocumentsFromText(text: string): DocumentInfo[] {
  const urls = extractUrlsFromPlainText(text)
  const out: DocumentInfo[] = []
  const seen = new Set<string>()
  for (const url of urls) {
    if (!looksLikeDownloadableTenderDoc(url)) continue
    const k = url.split('?')[0]
    if (seen.has(k)) continue
    seen.add(k)
    out.push({
      url,
      naam: guessDocNaam(url),
      type: guessDocType(url),
    })
  }
  return out
}

function docMergeKey(d: DocumentInfo): string {
  const u = d.url?.trim()
  if (u) {
    if (isSkippableOffsiteDocumentUrl(u)) return ''
    try {
      return new URL(u).href.split('#')[0].split('?')[0]
    } catch {
      return u.split('?')[0].split('#')[0]
    }
  }
  if (d.localNaam?.trim()) return `local:${d.localNaam.trim()}`
  return ''
}

export function mergeDocumentInfoLists(lists: DocumentInfo[][]): DocumentInfo[] {
  const m = new Map<string, DocumentInfo>()
  for (const list of lists) {
    for (const d of list || []) {
      const k = docMergeKey(d)
      if (!k) continue
      const ex = m.get(k)
      if (!ex) {
        m.set(k, { ...d })
        continue
      }
      const localNaam = (d.localNaam?.trim() || ex.localNaam?.trim() || undefined) as string | undefined
      const naamPick =
        d.naam?.trim() && (!ex.naam?.trim() || d.naam.trim().length > (ex.naam?.trim().length || 0))
          ? d.naam.trim()
          : ex.naam?.trim() || d.naam?.trim() || 'Document'
      m.set(k, {
        url: (d.url?.trim() || ex.url?.trim() || '') as string,
        naam: naamPick,
        type: (d.type?.trim() || ex.type?.trim() || '') as string,
        ...(localNaam ? { localNaam } : {}),
        ...(d.bronZipLabel?.trim() || ex.bronZipLabel?.trim()
          ? { bronZipLabel: (d.bronZipLabel?.trim() || ex.bronZipLabel?.trim()) as string }
          : {}),
      })
    }
  }
  return [...m.values()]
}
