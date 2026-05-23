/**
 * Eenduidige start/einde inschrijving en uitvoering voor AI-context (main + renderer).
 */
import type { Aanbesteding, AiExtractedTenderFields, TenderProcedureContext } from './types'
import { parseTenderDisplayDate } from './date-format'

function parseJson<T>(raw: string | null | undefined): T | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export type TenderDateSnapshot = {
  /** Start inschrijving / publicatie (ruwe tekst zoals in DB) */
  startInschrijvingRaw: string
  /** Einde inschrijving / sluiting (ruwe tekst) */
  endInschrijvingRaw: string
  /** Start uitvoering uit AI-velden */
  startUitvoeringRaw: string
  /** Einde uitvoering uit AI-velden */
  endUitvoeringRaw: string
}

function firstParseable(raws: (string | undefined | null)[]): string {
  for (const raw of raws) {
    const r = raw?.trim()
    if (!r) continue
    if (parseTenderDisplayDate(r)) return r
  }
  return '-'
}

/**
 * Zelfde bronvolgorde als `getInschrijvingWindow` in de renderer: DB → API → AI-extractie.
 */
export function getTenderDateSnapshot(row: Aanbesteding): TenderDateSnapshot {
  const ai = parseJson<AiExtractedTenderFields>(row.ai_extracted_fields)
  const proc = parseJson<TenderProcedureContext>(row.tender_procedure_context)
  const apiEnd = proc?.apiHighlights?.sluitingsDatum

  const endInschrijvingRaw = firstParseable([
    row.sluitingsdatum,
    typeof apiEnd === 'string' ? apiEnd : '',
    ai?.sluitingsdatum_inschrijving,
  ])

  const startInschrijvingRaw = firstParseable([row.publicatiedatum, ai?.publicatiedatum])

  const startUitvoeringRaw = (ai?.datum_start_uitvoering ?? '').trim() || '-'
  const endUitvoeringRaw = (ai?.datum_einde_uitvoering ?? '').trim() || '-'

  return {
    startInschrijvingRaw: startInschrijvingRaw === '-' ? '' : startInschrijvingRaw,
    endInschrijvingRaw: endInschrijvingRaw === '-' ? '' : endInschrijvingRaw,
    startUitvoeringRaw: startUitvoeringRaw === '-' ? '' : startUitvoeringRaw,
    endUitvoeringRaw: endUitvoeringRaw === '-' ? '' : endUitvoeringRaw,
  }
}

/** Korte tekstregel voor portfolio-lijsten (één aanbesteding). */
export function formatTenderDateSnapshotLine(row: Aanbesteding): string {
  const d = getTenderDateSnapshot(row)
  const si = d.startInschrijvingRaw || '-'
  const ei = d.endInschrijvingRaw || '-'
  const su = d.startUitvoeringRaw || '-'
  const eu = d.endUitvoeringRaw || '-'
  return `inschrijving ${si} → ${ei}; uitvoering ${su} → ${eu}`
}
