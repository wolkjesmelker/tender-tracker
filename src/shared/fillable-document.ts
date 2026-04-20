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
