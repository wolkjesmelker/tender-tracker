/**
 * Bouwt tender-prompttekst met bijlagen en houdt bij welke document-indexen
 * daadwerkelijk in de prompt zitten (i.v.m. STAP 2b-lijst vs. token-cap).
 */

/** Zelfde limiet als voorheen in buildTenderContext — alleen bijlagentekst telt mee voor deze cap.
 * Bewust wat kleiner dan OpenAI 128k-window zodat systeem- en instructietekst nog past.
 * De context-guard in analysis-pipeline.ts knipt dynamisch bij als het totaal toch te groot is. */
export const MAX_BIJLAGE_CHARS_IN_MAIN_PROMPT = 280_000

export type TenderBijlageContextStats = {
  totalBijlagen: number
  includedInPromptCount: number
  omittedFromPromptCount: number
  totalBijlageChars: number
  includedBijlageChars: number
}

export type TenderBijlageContextResult = {
  tenderText: string
  /** Indices in `documentTexts` die volledig (of afgekort) in de BIJLAGEN-sectie zitten. */
  includedDocIndices: number[]
  stats: TenderBijlageContextStats
}

const BIJLAGE_LINE_RE = /\n--- BIJLAGE: ([^\n]+) ---\n/

/** Unicode-NFC, trim, collapse whitespace — voor matching van model-output op verwachte namen. */
export function normalizeBijlageNameKey(naam: string): string {
  return naam
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * Comprimeert PDF/HTML-geëxtraheerde tekst voor minder tokens zonder inhoud te verliezen.
 * - Vouwt 3+ opeenvolgende lege regels samen tot 2
 * - Verwijdert regels die alleen maar streepjes/punten/underscores zijn (spacers)
 * - Verwijdert achterliggende spaties per regel
 * - Verwijdert "Pagina N van M"-achtige paginamarkeringen
 */
export function compressDocumentText(text: string): string {
  if (!text || text.length < 200) return text
  return text
    // Trim elke regel aan de rechterkant
    .replace(/[^\S\n]+$/gm, '')
    // Verwijder regels die enkel streepjes, punten, underscores of gelijke-tekens zijn (> 3 tekens)
    .replace(/^[-–—=_.·•]{4,}\s*$/gm, '')
    // Paginamarkeringen: "Pagina 3 van 12", "Page 5 of 10", "- 3 -", "p. 3"
    .replace(/^[\s-]*(?:pagina?|page?|blz\.?)\s*\d+\s*(?:van|of|\/)\s*\d*\s*$/gim, '')
    .replace(/^\s*-\s*\d+\s*-\s*$/gm, '')
    // Vouw 3+ opeenvolgende lege regels samen naar 2
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Eerste `--- BIJLAGE: x ---`-blok uit één documentTexts-entry. */
export function extractBijlageHeaderFromSlice(docSlice: string): { naam: string; body: string } | null {
  const m = docSlice.match(BIJLAGE_LINE_RE)
  if (!m) return null
  const naam = m[1].trim()
  const restStart = m.index! + m[0].length
  const body = docSlice.slice(restStart)
  return { naam, body }
}

/** Alle bijlagenamen in volgorde van `documentTexts`. */
export function extractBijlageNamenFromDocumentTexts(documentTexts: string[]): string[] {
  const names: string[] = []
  for (const slice of documentTexts) {
    const h = extractBijlageHeaderFromSlice(slice)
    if (h?.naam && !names.includes(h.naam)) names.push(h.naam)
  }
  return names
}

function buildHeaderParts(tender: any, detailText: string): string[] {
  const parts: string[] = []

  if (tender.titel) parts.push(`Titel: ${tender.titel}`)
  if (tender.opdrachtgever) parts.push(`Opdrachtgever: ${tender.opdrachtgever}`)
  if (tender.type_opdracht) parts.push(`Type: ${tender.type_opdracht}`)
  if (tender.regio) parts.push(`Regio: ${tender.regio}`)
  if (tender.geraamde_waarde) parts.push(`Geraamde waarde: ${tender.geraamde_waarde}`)
  if (tender.publicatiedatum) parts.push(`Publicatiedatum: ${tender.publicatiedatum}`)
  if (tender.sluitingsdatum) parts.push(`Sluitingsdatum: ${tender.sluitingsdatum}`)
  if (tender.referentienummer) parts.push(`Referentienummer: ${tender.referentienummer}`)

  if (tender.beschrijving) parts.push(`\nBeschrijving:\n${tender.beschrijving}`)

  if (tender.bron_navigatie_links) {
    try {
      const links = JSON.parse(String(tender.bron_navigatie_links)) as unknown
      if (Array.isArray(links) && links.length > 0) {
        parts.push(`\n--- Verzamelde bronlinks (procedure, platforms, documenten) ---`)
        for (const L of links.slice(0, 100) as { categorie?: string; titel?: string; url?: string }[]) {
          if (!L?.url) continue
          parts.push(`[${L.categorie || 'Link'}] ${L.titel || ''}\n${L.url}`)
        }
      }
    } catch {
      /* skip */
    }
  }

  if (detailText && detailText.length > (tender.beschrijving?.length || 0) + 100) {
    const compressed = compressDocumentText(detailText)
    parts.push(`\nVolledige tekst detailpagina (tabs/bron):\n${compressed.slice(0, 100_000)}`)
  } else if (tender.ruwe_tekst && tender.ruwe_tekst.length > (tender.beschrijving?.length || 0)) {
    const compressed = compressDocumentText(tender.ruwe_tekst)
    parts.push(`\nVolledige tekst:\n${compressed.slice(0, 20_000)}`)
  }

  return parts
}

/**
 * Zelfde semantiek als de vorige `buildTenderContext`, maar met tracking van
 * welke `documentTexts`-indexen in de BIJLAGEN-sectie zijn opgenomen.
 */
export function buildTenderBijlageContext(
  tender: any,
  detailText: string,
  documentTexts: string[],
  maxBijlageChars: number = MAX_BIJLAGE_CHARS_IN_MAIN_PROMPT,
): TenderBijlageContextResult {
  const parts = buildHeaderParts(tender, detailText)

  const includedDocIndices: number[] = []
  let totalBijlageChars = 0
  let includedBijlageChars = 0

  if (documentTexts.length > 0) {
    parts.push(`\n\n========== BIJLAGEN (${documentTexts.length} documenten) ==========`)
    let totalDocChars = 0
    for (let i = 0; i < documentTexts.length; i++) {
      const docText = compressDocumentText(documentTexts[i])
      totalBijlageChars += documentTexts[i].length
      if (totalDocChars + docText.length > maxBijlageChars) {
        const remaining = maxBijlageChars - totalDocChars
        if (remaining > 500) {
          parts.push(docText.slice(0, remaining) + '\n[... document ingekort vanwege limiet ...]')
          includedDocIndices.push(i)
          includedBijlageChars += remaining
        }
        parts.push(
          `\n[Overige bijlagen staan niet in deze prompt vanwege de token-limiet; ze worden in een aparte analysestap verwerkt.]`,
        )
        break
      }
      parts.push(docText)
      includedDocIndices.push(i)
      includedBijlageChars += docText.length
      totalDocChars += docText.length
    }
  }

  const omittedFromPromptCount = documentTexts.length - includedDocIndices.length
  const tenderText = parts.join('\n')

  return {
    tenderText,
    includedDocIndices,
    stats: {
      totalBijlagen: documentTexts.length,
      includedInPromptCount: includedDocIndices.length,
      omittedFromPromptCount,
      totalBijlageChars,
      includedBijlageChars,
    },
  }
}
