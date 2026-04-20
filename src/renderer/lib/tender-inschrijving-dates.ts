import type { Aanbesteding, AiExtractedTenderFields, TenderProcedureContext } from '@shared/types'
import { formatDate } from './utils'

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function parseDate(s?: string | null): Date | null {
  if (!s?.trim()) return null
  const d = new Date(s.trim().replace(/(\.\d{3})\d+/g, '$1'))
  return Number.isNaN(d.getTime()) ? null : d
}

export type InschrijvingWindow = {
  start: Date | null
  end: Date | null
  startDisplay: string
  endDisplay: string
}

/**
 * Start/einde inschrijving: publicatie vs. sluiting, met fallbacks (API/AI).
 */
export function getInschrijvingWindow(row: Aanbesteding): InschrijvingWindow {
  const ai = parseJson<AiExtractedTenderFields>(row.ai_extracted_fields)
  const proc = parseJson<TenderProcedureContext>(row.tender_procedure_context)
  const apiEnd = proc?.apiHighlights?.sluitingsDatum

  let end: Date | null = null
  let endRaw: string | undefined
  for (const raw of [row.sluitingsdatum, typeof apiEnd === 'string' ? apiEnd : '', ai?.sluitingsdatum_inschrijving]) {
    const r = raw?.trim()
    if (!r) continue
    const d = parseDate(r)
    if (d) {
      end = d
      endRaw = r
      break
    }
  }

  let start: Date | null = null
  let startRaw: string | undefined
  for (const raw of [row.publicatiedatum, ai?.publicatiedatum]) {
    const r = raw?.trim()
    if (!r) continue
    const d = parseDate(r)
    if (d) {
      start = d
      startRaw = r
      break
    }
  }

  return {
    start,
    end,
    startDisplay: startRaw ? formatDate(startRaw) : '—',
    endDisplay: endRaw ? formatDate(endRaw) : '—',
  }
}

/** Lokale kalenderdag (00:00) voor vergelijkingen met date-inputs. */
export function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
