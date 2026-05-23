/**
 * Probeert een euro-bedrag uit een vrije tekst te halen. Ondersteunt:
 *   "€ 1.250.000,00" / "EUR 750k" / "2,5 mln" / "850000" / "€ 1.2M"
 * Retourneert het bedrag in euro's, of null bij twijfel/leeg.
 */
export function parseEuroAmount(input: string | number | null | undefined): number | null {
  if (input == null) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  const raw = String(input).trim()
  if (!raw) return null

  const lower = raw.toLowerCase()
  // Multiplier (miljoen / mln / k / M)
  let multiplier = 1
  if (/\bm(iljoen|ln|io)?\b/.test(lower) || /\b\d[\d.,]*\s*m\b/i.test(raw)) multiplier = 1_000_000
  else if (/\b\d[\d.,]*\s*k\b/i.test(raw)) multiplier = 1_000

  // Strip currency en woorden, behoud alleen cijfers/komma/punt/min.
  const cleaned = raw.replace(/[^\d.,-]/g, '')
  if (!cleaned) return null

  // Heuristiek voor decimaal teken: laatste komma OF punt is decimaal als het 1-2 cijfers volgt en er geen ander decimaalteken is.
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let normalized = cleaned

  if (lastComma > -1 && lastDot > -1) {
    // Beide aanwezig: degene die later komt is decimaal, andere is duizendscheiding.
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = cleaned.replace(/,/g, '')
    }
  } else if (lastComma > -1) {
    // Alleen komma: NL-stijl decimaal.
    const tail = cleaned.length - lastComma - 1
    if (tail === 1 || tail === 2) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = cleaned.replace(/,/g, '')
    }
  } else if (lastDot > -1) {
    const tail = cleaned.length - lastDot - 1
    if (tail !== 1 && tail !== 2) {
      // Punt is duizendscheiding (bv. "1.250.000")
      normalized = cleaned.replace(/\./g, '')
    }
  }

  const n = Number(normalized)
  if (!Number.isFinite(n)) return null
  return n * multiplier
}
