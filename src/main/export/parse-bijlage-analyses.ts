import type { BijlageAnalyse } from '../../shared/types'

export function parseBijlageAnalysesRow(tender: { bijlage_analyses?: string | null }): BijlageAnalyse[] {
  if (!tender.bijlage_analyses) return []
  try {
    const raw = JSON.parse(tender.bijlage_analyses)
    if (!Array.isArray(raw)) return []
    return raw as BijlageAnalyse[]
  } catch {
    return []
  }
}
