import { parseTenderDisplayDate } from './date-format'

export type TimelineConsistencyIssue = { id: string; message: string }

function localDayKey(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Controleert logische volgorde van mijlpalen (publicatie → sluiting inschrijving → uitvoering).
 * Meldt inconsistenties die vaak voortkomen uit verkeerde AI-extractie of dubbelzinnige datumnotatie.
 */
export function analyzeTenderTimelineConsistency(params: {
  publicatie?: string | null
  sluitingInschrijving?: string | null
  startUitvoering?: string | null
  eindeUitvoering?: string | null
}): TimelineConsistencyIssue[] {
  const p = params.publicatie ? parseTenderDisplayDate(String(params.publicatie)) : null
  const s = params.sluitingInschrijving ? parseTenderDisplayDate(String(params.sluitingInschrijving)) : null
  const su = params.startUitvoering ? parseTenderDisplayDate(String(params.startUitvoering)) : null
  const eu = params.eindeUitvoering ? parseTenderDisplayDate(String(params.eindeUitvoering)) : null

  const issues: TimelineConsistencyIssue[] = []

  if (p && s && localDayKey(p) > localDayKey(s)) {
    issues.push({
      id: 'publicatie_na_sluiting',
      message:
        'De publicatiedatum ligt na de sluitingsdatum van de inschrijving. Controleer de brondata (TenderNed / AI-extractie); dit strookt zelden met de procedure.',
    })
  }

  if (s && su && localDayKey(su) <= localDayKey(s)) {
    issues.push({
      id: 'start_voor_sluiting',
      message:
        'De start van uitvoering ligt op of vóór de sluitingsdatum van de inschrijving. Meestal start uitvoering ná sluiting; controleer de aanbestedingsstukken en de geëxtraheerde velden.',
    })
  }

  if (su && eu && localDayKey(eu) < localDayKey(su)) {
    issues.push({
      id: 'einde_voor_start_uitvoering',
      message:
        'De geplande einddatum van de uitvoering ligt vóór de startdatum. Controleer “datum start uitvoering” en “datum einde uitvoering” in de documenten.',
    })
  }

  const now = new Date()
  const todayKey = localDayKey(now)

  if (s && su && localDayKey(s) > todayKey && localDayKey(su) < todayKey) {
    issues.push({
      id: 'start_in_verleden_inschrijving_open',
      message:
        'De start van uitvoering ligt in het verleden terwijl de inschrijving nog niet gesloten is. Dit wijst op foutieve of door elkaar gehaalde datums; raadpleeg de stukken.',
    })
  }

  return issues
}
