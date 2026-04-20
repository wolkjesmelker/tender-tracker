/**
 * Bepaalt tijdens het scrapen of een aanbesteding past bij de werkzaamheden die
 * Van de Kreeke Groep kan uitvoeren (GWW / civiel). Alleen geslaagde records
 * worden opgeslagen, zodat er geen AI-tokens worden gebruikt voor off-topic hits.
 */

export interface ScrapeTextFields {
  titel: string
  beschrijving?: string
  ruwe_tekst?: string
}

// ---------------------------------------------------------------------------
// Detectie: reeds gegunde opdracht / gunningsaankondiging
// ---------------------------------------------------------------------------

/**
 * Signalen dat een publicatie een aankondiging van een REEDS GEGUNDE opdracht is
 * (geen open aanbesteding). We zijn opzettelijk conservatief: alleen unieke zinnen
 * die bij aangekondigde gunning horen, niet losse woorden als "gunning" of "gegund"
 * (die komen ook in open stukken voor, bijv. "gunningscriteria").
 */
const AWARDED_TITLE_FRAGMENTS: RegExp[] = [
  /\baankondiging\s+van\s+(?:een\s+)?gegunde\s+opdracht\b/i,
  /\baankondiging\s+gegunde\s+opdracht\b/i,
  /\baankondiging\s+opdracht\s+gegund\b/i,
  /\bvooraankondiging\s+gegunde\s+opdracht\b/i,
  /\baankondiging\s+van\s+(?:een\s+)?gunning\b/i,
  /\bresultaat\s+aanbesteding\b/i,
  /\bcontract\s+award\s+notice\b/i,
  /\baward\s+notice\b/i,
  /\bavis\s+d['’]attribution\b/i,
]

const AWARDED_BODY_FRAGMENTS: RegExp[] = [
  /\bopdracht\s+is\s+gegund\s+aan\b/i,
  /\bde?\s*opdracht\s+is\s+gegund\s+op\b/i,
  /\bgegund\s+aan\s*:\s*/i,
  /\bgunningsbeslissing\b/i,
  /\bbegunstigde\s*:/i,
  /\bnaam\s+van\s+de\s+(?:winnende\s+)?inschrijver\b/i,
  /\bgegunde\s+opdracht\b/i,
]

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text))
}

/**
 * True als de scrape-tekst (titel + beschrijving + ruwe tekst) duidelijk een
 * reeds gegunde opdracht of gunningsaankondiging betreft. Gebruikt door zowel
 * de scrape-kwalificatie als de analyse-pipeline om onnodige AI-calls te voorkomen.
 */
export function isAwardedTenderNotice(fields: ScrapeTextFields): boolean {
  const titel = (fields.titel || '').toLowerCase()
  const body = [fields.beschrijving || '', fields.ruwe_tekst || ''].join('\n').toLowerCase()

  if (matchesAny(titel, AWARDED_TITLE_FRAGMENTS)) return true
  if (matchesAny(body, AWARDED_BODY_FRAGMENTS)) return true

  // Titel bevat een expliciete "gunning"-zin en tegelijkertijd een datum/tekst
  // die op een gunningsresultaat wijst. Defensief om valse positieven te vermijden
  // bij titels als "… met gunningscriteria op basis van …".
  if (
    /\bgegunde?\s+(?:opdracht|aanbesteding)\b/i.test(titel) ||
    /\bresultaat\b/i.test(titel) && /\baanbesteding|opdracht|gunning\b/i.test(titel)
  ) {
    return true
  }

  return false
}

/** Kerncompetenties en synoniemen (lowercase fragmenten; langere strings eerst waar nodig) */
const VAN_DE_KREEKE_COMPETENCY_FRAGMENTS = [
  'asfalt',
  'asfaltwerk',
  'wegenbouw',
  'wegwerk',
  'weg reconstructie',
  'wegverharding',
  'riolering',
  'riool',
  'hemelwater',
  'waterberging',
  'infiltratie',
  'drainage',
  'gww',
  'grondwerk',
  'civiel',
  'civiele techniek',
  'civiele werken',
  'openbare ruimte',
  'herinrichting',
  'reconstructie',
  'dorpskern',
  'bestrating',
  'klinker',
  'elementenverharding',
  'verharding',
  'bouwrijp',
  'woonrijp',
  'bedrijventerrein',
  'betonbouw',
  'beton',
  'kade',
  'brug',
  'dijk',
  'watermanagement',
  'klimaatadaptatie',
  'afkoppelen',
  'uav-gc',
  'uav gc',
  'bouwteam',
  'design & build',
  'design and build',
  'onderhoud weg',
  'onderhoud wegen',
  'sleuven',
  'kolken',
  'klinkerverharding',
  'tegelverharding',
  'gebiedsontwikkeling',
  'leefomgeving',
  // FR / EN (BOSA e-procurement, meertalige bekendmakingen)
  'travaux',
  'travaux publics',
  'voirie',
  'chaussée',
  'infrastructure routière',
  "réseau d'égouts",
  'égouts',
  'assainissement',
  'génie civil',
  'civil engineering',
  'earthworks',
  'earthwork',
  'road construction',
  'sewer',
  'stormwater',
]

/**
 * Sterke niet-civiele signalen: als deze voorkomen zonder civiel/GWW-bewijs,
 * wordt het record geweigerd (voorkomt ICT/SAAS die toevallig "infrastructuur" bevatten).
 */
const NON_CIVIL_DOMINANT_PATTERNS: RegExp[] = [
  /\b(software|saas|hosting|cloud\s+computing|webportal|web\s+portal|applicatiebeheer|ict[-\s]?dienst|ict[-\s]?outsourcing|helpdesk|telefonie|telecom)\b/i,
  /\b(website\s+ontwikkeling|app\s+ontwikkeling|software\s+ontwikkeling)\b/i,
  /\b(juridisch\s+advies|accountancy|auditing|vertaaldienst|catering|schoonmaak\s+dienst)\b/i,
]

/**
 * Inhuur van mensen / vacatures / detachering voor vakinhoudelijke rollen — geen GWW-opdracht.
 * Gemeenten plaatsen dit soms naast civiele zoektermen ("wegbeheerder", "civiel"); dat moet eruit.
 */
const STAFFING_OR_VACANCY_PATTERNS: RegExp[] = [
  /\b(?:de\s+)?vacature\b/i,
  /\bvacatures\b/i,
  /\bopenstaande\s+functie\b/i,
  /\bfunctie-?omschrijving\b/i,
  /\bsolliciteren\b/i,
  /\bsollicitatie(?:termijn|-?periode)?\b/i,
  /\brecruitment\b/i,
  /\bhead-?hunting\b/i,
  /\bwerving\s+van\s+personeel\b/i,
  /\bdetachering\s+van\s+(?:personeel|medewerkers)\b/i,
  /\binkoop\s+van\s+arbeidskrachten\b/i,
  /\b(?:personeels|arbeids)detacher/i,
  /\buren\s+per\s+week\b/i,
  /\buur(?:en)?\s+dienstverband\b/i,
  /\bsalarisschaal\b/i,
  /\bWie\s+zoeken\s+wij\?\b/i,
  /\bWat\s+breng\s+je\s+mee\?\b/i,
  /\bkom\s+(?:je|jij)\s+ons\s+team\s+versterken\b/i,
  /\bword\s+(?:je|jij)\s+(?:de|ons|onze)\b/i,
  /\bgezocht\s*:\s*\b/i,
  /\b(?:wij\s+)?(?:zoeken|werven)\s+(?:een\s+)?(?:nieuwe\s+)?(?:projectleider|uitvoerder|werkvoorbereider|cost\s*engineer|wegbeheerder|teamleider\s+civiel|civiel(?:technisch)?(?:\s+technicus|\s+engineer|\s+medewerker)?)\b/i,
  /\b(?:zoeken\s+wij|zijn\s+wij\s+op\s+zoek\s+naar)\s+(?:een\s+)?(?:nieuwe\s+)?(?:projectleider|uitvoerder|werkvoorbereider|wegbeheerder|civiel(?:technisch)?(?:\s+technicus|\s+engineer)?)\b/i,
  /\b(?:projectleider|uitvoerder|werkvoorbereider|wegbeheerder|civiel(?:technisch)?(?:\s+technicus|\s+engineer)?)\b[^.!?]{0,140}\b(?:medewerker|fte|vacature|functie|detacher)\b/i,
  /\b(?:medewerker|fte|vacature)\b[^.!?]{0,140}\b(?:projectleider|uitvoerder|werkvoorbereider|wegbeheerder|civiel(?:technisch)?(?:\s+technicus|\s+engineer)?)\b/i,
  /\bciviel(?:e)?\s+medewerker\b/i,
  /\binhuur\s+(?:van\s+)?(?:een\s+)?(?:medewerker|functie|functieprofiel|personeel)\b/i,
  /\b(?:dps|raamovereenkomst)\b[^.!?]{0,160}\b(?:personeel|detachering|uurtarief|arbeidskrachten|medewerker)\b/i,
  /\bwegbeheerder\b[^.!?]{0,100}\b(?:vacature|sollicitatie|functie|fte|uur(?:en)?\s+per)\b/i,
  /\b(?:vacature|sollicitatie|functie|gezocht)\b[^.!?]{0,100}\bwegbeheerder\b/i,
]

function hasCompetencySignal(combined: string): boolean {
  return VAN_DE_KREEKE_COMPETENCY_FRAGMENTS.some((frag) => combined.includes(frag))
}

function hasNonCivilDominantSignal(combined: string): boolean {
  return NON_CIVIL_DOMINANT_PATTERNS.some((re) => re.test(combined))
}

function isStaffingOrVacancyProcurement(combined: string): boolean {
  return STAFFING_OR_VACANCY_PATTERNS.some((re) => re.test(combined))
}

/**
 * Minimaal één actieve zoekterm moet in de tekst voorkomen (zelfde gedrag als voorheen),
 * plus een duidelijk GWW/civiel-signaal. Optioneel: filter op niet-civiele dominantie.
 */
export function qualifiesVoorVanDeKreekeScrape(
  fields: ScrapeTextFields,
  zoektermen: string[]
): boolean {
  const combined = [fields.titel || '', fields.beschrijving || '', fields.ruwe_tekst || '']
    .join('\n')
    .toLowerCase()

  const terms = zoektermen.map((z) => z.trim().toLowerCase()).filter(Boolean)
  if (terms.length === 0) return false

  const zoektermHit = terms.some((term) => combined.includes(term))
  if (!zoektermHit) return false

  // Reeds gegunde opdrachten / gunningsaankondigingen nooit opnemen:
  // analyseren kost tokens en levert geen inschrijfkans meer op.
  if (isAwardedTenderNotice(fields)) return false

  if (isStaffingOrVacancyProcurement(combined)) return false

  if (!hasCompetencySignal(combined)) return false

  if (hasNonCivilDominantSignal(combined) && !hasStrongCivilOverride(combined)) return false

  return true
}

/** Extra civiele termen die een NON_CIVIL-match overstemmen (gemengde opdrachten) */
function hasStrongCivilOverride(combined: string): boolean {
  return /\b(weg|wegen|riool|asfalt|gww|civiel|bestrat|openbare\s+ruimte|herinrichting|waterberging)\b/i.test(
    combined
  )
}
