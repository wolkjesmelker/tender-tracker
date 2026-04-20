/** Extensies die in de app inline getoond kunnen worden (in sync met main/ipc/tenders.ipc TENDERS_LOCAL_DOC_READ). */
export const MAX_INLINE_PREVIEW_BYTES = 20 * 1024 * 1024

export const TEXT_PREVIEW_EXT = new Set([
  '.txt',
  '.csv',
  '.xml',
  '.json',
  '.md',
  '.log',
  '.html',
  '.htm',
  '.rtf',
])

export const IMAGE_PREVIEW_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

export function getExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i >= 0 ? fileName.slice(i).toLowerCase() : ''
}

/** True als het bestand in de modal als tekst/PDF/afbeelding getoond kan worden (klein genoeg). */
export function hasInlinePreview(ext: string): boolean {
  const e = ext.toLowerCase()
  if (e === '.pdf' || e === '.svg') return true
  if (TEXT_PREVIEW_EXT.has(e)) return true
  if (e in IMAGE_PREVIEW_EXT) return true
  return false
}

/** DOCX (HTML), Excel (tabel) en ZIP (inhoudsopgave) — voorbeeld in de popup zelf. */
export const MODAL_RICH_PREVIEW_EXT = new Set(['.docx', '.xlsx', '.xls', '.xlsm', '.zip'])

/** Klik op bijlage opent de preview-modal (incl. rijke previews hierboven). Anders: geen modal, direct OS. */
export function useDocumentModalPreview(ext: string): boolean {
  const e = ext.toLowerCase()
  return hasInlinePreview(e) || MODAL_RICH_PREVIEW_EXT.has(e)
}
