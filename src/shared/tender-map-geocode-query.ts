import type { Aanbesteding, AiExtractedTenderFields } from './types'

/** Bron-id's die we als "België" classificeren bij gebrek aan andere hint. */
const BELGIUM_BRON_IDS = new Set(['belgium', 'bosa', 'publicprocurement-be'])

/**
 * Plausibele postcodes detecteren om te bepalen of een vrije tekst écht een adres is.
 * - NL: 4 cijfers + 2 letters (1234 AB, 1234AB).
 * - BE: 4 cijfers (1000-9999).
 */
const NL_POSTCODE = /\b\d{4}\s?[A-Z]{2}\b/i
const BE_POSTCODE = /\b\d{4}\b/

function safeParseExtracted(json?: string | null): AiExtractedTenderFields | null {
  if (!json?.trim()) return null
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as AiExtractedTenderFields) : null
  } catch {
    return null
  }
}

function looksLikeAddress(text: string): boolean {
  if (!text) return false
  const t = text.trim()
  if (t.length < 6) return false
  if (NL_POSTCODE.test(t)) return true
  if (BE_POSTCODE.test(t) && /[A-Za-zÀ-ÿ]/.test(t)) return true
  // Adres met huisnummer ("Hoofdstraat 12", "Rue de la Loi 200")
  if (/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\s'-]{2,}\s+\d{1,4}/.test(t)) return true
  return false
}

function stripCountrySuffix(text: string): string {
  return text.replace(/[,;]\s*(nederland|belgië|belgie|belgium|netherlands|the netherlands)\s*$/i, '').trim()
}

/** Bouwt een geocode-query voor een tender; null als er onvoldoende info is. */
export function buildTenderGeocodeQuery(tender: Aanbesteding): {
  query: string
  countryHint: 'nl' | 'be' | null
} | null {
  const extracted = safeParseExtracted(tender.ai_extracted_fields)

  const candidates: string[] = []
  const opdrAdres = (extracted?.opdrachtgever_adres || '').trim()
  if (opdrAdres && looksLikeAddress(opdrAdres)) candidates.push(opdrAdres)

  const locatie = (extracted?.locatie_of_regio || '').trim()
  if (locatie) candidates.push(locatie)

  const regio = (tender.regio || '').trim()
  if (regio && !candidates.includes(regio)) candidates.push(regio)

  if (opdrAdres && !candidates.includes(opdrAdres)) candidates.push(opdrAdres)

  const cleaned = candidates
    .map(stripCountrySuffix)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 3)

  if (cleaned.length === 0) return null

  const primary = cleaned[0]

  const lowerBron = (tender.bron_website_id || '').toLowerCase()
  const isBelgium = BELGIUM_BRON_IDS.has(lowerBron) || /belg|bruxelles|brussel|wallon|vlaand/i.test(primary)
  const countryHint: 'nl' | 'be' | null = isBelgium ? 'be' : 'nl'

  // Voeg landhint toe als die nog niet expliciet voorkomt
  const hasCountry = /(nederland|netherlands|belg)/i.test(primary)
  const country = countryHint === 'be' ? 'België' : 'Nederland'
  const query = hasCountry ? primary : `${primary}, ${country}`

  return { query, countryHint }
}
