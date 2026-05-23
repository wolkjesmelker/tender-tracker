/** Direct bestand of duidelijke download: documentkoppeling; overige hits: aantekening. */
export function classifyWebSearchResultKind(url: string): 'doc_ref' | 'note' {
  const u = String(url || '').trim()
  if (!u) return 'note'
  try {
    const parsed = new URL(u)
    const p = parsed.pathname + parsed.search
    if (/\.(pdf|docx?|xlsx?|xls|pptx?|ppsx?|od[tpst]|rtf|csv|xml|epub|zip)(\?|#|$)/i.test(p)) {
      return 'doc_ref'
    }
    if (/\b(download|export|exporteer|bijlage|attachment|file\/|documenten\/|content\/)\b/i.test(p)) {
      return 'doc_ref'
    }
  } catch {
    if (/\.(pdf|docx?|xlsx?)\b/i.test(u)) return 'doc_ref'
  }
  return 'note'
}
