/**
 * Herstelt ontbrekende of onvolledige eindrapport-JSON uit betrouwbare bronnen
 * (integratie-agent, domeinagents, tenderanalyse) wanneer het LLM de grote blokken overslaat of inkort.
 */

import type {
  AlgemeneTenderanalyseV2,
  LocatieOmgevingsanalyse,
  RisicoAnalyseV2Result,
  RisicoItemV2,
  RisicogebiedV2,
  RisicoScoreV2,
  RisicoTypeV2,
} from '../../../shared/types-risico-v2'
import type { RisicoIntegratieResult } from './stage3-risico-integratie'
import type { TenderAnalyseResult } from './stage1-tenderanalyse'

const SCORE_WEIGHT: Record<RisicoScoreV2, number> = { Laag: 1, Middel: 2, Hoog: 3 }

function normalizeScore(s: unknown, fallback: RisicoScoreV2 = 'Middel'): RisicoScoreV2 {
  if (s === 'Laag' || s === 'Middel' || s === 'Hoog') return s
  return fallback
}

function maxGebiedScore(scores: RisicoScoreV2[]): RisicoScoreV2 {
  let best: RisicoScoreV2 = 'Laag'
  for (const s of scores) {
    if (SCORE_WEIGHT[s] > SCORE_WEIGHT[best]) best = s
  }
  return best
}

const VALID_TYPES = new Set<string>([
  'knock-out',
  'commercieel',
  'juridisch',
  'operationeel',
  'strategisch',
  'bewijsrisico',
  'calculatierisico',
  'omgevingsrisico',
  'planningsrisico',
  'hoeveelhedenrisico',
  'bodemrisico',
  'verkeersrisico',
])

function coerceRisicoType(t: unknown, gebiedHint: string): RisicoTypeV2 {
  if (typeof t === 'string' && VALID_TYPES.has(t)) return t as RisicoTypeV2
  const g = gebiedHint.toLowerCase()
  if (g.includes('jurid') || g.includes('procedure')) return 'juridisch'
  if (g.includes('financieel')) return 'commercieel'
  if (g.includes('bodem')) return 'bodemrisico'
  if (g.includes('verkeer')) return 'verkeersrisico'
  if (g.includes('locatie') || g.includes('omgeving')) return 'omgevingsrisico'
  if (g.includes('planning')) return 'planningsrisico'
  if (g.includes('hoeveel')) return 'hoeveelhedenrisico'
  return 'operationeel'
}

/** Haal platte tekst uit string of { waarde }-object (oude/agents-schema). */
export function unwrapV2String(val: unknown): string {
  if (val == null) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'object' && val !== null && 'waarde' in val) {
    const w = (val as { waarde?: unknown }).waarde
    return typeof w === 'string' ? w : ''
  }
  return ''
}

function normalizeTermijnenLiist(val: unknown): string[] {
  if (!Array.isArray(val)) return []
  return val
    .map((t) => {
      if (typeof t === 'string') return t.trim()
      if (t && typeof t === 'object' && 'termijn' in (t as object)) {
        const o = t as { termijn?: string; datum?: string }
        const line = `${o.termijn ?? ''}: ${o.datum ?? ''}`.trim()
        return line.replace(/^:\s*|:\s*$/g, '').trim()
      }
      return ''
    })
    .filter(Boolean)
}

function normalizeTenderrisicosList(val: unknown): string[] {
  if (!Array.isArray(val)) return []
  return val
    .map((r) => {
      if (typeof r === 'string') return r
      if (r && typeof r === 'object' && 'risico' in (r as object)) return String((r as { risico: string }).risico ?? '')
      return ''
    })
    .filter(Boolean)
}

/** V2 tenderoverzicht: altijd platte strings, ook als het model Stage1-nested structuur kopieerde. */
export function buildAlgemeneTenderanalyseV2(
  parsedFragment: Record<string, unknown> | undefined,
  tenderFallback: TenderAnalyseResult['algemene_tenderanalyse'] | undefined,
): AlgemeneTenderanalyseV2 {
  const algemene = tenderFallback ?? {}

  const p = parsedFragment ?? {}
  const termijnenFromParsed = normalizeTermijnenLiist(p.belangrijkste_termijnen)
  const tenderTermijnFallback =
    algemene.belangrijkste_termijnen?.map((t) => `${t.termijn}: ${t.datum}`) ?? []

  return {
    aanbestedende_dienst:
      unwrapV2String(p.aanbestedende_dienst) || (algemene.aanbestedende_dienst?.waarde ?? ''),
    procedure: unwrapV2String(p.procedure) || (algemene.procedure?.waarde ?? ''),
    opdrachtomschrijving:
      unwrapV2String(p.opdrachtomschrijving) || (algemene.opdrachtomschrijving?.waarde ?? ''),
    contractvorm: unwrapV2String(p.contractvorm) || (algemene.contractvorm?.waarde ?? ''),
    gunningssystematiek:
      unwrapV2String(p.gunningssystematiek) || (algemene.gunningssystematiek?.waarde ?? ''),
    belangrijkste_termijnen: termijnenFromParsed.length > 0 ? termijnenFromParsed : tenderTermijnFallback,
    belangrijkste_tenderrisicos:
      normalizeTenderrisicosList(p.belangrijkste_tenderrisicos).length > 0
        ? normalizeTenderrisicosList(p.belangrijkste_tenderrisicos)
        : algemene.tendercontext_risicos?.map((r) => r.risico) ?? [],
  }
}

export function heeftInhoudelijkeRisicogebieden(gebieden: unknown): boolean {
  if (!Array.isArray(gebieden) || gebieden.length === 0) return false
  let n = 0
  for (const g of gebieden as Array<{ risicos?: unknown[] }>) {
    if (Array.isArray(g?.risicos)) n += g.risicos.length
  }
  return n > 0
}

function mapIntegratieRegisterItemToRisico(
  item: RisicoIntegratieResult['geintegreerd_risicoregister'][number],
  gebiedNaam: string,
): RisicoItemV2 {
  const ernst = normalizeScore(item.ernstscore)
  const gekoppeld = item.gekoppelde_nvi_vraag
  const nviTekst = typeof gekoppeld === 'string' ? gekoppeld : ''
  return {
    nummer: item.nummer,
    titel: item.titel ?? 'Risico',
    ernstscore: ernst,
    kans: normalizeScore(item.kans, ernst),
    impact: normalizeScore(item.impact, ernst),
    type: coerceRisicoType(item.type, gebiedNaam),
    feit: item.feit ?? '',
    bron: item.bron ?? '',
    status_van_onderbouwing:
      typeof item.status_van_onderbouwing === 'string' ? item.status_van_onderbouwing : ('niet vast te stellen op basis van de stukken' as const),
    professionele_duiding: item.professionele_duiding ?? '',
    juridische_duiding: item.juridische_duiding ?? '',
    waarom_risico: item.waarom_risico ?? '',
    mogelijke_prijsimpact: normalizeScore(item.mogelijke_prijsimpact, 'Middel'),
    prijsimpact_toelichting: '',
    mogelijke_planningsimpact: normalizeScore(item.mogelijke_planningsimpact, 'Middel'),
    planningsimpact_toelichting: '',
    verificatie: '',
    actie: item.actie ?? '',
    vraag_nvi_nodig: Boolean(nviTekst),
    conceptvraag_nvi: nviTekst,
  }
}

/** Groepeer `geintegreerd_risicoregister` per categorie naar UI-risicogebieden. */
export function buildRisicogebiedenUitIntegratie(integratie: RisicoIntegratieResult): RisicogebiedV2[] {
  const reg = integratie.geintegreerd_risicoregister
  if (!Array.isArray(reg) || reg.length === 0) return []

  const byCat = new Map<string, RisicoIntegratieResult['geintegreerd_risicoregister']>()
  for (const item of reg) {
    const catRaw = typeof item.categorie === 'string' ? item.categorie.trim() : ''
    const cat = catRaw || 'Overig'
    if (!byCat.has(cat)) byCat.set(cat, [])
    byCat.get(cat)!.push(item)
  }

  const out: RisicogebiedV2[] = []
  for (const [naam, items] of byCat) {
    const risicos = items.map((it) => mapIntegratieRegisterItemToRisico(it, naam))
    const gebiedScore = maxGebiedScore(items.map((i) => normalizeScore(i.ernstscore)))
    out.push({
      naam,
      score: gebiedScore,
      score_toelichting: `Gebaseerd op ${items.length} geïntegreerde risico's in deze categorie (bron: risico-integratie).`,
      risicos,
    })
  }
  return out.sort((a, b) => b.risicos.length - a.risicos.length)
}

const STAGE2_DOMAIN_KEYS: Record<string, string> = {
  juridische_risicos: 'Juridisch',
  procedurele_risicos: 'Procedure',
  contractuele_risicos: 'Contract',
  scope_en_eisenrisicos: 'Scope en eisen',
  hoeveelheden_en_calculatierisicos: 'Hoeveelheden en calculatie',
  uitvoeringsrisicos: 'Uitvoering',
  locatie_en_omgevingsrisicos: 'Locatie en omgeving',
  bodem_grondwater_rioleringsrisicos: 'Bodem, grondwater en riolering',
  verkeer_blvc_risicos: 'Verkeer en BLVC',
  planning_en_faseringsrisicos: 'Planning en fasering',
  financieel_commerciele_risicos: 'Financieel-commercieel',
}

function mapRawStage2Item(raw: Record<string, unknown>, nummer: number, gebied: string): RisicoItemV2 {
  const ernst = normalizeScore(raw.ernstscore)
  const vraw = raw.vraag_nvi ?? raw.conceptvraag_nvi
  const nv = typeof vraw === 'string' ? vraw : ''
  return {
    nummer,
    titel: String(raw.titel ?? 'Risico'),
    ernstscore: ernst,
    kans: normalizeScore(raw.kans, ernst),
    impact: normalizeScore(raw.impact, ernst),
    type: coerceRisicoType(raw.type, gebied),
    feit: String(raw.feit ?? ''),
    bron: String(raw.bron ?? ''),
    status_van_onderbouwing:
      typeof raw.status_van_onderbouwing === 'string'
        ? (raw.status_van_onderbouwing as RisicoItemV2['status_van_onderbouwing'])
        : ('niet vast te stellen op basis van de stukken' as const),
    professionele_duiding: String(raw.professionele_duiding ?? ''),
    juridische_duiding: String(raw.juridische_duiding ?? ''),
    waarom_risico: String(raw.waarom_risico ?? raw.risico_voor_inschrijver ?? raw.feit ?? ''),
    mogelijke_prijsimpact: normalizeScore(raw.mogelijke_prijsimpact, 'Middel'),
    prijsimpact_toelichting: String(raw.prijsimpact_toelichting ?? ''),
    mogelijke_planningsimpact: normalizeScore(raw.mogelijke_planningsimpact, 'Middel'),
    planningsimpact_toelichting: String(raw.planningsimpact_toelichting ?? ''),
    verificatie: String(raw.verificatie ?? ''),
    actie: String(raw.actie ?? ''),
    vraag_nvi_nodig: Boolean(nv),
    conceptvraag_nvi: nv,
  }
}

/** Fallback: domeinarrays uit stage 2 direct naar risicogebieden (zonder tweede LLM-call). */
export function buildRisicogebiedenUitStage2(stage2: Record<string, unknown>): RisicogebiedV2[] {
  const gebieden: RisicogebiedV2[] = []
  for (const [jsonKey, displayName] of Object.entries(STAGE2_DOMAIN_KEYS)) {
    const arr = stage2[jsonKey]
    if (!Array.isArray(arr) || arr.length === 0) continue
    const risicos: RisicoItemV2[] = []
    let idx = 1
    for (const el of arr) {
      if (!el || typeof el !== 'object') continue
      risicos.push(mapRawStage2Item(el as Record<string, unknown>, idx++, displayName))
    }
    if (risicos.length === 0) continue
    const scores = risicos.map((r) => r.ernstscore)
    gebieden.push({
      naam: displayName,
      score: maxGebiedScore(scores),
      score_toelichting: `Samenvatting op basis van de output van de ${displayName.toLowerCase()}-agent (stage 2).`,
      risicos,
    })
  }
  return gebieden
}

function clonePrijsFactorsFromIntegratie(
  parsed: RisicoAnalyseV2Result,
  integratie: RisicoIntegratieResult,
): RisicoAnalyseV2Result['top5_prijsverhogende_risicofactoren'] {
  const fromParsed = parsed.top5_prijsverhogende_risicofactoren
  if (Array.isArray(fromParsed) && fromParsed.length > 0) return fromParsed
  const src = integratie.top5_prijsverhogende_risicofactoren ?? []
  return src.map((p) => ({
    factor: p.factor,
    bron: p.bron,
    status_van_onderbouwing:
      typeof (p as { status_van_onderbouwing?: string }).status_van_onderbouwing === 'string'
        ? (p as { status_van_onderbouwing: string }).status_van_onderbouwing
        : typeof p.status === 'string'
          ? (p.status as RisicoAnalyseV2Result['top5_prijsverhogende_risicofactoren'][0]['status_van_onderbouwing'])
          : ('niet vast te stellen op basis van de stukken' as const),
    mogelijke_prijsimpact: normalizeScore(p.mogelijke_prijsimpact),
    toelichting: p.toelichting ?? '',
    verificatie: p.verificatie ?? '',
  }))
}

/** Vul ontbrekende kernblokken; behoud parsed waar die al inhoud heeft. */
export function enrichParsedEindrapport(
  parsed: RisicoAnalyseV2Result,
  tenderResult: TenderAnalyseResult,
  integratie: RisicoIntegratieResult,
  nvi: { vragen_nvi: RisicoAnalyseV2Result['vragen_nvi'] },
  stage2Results: Record<string, unknown>,
): RisicoAnalyseV2Result {
  let risicogebieden = parsed.risicogebieden
  if (!heeftInhoudelijkeRisicogebieden(risicogebieden)) {
    risicogebieden =
      buildRisicogebiedenUitIntegratie(integratie)
    if (!heeftInhoudelijkeRisicogebieden(risicogebieden)) {
      risicogebieden = buildRisicogebiedenUitStage2(stage2Results)
    }
  }

  const top5_risicos =
    Array.isArray(parsed.top5_risicos) && parsed.top5_risicos.length > 0
      ? parsed.top5_risicos
      : integratie.top5_risicos ?? []

  const top5_planningsrisicos =
    Array.isArray(parsed.top5_planningsrisicos) && parsed.top5_planningsrisicos.length > 0
      ? parsed.top5_planningsrisicos
      : integratie.top5_planningsrisicos ?? []

  const top5_prijsverhogende_risicofactoren = clonePrijsFactorsFromIntegratie(parsed, integratie)

  const tegenstrijdigheden =
    Array.isArray(parsed.tegenstrijdigheden) && parsed.tegenstrijdigheden.length > 0
      ? parsed.tegenstrijdigheden
      : integratie.tegenstrijdigheden ?? []

  const leemtes =
    Array.isArray(parsed.leemtes) && parsed.leemtes.length > 0 ? parsed.leemtes : integratie.leemtes ?? []

  const no_go_factoren =
    Array.isArray(parsed.no_go_factoren) && parsed.no_go_factoren.length > 0
      ? parsed.no_go_factoren
      : integratie.no_go_factoren ?? []

  const vragen_nvi =
    Array.isArray(parsed.vragen_nvi) && parsed.vragen_nvi.length > 0
      ? parsed.vragen_nvi
      : nvi.vragen_nvi ?? []

  const algemeneParsed = parsed.algemene_tenderanalyse as unknown as Record<string, unknown> | undefined
  const algemene_tenderanalyse = buildAlgemeneTenderanalyseV2(algemeneParsed, tenderResult?.algemene_tenderanalyse)

  let locatie = parsed.locatie_en_omgevingsanalyse as LocatieOmgevingsanalyse | undefined
  if (!locatie || typeof locatie !== 'object') {
    locatie = {
      adres_of_werkgebied: 'Niet vast te stellen in eindrapport — zie domein Locatie & omgeving in risicolijst.',
      exacte_locatie_vastgesteld: false,
      bron_locatie: '',
      binnenstedelijk: 'Niet vast te stellen',
      drukke_straat_of_verkeersader: 'Niet vast te stellen',
      moeilijk_bereikbaar: 'Niet vast te stellen',
      beperkte_werkruimte: 'Niet vast te stellen',
      gevoelige_omgeving: 'Niet vast te stellen',
      contractueel_vastgestelde_locatiefeiten: [],
      externe_verificatiepunten: [],
      risicos_uit_locatieanalyse: [],
      benodigde_verificaties: [],
    }
  }

  let overall_score: RisicoScoreV2 | undefined =
    parsed.overall_score === 'Laag' || parsed.overall_score === 'Middel' || parsed.overall_score === 'Hoog'
      ? parsed.overall_score
      : undefined
  let overall_toelichting = String(parsed.overall_toelichting ?? '')
  if (
    overall_score == null &&
    (integratie.overall_score === 'Laag' ||
      integratie.overall_score === 'Middel' ||
      integratie.overall_score === 'Hoog')
  ) {
    overall_score = integratie.overall_score
    overall_toelichting = overall_toelichting || integratie.overall_toelichting || ''
  }

  const resolvedOverall: RisicoScoreV2 =
    overall_score === 'Laag' || overall_score === 'Middel' || overall_score === 'Hoog'
      ? overall_score
      : normalizeScore(undefined, 'Middel')

  return {
    ...parsed,
    overall_score: resolvedOverall,
    overall_toelichting,
    risicogebieden,
    top5_risicos,
    top5_planningsrisicos,
    top5_prijsverhogende_risicofactoren,
    tegenstrijdigheden,
    leemtes,
    no_go_factoren,
    vragen_nvi,
    algemene_tenderanalyse,
    locatie_en_omgevingsanalyse: locatie,
  }
}
