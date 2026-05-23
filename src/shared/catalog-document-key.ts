import type { StoredDocumentEntry } from './types'

/** Stabiele sleutel voor gebruikersselectie; blijft geldig bij herschrijven van `document_urls`. */
export function catalogDocumentStableKey(doc: StoredDocumentEntry): string {
  const u = (doc.url ?? '').trim()
  if (u) return `u:${u}`
  const l = (doc.localNaam ?? '').trim()
  if (l) return `l:${l}`
  return `n:${(doc.naam ?? '').trim()}`
}

/** Sleutel voor een bestandslink uit «Gevonden op bronpagina». */
export function bronFileLinkStableKey(url: string): string {
  return `b:${(url ?? '').trim()}`
}

export function parseCatalogSelectedKeys(raw: string | null | undefined): Set<string> {
  if (!raw?.trim()) return new Set()
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string' && x.length > 0))
  } catch {
    return new Set()
  }
}
