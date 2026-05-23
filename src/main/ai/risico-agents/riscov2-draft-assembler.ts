/**
 * Risico V2 Draft Assembler
 *
 * Deterministisch opgebouwde "bron van waarheid" voor het eindrapport.
 * Na elke pipeline-stage wordt een compleet, opgeslagen RisicoAnalyseV2Result
 * bijgewerkt — zodat geen analysedata verloren gaat bij crash of truncatie.
 *
 * Stage 1a  → document_inventarisatie + algemene_tenderanalyse (platte strings)
 * Stage 1b  → leemtes + tegenstrijdigheden vanuit feitenbasis; NVI-stubs
 * Stage 2   → risicogebieden (altijd gevuld uit domeinarrays)
 * Stage 3   → risicogebieden verrijkt uit integratie-register, top5-blokken,
 *              vragen_nvi (union), inschrijfstrategie, overall_score
 * pre_final → management_samenvatting + overall_toelichting uit eindrapport-LLM
 */

import type {
  FeitenJson,
  LocatieOmgevingsanalyse,
  NviCategorie,
  NviVraag,
  RisicoAnalyseV2Result,
  RisicoScoreV2,
} from '../../../shared/types-risico-v2'
import type { DocumentIntakeResult } from './stage1-document-intake'
import type { TenderAnalyseResult } from './stage1-tenderanalyse'
import type { RisicoIntegratieResult } from './stage3-risico-integratie'
import type { InschrijfStrategieResult } from './stage3-inschrijfstrategie'
import type { NviVragenResult } from './stage3-nvi-vragen'

import {
  buildAlgemeneTenderanalyseV2,
  buildRisicogebiedenUitIntegratie,
  buildRisicogebiedenUitStage2,
  heeftInhoudelijkeRisicogebieden,
} from './eindrapportage-enrichment'

// ── Config ───────────────────────────────────────────────────────────────────

const MAX_NVI_VRAGEN = 40
const MAX_LEEMTES = 25
const MAX_TEGENSTRIJDIGHEDEN = 20

export type DraftStage = '1a' | '1b' | '2' | '3' | 'pre_final'

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeScore(s: unknown, fallback: RisicoScoreV2 = 'Middel'): RisicoScoreV2 {
  if (s === 'Laag' || s === 'Middel' || s === 'Hoog') return s
  return fallback
}

const SCORE_WEIGHT: Record<RisicoScoreV2, number> = { Laag: 1, Middel: 2, Hoog: 3 }

function maxScore(scores: RisicoScoreV2[]): RisicoScoreV2 {
  return scores.reduce<RisicoScoreV2>(
    (best, s) => (SCORE_WEIGHT[s] > SCORE_WEIGHT[best] ? s : best),
    'Laag',
  )
}

function emptyLocatie(): LocatieOmgevingsanalyse {
  return {
    adres_of_werkgebied: 'Niet vast te stellen op basis van de stukken.',
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

function emptyDraft(): RisicoAnalyseV2Result {
  return {
    schema_versie: 'v2',
    overall_score: 'Middel',
    overall_toelichting: '',
    inschrijfadvies: 'hoog_risico',
    management_samenvatting: '',
    bewijs_en_aannameregel: {
      toegepast: true,
      toelichting: 'Enkel feiten uit de aangeleverde stukken zijn gebruikt.',
      niet_onderbouwde_aannames_geweigerd: true,
    },
    algemene_tenderanalyse: {
      aanbestedende_dienst: '',
      procedure: '',
      opdrachtomschrijving: '',
      contractvorm: '',
      gunningssystematiek: '',
      belangrijkste_termijnen: [],
      belangrijkste_tenderrisicos: [],
    },
    document_leesplicht_bevestiging: {
      alle_aangeleverde_documenten_geanalyseerd: false,
      toelichting: '',
      ontbrekende_of_onleesbare_documenten: [],
    },
    document_inventarisatie: [],
    locatie_en_omgevingsanalyse: emptyLocatie(),
    top5_risicos: [],
    top5_prijsverhogende_risicofactoren: [],
    top5_planningsrisicos: [],
    risicogebieden: [],
    tegenstrijdigheden: [],
    leemtes: [],
    no_go_factoren: [],
    vragen_nvi: [],
    inschrijfstrategie: {
      advies: 'hoog_risico',
      toelichting: '',
      belangrijkste_voorwaarden_voor_inschrijving: [],
      risicos_die_via_nvi_moeten_worden_opgehelderd: [],
      risicos_die_in_prijs_of_planning_moeten_worden_verwerkt: [],
      niet_acceptabele_risicos: [],
      strategische_aandachtspunten: [],
      no_go_signalen: [],
    },
    gatekeeper_resultaat: {
      gatekeeper_status: 'needs_revision',
      bronplicht_goedgekeurd: false,
      aannames_goedgekeurd: false,
      externe_bronnen_correct_gelabeld: false,
      volledigheid_goedgekeurd: false,
      consistentie_goedgekeurd: false,
      json_validatie_goedgekeurd: true,
      bevindingen: ['Analyse nog niet afgerond.'],
    },
  }
}

// ── NVI dedupe + prioritering ─────────────────────────────────────────────────

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}

function dedupeNvi(items: NviVraag[]): NviVraag[] {
  const seen = new Set<string>()
  return items.filter((v) => {
    const key = normalizeKey(v.formulering || v.doel || '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const NVI_CATEGORIE_MAP: Record<string, NviCategorie> = {
  juridisch: 'juridisch',
  financieel: 'financieel',
  uitvoering: 'uitvoering',
  planning: 'planning',
  hoeveelheden: 'hoeveelheden',
  bodem: 'bodem',
  grondwater: 'grondwater',
  riolering: 'riolering',
  verkeer: 'verkeer',
  omgeving: 'omgeving',
  vergunningen: 'vergunningen',
  veiligheid: 'veiligheid',
  contract: 'contract',
  gunning: 'gunning',
  procedure: 'procedure',
}

function guessCategorie(text: string): NviCategorie {
  const t = text.toLowerCase()
  for (const [k, v] of Object.entries(NVI_CATEGORIE_MAP)) {
    if (t.includes(k)) return v
  }
  return 'procedure'
}

/**
 * Zet FeitenJson.ontbrekende_kerninformatie om naar NviVraag-stubs.
 * Alleen items met status 'ontbrekend' of 'conflicterend' → NVI-vraag.
 */
function nviStubsUitFeiten(feiten: FeitenJson): NviVraag[] {
  const stubs: NviVraag[] = []
  for (const item of feiten.ontbrekende_kerninformatie ?? []) {
    const cat = guessCategorie(item.onderwerp + ' ' + item.reden_relevant)
    stubs.push({
      categorie: cat,
      doel: `Ontbrekende kerninformatie: ${item.onderwerp}`,
      bron: 'Feitenbasis — ontbrekende kerninformatie',
      formulering: `Kunt u bevestigen of verduidelijken: ${item.onderwerp}? Reden: ${item.reden_relevant}`,
      waarom_belangrijk_voor_risico: item.reden_relevant,
      waarom_belangrijk_voor_aanneemsom: `Ontbrekende informatie over "${item.onderwerp}" verhoogt calculatierisico.`,
      waarom_belangrijk_voor_planning: `Ontbrekende informatie over "${item.onderwerp}" kan planningsimpact hebben.`,
      gewenste_bevestiging_of_verduidelijking: `Verduidelijking van: ${item.onderwerp}`,
    })
  }
  for (const item of feiten.conflicterende_feiten ?? []) {
    const cat = guessCategorie(item.onderwerp)
    stubs.push({
      categorie: cat,
      doel: `Tegenstrijdige informatie: ${item.onderwerp}`,
      bron: `${item.bron_1} / ${item.bron_2}`,
      formulering: `Er bestaat een tegenstrijdigheid over "${item.onderwerp}" tussen ${item.bron_1} en ${item.bron_2}. Welke informatie is leidend? Conflict: ${item.conflict}`,
      waarom_belangrijk_voor_risico: `Conflict verhoogt risico op interpretatieverschillen en aansprakelijkheid.`,
      waarom_belangrijk_voor_aanneemsom: `Tegenstrijdigheid over "${item.onderwerp}" geeft calculatieonzekerheid.`,
      waarom_belangrijk_voor_planning: `Tegenstrijdigheid kan planningsunsicherheid veroorzaken.`,
      gewenste_bevestiging_of_verduidelijking: `Bevestiging welk document leidend is bij "${item.onderwerp}".`,
    })
  }
  return stubs
}

/**
 * Zet FeitenJson.conflicterende_feiten om naar Tegenstrijdigheden.
 */
function tegenstrijdighedenUitFeiten(feiten: FeitenJson): RisicoAnalyseV2Result['tegenstrijdigheden'] {
  return (feiten.conflicterende_feiten ?? []).map((c) => ({
    omschrijving: c.conflict,
    document_1: c.bron_1,
    document_2: c.bron_2,
    risico: `Tegenstrijdige informatie over "${c.onderwerp}" leidt tot interpretatierisico.`,
    actie: 'Ophelderen via Nota van Inlichtingen.',
  }))
}

/**
 * Zet FeitenJson.ontbrekende_kerninformatie om naar Leemtes.
 */
function leemtesUitFeiten(feiten: FeitenJson): RisicoAnalyseV2Result['leemtes'] {
  return (feiten.ontbrekende_kerninformatie ?? []).map((o) => ({
    ontbrekende_informatie: o.onderwerp,
    waarom_belangrijk: o.reden_relevant,
    risico_voor_inschrijver: `Ontbrekende informatie over "${o.onderwerp}" verhoogt risico en onzekerheid bij inschrijving.`,
    vraag_nvi: `Kunt u bevestigen of verduidelijken: ${o.onderwerp}?`,
  }))
}

/**
 * Samenvoegen + sorteren + begrenzen van NVI-vragen.
 * Prioriteit: conflicting feiten > ontbrekende feiten > agent-uitkomsten.
 */
function mergeNviVragen(
  fromFeiten: NviVraag[],
  fromNviAgent: NviVraag[],
  fromIntegratie: NviVraag[],
): NviVraag[] {
  const combined = [...fromFeiten, ...fromIntegratie, ...fromNviAgent]
  const deduped = dedupeNvi(combined)
  return deduped.slice(0, MAX_NVI_VRAGEN)
}

function mergeLeemtes(
  fromFeiten: RisicoAnalyseV2Result['leemtes'],
  fromIntegratie: RisicoAnalyseV2Result['leemtes'],
): RisicoAnalyseV2Result['leemtes'] {
  const seen = new Set<string>()
  const out: RisicoAnalyseV2Result['leemtes'] = []
  for (const l of [...fromFeiten, ...fromIntegratie]) {
    const key = normalizeKey(l.ontbrekende_informatie)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(l)
  }
  return out.slice(0, MAX_LEEMTES)
}

function mergeTegenstrijdigheden(
  fromFeiten: RisicoAnalyseV2Result['tegenstrijdigheden'],
  fromIntegratie: RisicoAnalyseV2Result['tegenstrijdigheden'],
): RisicoAnalyseV2Result['tegenstrijdigheden'] {
  const seen = new Set<string>()
  const out: RisicoAnalyseV2Result['tegenstrijdigheden'] = []
  for (const t of [...fromFeiten, ...fromIntegratie]) {
    const key = normalizeKey(t.omschrijving + t.document_1)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out.slice(0, MAX_TEGENSTRIJDIGHEDEN)
}

// ── Assembler stages ──────────────────────────────────────────────────────────

/**
 * Stage 1a: vullen uit document-intake + tenderanalyse.
 */
export function assembleDraftStage1a(
  intakeResult: DocumentIntakeResult,
  tenderResult: TenderAnalyseResult,
): RisicoAnalyseV2Result {
  const draft = emptyDraft()
  const algemene = buildAlgemeneTenderanalyseV2(
    undefined,
    tenderResult?.algemene_tenderanalyse,
  )
  const inv = intakeResult.document_inventarisatie ?? []
  const onleesbaar = inv.filter((d) => !d.leesbaar).map((d) => d.naam)
  const n = inv.length
  /** Alleen groen als intake minstens één item oplevert én niets als onleesbaar is gemarkeerd. */
  const alleGeanalyseerdVolgensIntake = n > 0 && onleesbaar.length === 0

  let toelichting: string
  if (n === 0) {
    toelichting =
      'Document Intake Agent leverde geen inventarisatie (0 documenten). Verdere analyse gebruikt wel de beschikbare documentteksten.'
  } else if (onleesbaar.length > 0) {
    toelichting = `${n} document${n === 1 ? '' : 'en'} in inventarisatie; ${onleesbaar.length} als onleesbaar of incompleet gemarkeerd.`
  } else {
    toelichting = `${n} document${n === 1 ? '' : 'en'} verwerkt door Document Intake Agent.`
  }

  return {
    ...draft,
    algemene_tenderanalyse: algemene,
    document_inventarisatie: inv,
    document_leesplicht_bevestiging: {
      alle_aangeleverde_documenten_geanalyseerd: alleGeanalyseerdVolgensIntake,
      toelichting,
      ontbrekende_of_onleesbare_documenten: onleesbaar,
    },
  }
}

/**
 * Stage 1b: voeg leemtes + tegenstrijdigheden + NVI-stubs toe uit feitenbasis.
 */
export function assembleDraftStage1b(
  draft1a: RisicoAnalyseV2Result,
  feiten: FeitenJson,
): RisicoAnalyseV2Result {
  const leemtesFeiten = leemtesUitFeiten(feiten)
  const tegenstrijdighedenFeiten = tegenstrijdighedenUitFeiten(feiten)
  const nviStubs = nviStubsUitFeiten(feiten)

  return {
    ...draft1a,
    leemtes: mergeLeemtes(leemtesFeiten, []),
    tegenstrijdigheden: mergeTegenstrijdigheden(tegenstrijdighedenFeiten, []),
    vragen_nvi: dedupeNvi(nviStubs).slice(0, MAX_NVI_VRAGEN),
  }
}

/**
 * Stage 2: risicogebieden vullen uit stage2-domeinarrays.
 */
export function assembleDraftStage2(
  draft1b: RisicoAnalyseV2Result,
  stage2Combined: Record<string, unknown>,
): RisicoAnalyseV2Result {
  const gebieden = buildRisicogebiedenUitStage2(stage2Combined)
  const alleScores = gebieden.map((g) => g.score)
  const overall_score = alleScores.length > 0 ? maxScore(alleScores) : draft1b.overall_score

  return {
    ...draft1b,
    risicogebieden: gebieden,
    overall_score,
  }
}

/**
 * Stage 3: verrijken met integratie-register, NVI-agent, inschrijfstrategie.
 * Behoudt altijd stage2-gebieden als integratie-register leeg is.
 */
export function assembleDraftStage3(
  draft2: RisicoAnalyseV2Result,
  integratie: RisicoIntegratieResult,
  nviResult: NviVragenResult,
  strategie: InschrijfStrategieResult,
  feiten: FeitenJson,
): RisicoAnalyseV2Result {
  // Risicogebieden: primair integratie-register; stage2 als fallback
  const gebiedenUitIntegratie = buildRisicogebiedenUitIntegratie(integratie)
  const risicogebieden = heeftInhoudelijkeRisicogebieden(gebiedenUitIntegratie)
    ? gebiedenUitIntegratie
    : draft2.risicogebieden

  // Top 5's
  const top5_risicos =
    Array.isArray(integratie.top5_risicos) && integratie.top5_risicos.length > 0
      ? integratie.top5_risicos
      : draft2.top5_risicos

  const top5_planningsrisicos =
    Array.isArray(integratie.top5_planningsrisicos) && integratie.top5_planningsrisicos.length > 0
      ? integratie.top5_planningsrisicos
      : draft2.top5_planningsrisicos

  const top5_prijsverhogende_risicofactoren =
    Array.isArray(integratie.top5_prijsverhogende_risicofactoren) &&
    integratie.top5_prijsverhogende_risicofactoren.length > 0
      ? integratie.top5_prijsverhogende_risicofactoren.map((p) => ({
          factor: p.factor,
          bron: p.bron,
          status_van_onderbouwing: (
            (p as { status_van_onderbouwing?: string }).status_van_onderbouwing ??
            (p as { status?: string }).status ??
            'niet vast te stellen op basis van de stukken'
          ) as RisicoAnalyseV2Result['top5_prijsverhogende_risicofactoren'][0]['status_van_onderbouwing'],
          mogelijke_prijsimpact: normalizeScore(p.mogelijke_prijsimpact),
          toelichting: p.toelichting ?? '',
          verificatie: p.verificatie ?? '',
        }))
      : draft2.top5_prijsverhogende_risicofactoren

  // NVI: union van feiten-stubs + NVI-agent + integratie-conceptvragen
  const nviUitIntegratie: NviVraag[] = (integratie.geintegreerd_risicoregister ?? [])
    .filter((r) => r.gekoppelde_nvi_vraag && String(r.gekoppelde_nvi_vraag).length > 5)
    .map((r) => ({
      categorie: guessCategorie(r.categorie + ' ' + r.titel),
      doel: r.titel,
      bron: r.bron ?? '',
      formulering: String(r.gekoppelde_nvi_vraag),
      waarom_belangrijk_voor_risico: r.waarom_risico ?? '',
      waarom_belangrijk_voor_aanneemsom: '',
      waarom_belangrijk_voor_planning: '',
      gewenste_bevestiging_of_verduidelijking: String(r.gekoppelde_nvi_vraag),
    }))

  const nviStubs = nviStubsUitFeiten(feiten)
  const vragen_nvi = mergeNviVragen(nviStubs, nviResult.vragen_nvi ?? [], nviUitIntegratie)

  // Leemtes + tegenstrijdigheden: union feiten + integratie
  const leemtesFeiten = leemtesUitFeiten(feiten)
  const leemtes = mergeLeemtes(leemtesFeiten, integratie.leemtes ?? [])

  const tegenstrijdighedenFeiten = tegenstrijdighedenUitFeiten(feiten)
  const tegenstrijdigheden = mergeTegenstrijdigheden(tegenstrijdighedenFeiten, integratie.tegenstrijdigheden ?? [])

  // No-go factoren
  const no_go_factoren =
    Array.isArray(integratie.no_go_factoren) && integratie.no_go_factoren.length > 0
      ? integratie.no_go_factoren
      : draft2.no_go_factoren

  // Overall score uit integratie
  const overall_score = normalizeScore(integratie.overall_score, draft2.overall_score)
  const overall_toelichting = integratie.overall_toelichting || draft2.overall_toelichting

  // Inschrijfstrategie
  const rawStrat = strategie.inschrijfstrategie
  const inschrijfstrategie = rawStrat
    ? {
        advies: rawStrat.advies ?? 'hoog_risico',
        toelichting: rawStrat.toelichting ?? '',
        belangrijkste_voorwaarden_voor_inschrijving:
          rawStrat.belangrijkste_voorwaarden_voor_inschrijving ?? [],
        risicos_die_via_nvi_moeten_worden_opgehelderd:
          rawStrat.risicos_die_via_nvi_moeten_worden_opgehelderd ?? [],
        risicos_die_in_prijs_of_planning_moeten_worden_verwerkt:
          rawStrat.risicos_die_in_prijs_of_planning_moeten_worden_verwerkt ?? [],
        niet_acceptabele_risicos: rawStrat.niet_acceptabele_risicos ?? [],
        strategische_aandachtspunten: rawStrat.strategische_aandachtspunten ?? [],
        no_go_signalen: rawStrat.no_go_signalen ?? [],
      }
    : draft2.inschrijfstrategie

  return {
    ...draft2,
    overall_score,
    overall_toelichting,
    risicogebieden,
    top5_risicos,
    top5_planningsrisicos,
    top5_prijsverhogende_risicofactoren,
    leemtes,
    tegenstrijdigheden,
    no_go_factoren,
    vragen_nvi,
    inschrijfstrategie,
    inschrijfadvies: inschrijfstrategie.advies as RisicoAnalyseV2Result['inschrijfadvies'],
  }
}

/**
 * pre_final: merge kleinere LLM-uitkomsten (management_samenvatting, overall_toelichting, inschrijfadvies)
 * over de bestaande assembled draft. Grote blokken (risicogebieden, NVI, etc.) NIET overschrijven.
 */
export function assembleDraftPreFinal(
  draft3: RisicoAnalyseV2Result,
  finaleSnippets: Partial<Pick<
    RisicoAnalyseV2Result,
    | 'management_samenvatting'
    | 'overall_toelichting'
    | 'inschrijfadvies'
    | 'bewijs_en_aannameregel'
    | 'document_leesplicht_bevestiging'
    | 'locatie_en_omgevingsanalyse'
    | 'risicogebieden'
    | 'top5_risicos'
    | 'top5_planningsrisicos'
    | 'top5_prijsverhogende_risicofactoren'
    | 'vragen_nvi'
    | 'leemtes'
    | 'tegenstrijdigheden'
    | 'no_go_factoren'
    | 'inschrijfstrategie'
    | 'algemene_tenderanalyse'
  >>,
): RisicoAnalyseV2Result {
  return {
    ...draft3,
    // Narratieve tekstvelden: altijd overschrijven als LLM iets zinnigs leverde
    management_samenvatting:
      finaleSnippets.management_samenvatting?.trim()
        ? finaleSnippets.management_samenvatting
        : draft3.management_samenvatting,
    overall_toelichting:
      finaleSnippets.overall_toelichting?.trim()
        ? finaleSnippets.overall_toelichting
        : draft3.overall_toelichting,
    inschrijfadvies:
      finaleSnippets.inschrijfadvies ?? draft3.inschrijfadvies,

    // Structurele blokken: ALLEEN overschrijven als de LLM meer heeft dan de draft
    risicogebieden: heeftInhoudelijkeRisicogebieden(finaleSnippets.risicogebieden)
      ? finaleSnippets.risicogebieden!
      : draft3.risicogebieden,
    top5_risicos:
      Array.isArray(finaleSnippets.top5_risicos) && finaleSnippets.top5_risicos.length > 0
        ? finaleSnippets.top5_risicos
        : draft3.top5_risicos,
    top5_planningsrisicos:
      Array.isArray(finaleSnippets.top5_planningsrisicos) && finaleSnippets.top5_planningsrisicos.length > 0
        ? finaleSnippets.top5_planningsrisicos
        : draft3.top5_planningsrisicos,
    top5_prijsverhogende_risicofactoren:
      Array.isArray(finaleSnippets.top5_prijsverhogende_risicofactoren) &&
      finaleSnippets.top5_prijsverhogende_risicofactoren.length > 0
        ? finaleSnippets.top5_prijsverhogende_risicofactoren
        : draft3.top5_prijsverhogende_risicofactoren,
    vragen_nvi:
      Array.isArray(finaleSnippets.vragen_nvi) && finaleSnippets.vragen_nvi.length > 0
        ? dedupeNvi([...draft3.vragen_nvi, ...finaleSnippets.vragen_nvi]).slice(0, MAX_NVI_VRAGEN)
        : draft3.vragen_nvi,
    leemtes:
      Array.isArray(finaleSnippets.leemtes) && finaleSnippets.leemtes.length > 0
        ? mergeLeemtes(draft3.leemtes, finaleSnippets.leemtes)
        : draft3.leemtes,
    tegenstrijdigheden:
      Array.isArray(finaleSnippets.tegenstrijdigheden) && finaleSnippets.tegenstrijdigheden.length > 0
        ? mergeTegenstrijdigheden(draft3.tegenstrijdigheden, finaleSnippets.tegenstrijdigheden)
        : draft3.tegenstrijdigheden,
    no_go_factoren:
      Array.isArray(finaleSnippets.no_go_factoren) && finaleSnippets.no_go_factoren.length > 0
        ? finaleSnippets.no_go_factoren
        : draft3.no_go_factoren,
    inschrijfstrategie:
      finaleSnippets.inschrijfstrategie ?? draft3.inschrijfstrategie,
    bewijs_en_aannameregel:
      finaleSnippets.bewijs_en_aannameregel ?? draft3.bewijs_en_aannameregel,
    document_leesplicht_bevestiging:
      finaleSnippets.document_leesplicht_bevestiging ?? draft3.document_leesplicht_bevestiging,
    locatie_en_omgevingsanalyse:
      finaleSnippets.locatie_en_omgevingsanalyse ?? draft3.locatie_en_omgevingsanalyse,
    algemene_tenderanalyse:
      finaleSnippets.algemene_tenderanalyse ?? draft3.algemene_tenderanalyse,
  }
}

/**
 * Zet het gatekeeper-resultaat op de draft; pas gatekeeper-correcties toe (NVI, strategie, integratievelden).
 */
export function attachGatekeeperToDraft(
  draft: RisicoAnalyseV2Result,
  gatekeeperOutput: {
    gatekeeper_resultaat: RisicoAnalyseV2Result['gatekeeper_resultaat']
    gecorrigeerde_integratie?: unknown
    gecorrigeerde_nvi?: unknown
    gecorrigeerde_strategie?: unknown
  },
): RisicoAnalyseV2Result {
  let updated: RisicoAnalyseV2Result = { ...draft, gatekeeper_resultaat: gatekeeperOutput.gatekeeper_resultaat }

  if (gatekeeperOutput.gecorrigeerde_strategie && typeof gatekeeperOutput.gecorrigeerde_strategie === 'object') {
    const partial = gatekeeperOutput.gecorrigeerde_strategie as Partial<RisicoAnalyseV2Result['inschrijfstrategie']>
    updated = {
      ...updated,
      inschrijfstrategie: { ...updated.inschrijfstrategie, ...partial },
    }
  }

  const patch = gatekeeperOutput.gecorrigeerde_integratie
  if (patch && typeof patch === 'object') {
    const p = patch as Record<string, unknown>
    if (Array.isArray(p.top5_risicos) && p.top5_risicos.length > 0) {
      updated = { ...updated, top5_risicos: p.top5_risicos as RisicoAnalyseV2Result['top5_risicos'] }
    }
    if (
      Array.isArray(p.top5_prijsverhogende_risicofactoren) &&
      p.top5_prijsverhogende_risicofactoren.length > 0
    ) {
      updated = {
        ...updated,
        top5_prijsverhogende_risicofactoren:
          p.top5_prijsverhogende_risicofactoren as RisicoAnalyseV2Result['top5_prijsverhogende_risicofactoren'],
      }
    }
    if (Array.isArray(p.top5_planningsrisicos) && p.top5_planningsrisicos.length > 0) {
      updated = {
        ...updated,
        top5_planningsrisicos: p.top5_planningsrisicos as RisicoAnalyseV2Result['top5_planningsrisicos'],
      }
    }
    if (Array.isArray(p.leemtes) && p.leemtes.length > 0) {
      updated = {
        ...updated,
        leemtes: (p.leemtes as RisicoAnalyseV2Result['leemtes']).slice(0, MAX_LEEMTES),
      }
    }
    if (Array.isArray(p.tegenstrijdigheden) && p.tegenstrijdigheden.length > 0) {
      updated = {
        ...updated,
        tegenstrijdigheden: (p.tegenstrijdigheden as RisicoAnalyseV2Result['tegenstrijdigheden']).slice(
          0,
          MAX_TEGENSTRIJDIGHEDEN,
        ),
      }
    }
    if (Array.isArray(p.no_go_factoren) && p.no_go_factoren.length > 0) {
      updated = { ...updated, no_go_factoren: p.no_go_factoren as RisicoAnalyseV2Result['no_go_factoren'] }
    }
    if (p.overall_score === 'Laag' || p.overall_score === 'Middel' || p.overall_score === 'Hoog') {
      updated = { ...updated, overall_score: p.overall_score }
    }
    if (typeof p.overall_toelichting === 'string' && p.overall_toelichting.trim()) {
      updated = { ...updated, overall_toelichting: p.overall_toelichting.trim() }
    }
  }

  if (gatekeeperOutput.gecorrigeerde_nvi && typeof gatekeeperOutput.gecorrigeerde_nvi === 'object') {
    const corNvi = (gatekeeperOutput.gecorrigeerde_nvi as { vragen_nvi?: NviVraag[] }).vragen_nvi
    if (Array.isArray(corNvi) && corNvi.length > 0) {
      updated = {
        ...updated,
        vragen_nvi: dedupeNvi([...draft.vragen_nvi, ...corNvi]).slice(0, MAX_NVI_VRAGEN),
      }
    }
  }

  return updated
}
