import type { StoredDocumentEntry } from './types'

/** Herken ZIP-bundels in documentlijsten (UI + expand). */
export function isZipDocumentEntryLike(d: {
  naam?: string
  type?: string
  url?: string
}): boolean {
  if (!d) return false
  const t = (d.type || '').toLowerCase()
  const n = (d.naam || '').toLowerCase()
  const u = (d.url || '').toLowerCase()
  return (
    t === 'zip' ||
    t === 'application/zip' ||
    t === 'application/x-zip-compressed' ||
    n.endsWith('.zip') ||
    u.includes('.zip') ||
    /\/documenten\/zip/i.test(u) ||
    /downloadzip/i.test(u) ||
    /[?&]format=zip\b/i.test(u)
  )
}

/**
 * Verberg ZIP-regel als er al uitgepakte bestanden met dezelfde bronZipLabel (= ZIP-logische naam) zijn.
 */
export function hideZipRowIfContentsExpanded(all: StoredDocumentEntry[]): StoredDocumentEntry[] {
  return all.filter((d) => {
    if (!isZipDocumentEntryLike(d)) return true
    const label = (d.naam || '').trim()
    if (!label) return true
    const hasExtracted = all.some((x) => x.bronZipLabel && x.bronZipLabel === label)
    return !hasExtracted
  })
}

/**
 * Bij analyse / discovery: geen ZIP opnieuw downloaden als de lijst al uitgepakte onderdelen
 * bevat (zelfde bronZipLabel als de ZIP-`naam`).
 */
export function omitZipDownloadsWhenPartsAlreadyInList<
  T extends { naam?: string; url?: string; bronZipLabel?: string; type?: string },
>(docs: T[]): T[] {
  const labels = new Set(
    docs
      .map((d) => d.bronZipLabel?.trim())
      .filter((x): x is string => Boolean(x))
      .map((x) => x.toLowerCase())
  )
  if (labels.size === 0) return docs
  return docs.filter((d) => {
    if (!isZipDocumentEntryLike(d) || !String(d.url || '').trim()) return true
    const naam = (d.naam || '').trim().toLowerCase()
    if (labels.has(naam)) return false
    const stem = naam.replace(/\.zip$/i, '')
    for (const lab of labels) {
      if (stem && lab.replace(/\.zip$/i, '') === stem) return false
    }
    return true
  })
}
