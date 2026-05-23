/**
 * Heuristiek: is dit document bedoeld om door de inschrijver ingevuld te worden?
 * Gedeeld tussen main- en renderer-process zodat de UI-knop alleen verschijnt
 * bij documenten die daadwerkelijk invoer vereisen.
 */
export function isFillableDocumentName(naam: string, type?: string): boolean {
  const hay = `${naam} ${type || ''}`.toLowerCase()
  return (
    /\binschrijfformulier\b/.test(hay) ||
    /\bdeelnemersformulier\b/.test(hay) ||
    /\bmachtigingsformulier\b/.test(hay) ||
    /\b(aanmeldingsformulier|aanmeldformulier)\b/.test(hay) ||
    /(onderteken|ondertekening)[^\n]*formulier/.test(hay) ||
    /\beigen\s+verklaring\b/.test(hay) ||
    /\bintegriteitsverklaring\b/.test(hay) ||
    /\buniform\s+europees\b/.test(hay) ||
    /\buea\b/.test(hay) ||
    /\bconcept[-\s]?(overeenkomst|contract)\b/.test(hay) ||
    /\binvulblad\b/.test(hay) ||
    /\binvulformulier\b/.test(hay) ||
    /\bprijsformulier\b/.test(hay) ||
    /\bprijzenblad\b/.test(hay) ||
    /\binschrijfstaat\b/.test(hay) ||
    /\binschrijvingsbiljet\b/.test(hay) ||
    /\b(model|bijlage)[^\n]*formulier/.test(hay) ||
    /(^|[\s_-])k[-_.\s]?formulier/.test(hay) ||
    /\b(questionnaire|vragenlijst)\b/.test(hay)
  )
}

const WORDISH_EXTS = new Set(['doc', 'docx', 'odt'])

/** Extensie uit bestandsnaam (querystring genegeerd), anders uit `type`. */
export function documentExtensionLower(naam: string, type?: string): string {
  const base = (naam || '').split('?')[0].split('#')[0]
  const fromName = (base.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
  if (fromName) return fromName
  const t = (type || '').toLowerCase().replace(/^\./, '')
  if (t && !t.includes('/') && t.length <= 12) return t
  return ''
}

export function isWordProcessorExtension(naam: string, type?: string): boolean {
  return WORDISH_EXTS.has(documentExtensionLower(naam, type))
}

/**
 * Bestandsnaam/titel die typisch een Word-sjabloon of invuldocument aanduidt
 * (los van de algemene PDF-gerichte `isFillableDocumentName`-lijst).
 */
export function wordDocumentNameSuggestsForm(naam: string, type?: string): boolean {
  if (!isWordProcessorExtension(naam, type)) return false
  const hay = `${naam} ${type || ''}`.toLowerCase()
  return (
    /\b(sjabloon|template|model[-\s]?(brief|contract|overeenkomst)?)\b/.test(hay) ||
    /\b(offerte|opgaaf|opgave|prijs(op)?gaaf|prijsstaat|tarief(staat)?)\b/.test(hay) ||
    /\b(aanvraag|kwalificatie|self[-\s]?declaration|europese\s+eenmalige)\b/.test(hay) ||
    /\b(machtiging|volmacht|bevoegdheid|iban[-\s]?verklaring)\b/.test(hay) ||
    /\b(onderteken|getekend\s+door|handtekening)\b/.test(hay) ||
    /\b(espd|dgov)\b/.test(hay) ||
    /\b(declaratie|uittreksel|getuigschrift)\b/.test(hay) ||
    /\binschrijving\b/.test(hay) ||
    /_{3,}/.test(hay) ||
    /\binvul\b/.test(hay)
  )
}

/** Renderer + catalogus: naam/type — zonder documenttekst te lezen. */
export function isFillableCatalogEntry(naam: string, type?: string): boolean {
  return isFillableDocumentName(naam, type) || wordDocumentNameSuggestsForm(naam, type)
}

/**
 * Ruwe documenttekst (bijv. uit PDF/DOCX-extractie): lijkt het op invulvelden?
 * Gebruikt door de main-process pre-analyse voor generiek genoemde Word-bestanden.
 */
export function documentTextSuggestsFillableFields(text: string, maxScanChars = 24_000): boolean {
  const slice = (text || '').slice(0, maxScanChars).toLowerCase()
  if (slice.length < 100) return false

  let score = 0
  if (/_{4,}/.test(slice)) score += 3
  if (/\.{10,}/.test(slice)) score += 2
  if (/\b(te\s+invullen|in\s+te\s+vullen)\b/.test(slice)) score += 3
  if (/\b(handtekening|plaats\s+voor\s+een\s+handtekening)\b/.test(slice)) score += 1
  if (/\b(ondertekening|ondertekenen|ondertekend\s+door)\b/.test(slice)) score += 1
  if (/\b(naam|bedrijfsnaam)\s+(van\s+)?(de\s+)?(inschrijver|deelnemer|onderneming|aanbieder)\b/.test(slice)) {
    score += 1
  }
  if (/:\s*_{2,}/.test(slice)) score += 2
  if ((slice.match(/:\s*_{2,}/g) || []).length >= 2) score += 1
  if (/\b(plaats|datum|functie)\s*:\s*$/m.test(slice)) score += 1
  if (/\b[\[(]\s*(invul|naam|datum|bedrag)\b/.test(slice)) score += 2

  return score >= 3
}
