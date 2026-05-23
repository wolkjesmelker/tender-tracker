/**
 * Gatekeeper: compacte draft-snapshot voor de LLM + deterministische normalisatie van model-JSON.
 */

import type {
  GatekeeperResultaat,
  InschrijfAdviesV2,
  InschrijfStrategieV2,
  NviCategorie,
  NviVraag,
  OnderbouwingStatus,
  RisicoAnalyseV2Result,
  RisicoScoreV2,
  Top5PlanningsRisico,
  Top5PrijsFactor,
  Top5Risico,
  Tegenstrijdigheid,
} from '../../../shared/types-risico-v2'

export interface GatekeeperInput {
  intakeResult: unknown
  tenderResult: unknown
  feiten: unknown
  stage2Results: unknown
  strategie: unknown
  nvi: unknown
  integratie: unknown
  assembledDraft?: RisicoAnalyseV2Result
}

export interface GatekeeperOutput {
  gatekeeper_resultaat: GatekeeperResultaat
  /** Optionele correcties op integratie-/synthesedelen van het rapport (zelfde velden als draft-top-level). */
  gecorrigeerde_integratie?: Record<string, unknown>
  gecorrigeerde_nvi?: { vragen_nvi: RisicoAnalyseV2Result['vragen_nvi'] }
  /** Gedeeltelijke inschrijfstrategie (plat of `{ inschrijfstrategie: { ... } }`). */
  gecorrigeerde_strategie?: Partial<InschrijfStrategieV2>
}

const MAX_STR = 520

export function clipField(s: unknown, max = MAX_STR): string {
  if (s == null) return ''
  const t = String(s)
  if (t.length <= max) return t
  return t.slice(0, max) + '…'
}

const VALID_ADVIES = new Set<InschrijfAdviesV2>([
  'inschrijfbaar',
  'inschrijfbaar_onder_voorwaarden',
  'hoog_risico',
  'no_go',
])

const VALID_SCORE: Set<RisicoScoreV2> = new Set(['Laag', 'Middel', 'Hoog'])

const NVI_CATS = new Set<NviCategorie>([
  'juridisch',
  'financieel',
  'uitvoering',
  'planning',
  'hoeveelheden',
  'bodem',
  'grondwater',
  'riolering',
  'verkeer',
  'omgeving',
  'vergunningen',
  'veiligheid',
  'contract',
  'gunning',
  'procedure',
])

const VALID_ONDERBOUWING = new Set<OnderbouwingStatus>([
  'uit stukken vastgesteld',
  'uit externe bron vastgesteld',
  'niet vast te stellen op basis van de stukken',
  'conflicterend in stukken',
])

function nlScore(s: unknown, fb: RisicoScoreV2 = 'Middel'): RisicoScoreV2 {
  return VALID_SCORE.has(s as RisicoScoreV2) ? (s as RisicoScoreV2) : fb
}

function onderbouwing(s: unknown): OnderbouwingStatus {
  if (typeof s === 'string') {
    if (VALID_ONDERBOUWING.has(s as OnderbouwingStatus)) return s as OnderbouwingStatus
    const t = s.toLowerCase()
    if (t.includes('conflicterend')) return 'conflicterend in stukken'
    if (t.includes('externe bron')) return 'uit externe bron vastgesteld'
    if (t.includes('uit stukken') || t.includes('vastgesteld')) return 'uit stukken vastgesteld'
    if (t.includes('niet vast')) return 'niet vast te stellen op basis van de stukken'
  }
  return 'niet vast te stellen op basis van de stukken'
}

function nviCat(s: unknown): NviCategorie {
  if (typeof s === 'string' && NVI_CATS.has(s as NviCategorie)) return s as NviCategorie
  return 'procedure'
}

/** Volledige risicolijst per gebied (alle ernsten), met afgeknotte teksten voor contextlimiet. */
export function buildGatekeeperDraftInput(draft: RisicoAnalyseV2Result): object {
  return {
    overall_score: draft.overall_score,
    overall_toelichting: clipField(draft.overall_toelichting, 1200),
    inschrijfadvies: draft.inschrijfadvies,
    management_samenvatting: clipField(draft.management_samenvatting, 800),
    bewijs_en_aannameregel: draft.bewijs_en_aannameregel,
    document_leesplicht_bevestiging: draft.document_leesplicht_bevestiging,
    locatie_en_omgevingsanalyse: {
      adres_of_werkgebied: clipField(draft.locatie_en_omgevingsanalyse?.adres_of_werkgebied, 400),
      externe_verificatiepunten: draft.locatie_en_omgevingsanalyse?.externe_verificatiepunten ?? [],
      benodigde_verificaties: draft.locatie_en_omgevingsanalyse?.benodigde_verificaties ?? [],
    },
    risicogebieden: (draft.risicogebieden ?? []).map((g) => ({
      naam: g.naam,
      score: g.score,
      score_toelichting: clipField(g.score_toelichting, 400),
      risicos: (g.risicos ?? []).map((r) => ({
        nummer: r.nummer,
        titel: clipField(r.titel, 200),
        ernstscore: r.ernstscore,
        kans: r.kans,
        impact: r.impact,
        type: r.type,
        feit: clipField(r.feit),
        bron: clipField(r.bron),
        status_van_onderbouwing: r.status_van_onderbouwing,
        waarom_risico: clipField(r.waarom_risico),
        actie: clipField(r.actie),
        conceptvraag_nvi: clipField(r.conceptvraag_nvi, 300),
        vraag_nvi_nodig: r.vraag_nvi_nodig,
      })),
    })),
    top5_risicos: draft.top5_risicos ?? [],
    top5_prijsverhogende_risicofactoren: draft.top5_prijsverhogende_risicofactoren ?? [],
    top5_planningsrisicos: draft.top5_planningsrisicos ?? [],
    no_go_factoren: draft.no_go_factoren ?? [],
    tegenstrijdigheden: draft.tegenstrijdigheden ?? [],
    leemtes: draft.leemtes ?? [],
    vragen_nvi: (draft.vragen_nvi ?? []).map((v) => ({
      categorie: v.categorie,
      doel: clipField(v.doel, 300),
      formulering: clipField(v.formulering, 500),
      bron: clipField(v.bron, 300),
    })),
    inschrijfstrategie: draft.inschrijfstrategie,
    gatekeeper_status: 'concept — nog niet gevalideerd',
  }
}

export function coerceGatekeeperResultaat(raw: unknown): GatekeeperResultaat {
  const o =
    raw && typeof raw === 'object' && 'gatekeeper_resultaat' in (raw as object)
      ? ((raw as { gatekeeper_resultaat: unknown }).gatekeeper_resultaat as Record<string, unknown>)
      : (raw as Record<string, unknown>)

  const bool = (v: unknown) => v === true

  const statusRaw = o?.gatekeeper_status
  let gatekeeper_status: GatekeeperResultaat['gatekeeper_status'] = 'needs_revision'
  if (statusRaw === 'approved' || statusRaw === 'rejected' || statusRaw === 'needs_revision') {
    gatekeeper_status = statusRaw
  }

  const bevindingen = Array.isArray(o?.bevindingen)
    ? (o.bevindingen as unknown[]).map((x) => clipField(x, 2000)).filter(Boolean)
    : []

  return {
    gatekeeper_status,
    bronplicht_goedgekeurd: bool(o?.bronplicht_goedgekeurd),
    aannames_goedgekeurd: bool(o?.aannames_goedgekeurd),
    externe_bronnen_correct_gelabeld: bool(o?.externe_bronnen_correct_gelabeld),
    volledigheid_goedgekeurd: bool(o?.volledigheid_goedgekeurd),
    consistentie_goedgekeurd: bool(o?.consistentie_goedgekeurd),
    json_validatie_goedgekeurd: bool(o?.json_validatie_goedgekeurd),
    bevindingen,
  }
}

function coerceNviItem(x: unknown): NviVraag | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  const formulering = String(r.formulering ?? r.vraag ?? '').trim()
  if (!formulering) return null
  return {
    categorie: nviCat(r.categorie),
    doel: String(r.doel ?? 'NVI — gatekeeper'),
    bron: String(r.bron ?? 'Gatekeeper-validatie'),
    formulering,
    waarom_belangrijk_voor_risico: String(r.waarom_belangrijk_voor_risico ?? ''),
    waarom_belangrijk_voor_aanneemsom: String(r.waarom_belangrijk_voor_aanneemsom ?? ''),
    waarom_belangrijk_voor_planning: String(
      r.waarom_belangrijk_voor_planning ?? '',
    ),
    gewenste_bevestiging_of_verduidelijking: String(r.gewenste_bevestiging_of_verduidelijking ?? ''),
  }
}

function coerceTop5Risico(x: unknown): Top5Risico | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  const titel = String(r.titel ?? '').trim()
  if (!titel) return null
  return {
    titel,
    ernstscore: nlScore(r.ernstscore),
    waarom_toprisico: String(r.waarom_toprisico ?? ''),
    bron: String(r.bron ?? ''),
    actie: String(r.actie ?? ''),
  }
}

function coerceTop5Prijs(x: unknown): Top5PrijsFactor | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  const factor = String(r.factor ?? '').trim()
  if (!factor) return null
  const statusRaw = r.status_van_onderbouwing ?? r.status
  return {
    factor,
    bron: String(r.bron ?? ''),
    status_van_onderbouwing: onderbouwing(statusRaw),
    mogelijke_prijsimpact: nlScore(r.mogelijke_prijsimpact),
    toelichting: String(r.toelichting ?? ''),
    verificatie: String(r.verificatie ?? ''),
  }
}

function coerceTop5Planning(x: unknown): Top5PlanningsRisico | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  const risico = String(r.risico ?? '').trim()
  if (!risico) return null
  return {
    risico,
    bron: String(r.bron ?? ''),
    status_van_onderbouwing: onderbouwing(r.status_van_onderbouwing),
    mogelijke_planningsimpact: nlScore(r.mogelijke_planningsimpact),
    toelichting: String(r.toelichting ?? ''),
    actie: String(r.actie ?? ''),
  }
}

function coerceLeemte(x: unknown): RisicoAnalyseV2Result['leemtes'][number] | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  const ontbrekend = String(r.ontbrekende_informatie ?? '').trim()
  if (!ontbrekend) return null
  return {
    ontbrekende_informatie: ontbrekend,
    waarom_belangrijk: String(r.waarom_belangrijk ?? ''),
    risico_voor_inschrijver: String(r.risico_voor_inschrijver ?? ''),
    vraag_nvi: String(r.vraag_nvi ?? ''),
  }
}

function coerceTegen(x: unknown): Tegenstrijdigheid | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  const oms = String(r.omschrijving ?? '').trim()
  if (!oms) return null
  return {
    omschrijving: oms,
    document_1: String(r.document_1 ?? ''),
    document_2: String(r.document_2 ?? ''),
    risico: String(r.risico ?? ''),
    actie: String(r.actie ?? ''),
  }
}

function coerceNoGo(x: unknown): RisicoAnalyseV2Result['no_go_factoren'][number] | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  const factor = String(r.factor ?? '').trim()
  if (!factor) return null
  return {
    factor,
    bron: String(r.bron ?? ''),
    waarom_no_go: String(r.waarom_no_go ?? ''),
    kan_worden_opgelost_door: String(r.kan_worden_opgelost_door ?? ''),
  }
}

function coerceStrategiePatch(raw: unknown): Partial<InschrijfStrategieV2> | null {
  if (!raw || typeof raw !== 'object') return null
  let o = raw as Record<string, unknown>
  if ('inschrijfstrategie' in o && o.inschrijfstrategie && typeof o.inschrijfstrategie === 'object') {
    o = o.inschrijfstrategie as Record<string, unknown>
  }
  const out: Partial<InschrijfStrategieV2> = {}
  if (typeof o.advies === 'string' && VALID_ADVIES.has(o.advies as InschrijfAdviesV2)) {
    out.advies = o.advies as InschrijfAdviesV2
  }
  if (typeof o.toelichting === 'string' && o.toelichting.trim()) out.toelichting = o.toelichting.trim()
  const strArr = (k: keyof InschrijfStrategieV2) => {
    const v = o[k as string]
    if (!Array.isArray(v)) return
    const xs = v.map((x) => String(x ?? '').trim()).filter(Boolean)
    if (xs.length > 0) (out as Record<string, unknown>)[k as string] = xs
  }
  strArr('belangrijkste_voorwaarden_voor_inschrijving')
  strArr('risicos_die_via_nvi_moeten_worden_opgehelderd')
  strArr('risicos_die_in_prijs_of_planning_moeten_worden_verwerkt')
  strArr('niet_acceptabele_risicos')
  strArr('strategische_aandachtspunten')
  strArr('no_go_signalen')
  return Object.keys(out).length > 0 ? out : null
}

/** Normaliseert volledige Gatekeeper-LLM-output; ontbreekt gatekeeper_resultaat → needs_revision. */
export function coerceGatekeeperOutput(parsed: unknown): GatekeeperOutput {
  const root = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}

  const gatekeeper_resultaat =
    root.gatekeeper_resultaat != null
      ? coerceGatekeeperResultaat(root)
      : ({
          gatekeeper_status: 'needs_revision' as const,
          bronplicht_goedgekeurd: false,
          aannames_goedgekeurd: false,
          externe_bronnen_correct_gelabeld: false,
          volledigheid_goedgekeurd: false,
          consistentie_goedgekeurd: false,
          json_validatie_goedgekeurd: false,
          bevindingen: ['Gatekeeper: ontbrekend gatekeeper_resultaat in modelantwoord.'],
        } satisfies GatekeeperResultaat)

  let gecorrigeerde_nvi: GatekeeperOutput['gecorrigeerde_nvi'] = undefined
  const nviRaw = root.gecorrigeerde_nvi
  if (nviRaw && typeof nviRaw === 'object' && 'vragen_nvi' in (nviRaw as object)) {
    const arr = (nviRaw as { vragen_nvi: unknown }).vragen_nvi
    if (Array.isArray(arr)) {
      const vragen_nvi = arr.map(coerceNviItem).filter((x): x is NviVraag => x != null)
      if (vragen_nvi.length > 0) gecorrigeerde_nvi = { vragen_nvi }
    }
  }

  let gecorrigeerde_strategie: GatekeeperOutput['gecorrigeerde_strategie'] = undefined
  const stPatch = coerceStrategiePatch(root.gecorrigeerde_strategie)
  if (stPatch) gecorrigeerde_strategie = stPatch

  let gecorrigeerde_integratie: GatekeeperOutput['gecorrigeerde_integratie'] = undefined
  const intRaw = root.gecorrigeerde_integratie
  if (intRaw && typeof intRaw === 'object') {
    const p = intRaw as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    const mapArr = <T>(key: string, fn: (x: unknown) => T | null) => {
      const v = p[key]
      if (!Array.isArray(v)) return
      const xs = v.map(fn).filter((x): x is NonNullable<T> => x != null)
      if (xs.length > 0) patch[key] = xs
    }
    mapArr('top5_risicos', coerceTop5Risico)
    mapArr('top5_prijsverhogende_risicofactoren', coerceTop5Prijs)
    mapArr('top5_planningsrisicos', coerceTop5Planning)
    mapArr('leemtes', coerceLeemte)
    mapArr('tegenstrijdigheden', coerceTegen)
    mapArr('no_go_factoren', coerceNoGo)
    if (typeof p.overall_score === 'string' && VALID_SCORE.has(p.overall_score as RisicoScoreV2)) {
      patch.overall_score = p.overall_score
    }
    if (typeof p.overall_toelichting === 'string' && p.overall_toelichting.trim()) {
      patch.overall_toelichting = p.overall_toelichting.trim()
    }
    if (Object.keys(patch).length > 0) gecorrigeerde_integratie = patch
  }

  return {
    gatekeeper_resultaat,
    gecorrigeerde_nvi,
    gecorrigeerde_strategie,
    gecorrigeerde_integratie,
  }
}

export function gatekeeperParseFailureOutput(message: string): GatekeeperOutput {
  return coerceGatekeeperOutput({
    gatekeeper_resultaat: {
      gatekeeper_status: 'needs_revision',
      bronplicht_goedgekeurd: false,
      aannames_goedgekeurd: false,
      externe_bronnen_correct_gelabeld: false,
      volledigheid_goedgekeurd: false,
      consistentie_goedgekeurd: false,
      json_validatie_goedgekeurd: false,
      bevindingen: [clipField(message, 1500)],
    },
  })
}
