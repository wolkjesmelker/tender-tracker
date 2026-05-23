/**
 * Compacte payload voor de integratie-LLM + deterministische fallback als parse faalt.
 */

import type { FeitenJson, RisicoAnalyseV2Result, RisicoScoreV2 } from '../../../shared/types-risico-v2'
import type { RisicoIntegratieResult } from './stage3-risico-integratie'

const SCORE_W: Record<RisicoScoreV2, number> = { Laag: 1, Middel: 2, Hoog: 3 }

function normalizeNlScore(s: unknown, fallback: RisicoScoreV2 = 'Middel'): RisicoScoreV2 {
  if (s === 'Laag' || s === 'Middel' || s === 'Hoog') return s
  const t = String(s ?? '').toLowerCase()
  if (t.includes('hoog')) return 'Hoog'
  if (t.includes('laag')) return 'Laag'
  return fallback
}

function maxScore(scores: RisicoScoreV2[]): RisicoScoreV2 {
  return scores.reduce<RisicoScoreV2>(
    (b, s) => (SCORE_W[s] > SCORE_W[b] ? s : b),
    'Laag',
  )
}

/**
 * Verkleint JSON voor de integratie-call: kortere strings, begrensde arrays (zelfde feiten/inhoud, minder tokens).
 */
export function compactValueForIntegratiePrompt(
  val: unknown,
  maxStr: number,
  maxDepth: number,
  maxArray: number,
): unknown {
  if (maxDepth <= 0) return '[ … ]'
  if (val == null) return val
  if (typeof val === 'string') {
    if (val.length <= maxStr) return val
    return val.slice(0, maxStr) + '…'
  }
  if (typeof val === 'number' || typeof val === 'boolean') return val
  if (Array.isArray(val)) {
    const slice = val.slice(0, maxArray)
    return slice.map((x) => compactValueForIntegratiePrompt(x, maxStr, maxDepth - 1, maxArray))
  }
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) {
      out[k] = compactValueForIntegratiePrompt(v, maxStr, maxDepth - 1, maxArray)
    }
    return out
  }
  return val
}

export function compactFeitenForIntegratie(feiten: FeitenJson): FeitenJson {
  const compacted = compactValueForIntegratiePrompt(feiten, 550, 14, 450) as FeitenJson
  return {
    feiten: Array.isArray(compacted.feiten) ? compacted.feiten : [],
    ontbrekende_kerninformatie: Array.isArray(compacted.ontbrekende_kerninformatie)
      ? compacted.ontbrekende_kerninformatie
      : [],
    conflicterende_feiten: Array.isArray(compacted.conflicterende_feiten)
      ? compacted.conflicterende_feiten
      : [],
  }
}

export function compactStage2ForIntegratie(stage2: Record<string, unknown>): Record<string, unknown> {
  return compactValueForIntegratiePrompt(stage2, 480, 16, 800) as Record<string, unknown>
}

function registerItemFromDraftRisico(
  r: RisicoAnalyseV2Result['risicogebieden'][number]['risicos'][number],
  categorie: string,
): RisicoIntegratieResult['geintegreerd_risicoregister'][number] {
  return {
    nummer: r.nummer,
    titel: r.titel,
    categorie,
    ernstscore: r.ernstscore,
    kans: r.kans,
    impact: r.impact,
    type: r.type,
    feit: r.feit,
    bron: r.bron,
    status_van_onderbouwing: r.status_van_onderbouwing,
    professionele_duiding: r.professionele_duiding,
    juridische_duiding: r.juridische_duiding,
    waarom_risico: r.waarom_risico,
    mogelijke_prijsimpact: r.mogelijke_prijsimpact,
    mogelijke_planningsimpact: r.mogelijke_planningsimpact,
    actie: r.actie,
    gekoppelde_nvi_vraag: r.conceptvraag_nvi,
  }
}

/** Als de integratie-LLM faalt: deterministisch bouwen uit stage-2-draft + feiten (geen nieuwe feiten). */
export function buildIntegratieFallbackFromDraft(
  draft: RisicoAnalyseV2Result,
  feiten: FeitenJson,
): RisicoIntegratieResult {
  const register: RisicoIntegratieResult['geintegreerd_risicoregister'] = []
  for (const gebied of draft.risicogebieden ?? []) {
    const cat = gebied.naam || 'Domein'
    for (const r of gebied.risicos ?? []) {
      register.push(registerItemFromDraftRisico(r, cat))
    }
  }

  const flatRisicos = (draft.risicogebieden ?? []).flatMap((g) =>
    (g.risicos ?? []).map((r) => ({ gebied: g.naam, r })),
  )
  const byErnst = [...flatRisicos].sort(
    (a, b) => SCORE_W[b.r.ernstscore] - SCORE_W[a.r.ernstscore],
  )
  const top5_risicos = byErnst.slice(0, 5).map(({ r }) => ({
    titel: r.titel,
    ernstscore: r.ernstscore,
    waarom_toprisico: r.waarom_risico || r.feit,
    bron: r.bron,
    actie: r.actie,
  }))

  const prijsKandidaten = [...flatRisicos]
    .filter((x) => x.r.mogelijke_prijsimpact === 'Hoog' || x.r.ernstscore === 'Hoog')
    .slice(0, 5)
  const top5_prijsverhogende_risicofactoren = prijsKandidaten.map(({ r }) => ({
    factor: r.titel,
    bron: r.bron,
    status: r.status_van_onderbouwing,
    mogelijke_prijsimpact: r.mogelijke_prijsimpact,
    toelichting: r.prijsimpact_toelichting || r.waarom_risico || r.feit,
    verificatie: r.verificatie,
  }))

  const planningKandidaten = [...flatRisicos]
    .filter((x) => x.r.mogelijke_planningsimpact === 'Hoog' || x.r.type === 'planningsrisico')
    .slice(0, 5)
  const top5_planningsrisicos = planningKandidaten.map(({ r }) => ({
    risico: r.titel,
    bron: r.bron,
    status_van_onderbouwing: r.status_van_onderbouwing,
    mogelijke_planningsimpact: r.mogelijke_planningsimpact,
    toelichting: r.planningsimpact_toelichting || r.waarom_risico || r.feit,
    actie: r.actie,
  }))

  const leemtes = (feiten.ontbrekende_kerninformatie ?? []).map((x) => ({
    ontbrekende_informatie: x.onderwerp,
    waarom_belangrijk: x.reden_relevant,
    risico_voor_inschrijver: 'Calculatie- en inschrijfrisico door ontbrekende specificatie.',
    vraag_nvi: `Kunt u ${x.onderwerp} specificeren of bevestigen?`,
  }))

  const tegenstrijdigheden = (feiten.conflicterende_feiten ?? []).map((x) => ({
    omschrijving: x.conflict,
    document_1: x.bron_1,
    document_2: x.bron_2,
    risico: `Tegenstrijdigheid over: ${x.onderwerp}`,
    actie: 'NVI en expliciete keuze in calculatie/stukken.',
  }))

  const gebiedScores = (draft.risicogebieden ?? []).map((g) => g.score)
  const overall = maxScore(gebiedScores.length > 0 ? gebiedScores : [normalizeNlScore(draft.overall_score)])

  return {
    overall_score: overall,
    overall_toelichting:
      'Geautomatiseerde integratie (fallback): samenvoeging van alle domeinagent-resultaten zonder LLM-synthese. ' +
      'Uitvoer is beperkt tot feiten uit eerdere stappen; voer desgewenst de analyse opnieuw uit.',
    top5_risicos,
    top5_prijsverhogende_risicofactoren,
    top5_planningsrisicos,
    geintegreerd_risicoregister: register,
    no_go_factoren: [],
    leemtes,
    tegenstrijdigheden,
  }
}
