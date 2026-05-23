import log from 'electron-log'
import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson, RisicoAnalyseV2Result, RisicoScoreV2 } from '../../../shared/types-risico-v2'
import {
  buildIntegratieFallbackFromDraft,
  compactFeitenForIntegratie,
  compactStage2ForIntegratie,
} from './integratie-fallback'

function nlScore(s: unknown, fb: RisicoScoreV2 = 'Middel'): RisicoScoreV2 {
  if (s === 'Laag' || s === 'Middel' || s === 'Hoog') return s
  const t = String(s ?? '').toLowerCase()
  if (t.includes('hoog')) return 'Hoog'
  if (t.includes('laag')) return 'Laag'
  return fb
}

/** Maakt ruwe LLM-JSON bruikbaar; vult ontbrekende arrays/velden (defensief). */
export function coerceRisicoIntegratieResult(raw: unknown): RisicoIntegratieResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('RisicoIntegratie: verwacht JSON-object')
  }
  const o = raw as Record<string, unknown>

  const emptyTop5R = (): RisicoIntegratieResult['top5_risicos'] => []
  const mapTop5R = (arr: unknown): RisicoIntegratieResult['top5_risicos'] => {
    if (!Array.isArray(arr)) return emptyTop5R()
    return arr.map((x) => {
      const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      return {
        titel: String(r.titel ?? ''),
        ernstscore: nlScore(r.ernstscore),
        waarom_toprisico: String(r.waarom_toprisico ?? ''),
        bron: String(r.bron ?? ''),
        actie: String(r.actie ?? ''),
      }
    })
  }

  const mapTop5Prijs = (arr: unknown): RisicoIntegratieResult['top5_prijsverhogende_risicofactoren'] => {
    if (!Array.isArray(arr)) return []
    return arr.map((x) => {
      const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      return {
        factor: String(r.factor ?? ''),
        bron: String(r.bron ?? ''),
        status: String(r.status ?? r.status_van_onderbouwing ?? ''),
        mogelijke_prijsimpact: nlScore(r.mogelijke_prijsimpact),
        toelichting: String(r.toelichting ?? ''),
        verificatie: String(r.verificatie ?? ''),
      }
    })
  }

  const mapTop5Plan = (arr: unknown): RisicoIntegratieResult['top5_planningsrisicos'] => {
    if (!Array.isArray(arr)) return []
    return arr.map((x) => {
      const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      return {
        risico: String(r.risico ?? ''),
        bron: String(r.bron ?? ''),
        status_van_onderbouwing: String(r.status_van_onderbouwing ?? ''),
        mogelijke_planningsimpact: nlScore(r.mogelijke_planningsimpact),
        toelichting: String(r.toelichting ?? ''),
        actie: String(r.actie ?? ''),
      }
    })
  }

  const mapRegister = (arr: unknown): RisicoIntegratieResult['geintegreerd_risicoregister'] => {
    if (!Array.isArray(arr)) return []
    let n = 1
    return arr.map((x) => {
      const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      const num = typeof r.nummer === 'number' && Number.isFinite(r.nummer) ? r.nummer : n++
      return {
        nummer: num,
        titel: String(r.titel ?? 'Risico'),
        categorie: String(r.categorie ?? 'Overig'),
        ernstscore: nlScore(r.ernstscore),
        kans: nlScore(r.kans, nlScore(r.ernstscore)),
        impact: nlScore(r.impact, nlScore(r.ernstscore)),
        type: String(r.type ?? 'operationeel'),
        feit: String(r.feit ?? r.feat ?? ''),
        bron: String(r.bron ?? ''),
        status_van_onderbouwing: String(
          r.status_van_onderbouwing ?? 'niet vast te stellen op basis van de stukken',
        ),
        professionele_duiding: String(r.professionele_duiding ?? ''),
        juridische_duiding: String(r.juridische_duiding ?? ''),
        waarom_risico: String(r.waarom_risico ?? ''),
        mogelijke_prijsimpact: nlScore(r.mogelijke_prijsimpact, 'Middel'),
        mogelijke_planningsimpact: nlScore(r.mogelijke_planningsimpact, 'Middel'),
        actie: String(r.actie ?? ''),
        gekoppelde_nvi_vraag: String(r.gekoppelde_nvi_vraag ?? ''),
      }
    })
  }

  const mapNoGo = (arr: unknown): RisicoIntegratieResult['no_go_factoren'] => {
    if (!Array.isArray(arr)) return []
    return arr.map((x) => {
      const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      return {
        factor: String(r.factor ?? ''),
        bron: String(r.bron ?? ''),
        waarom_no_go: String(r.waarom_no_go ?? ''),
        kan_worden_opgelost_door: String(r.kan_worden_opgelost_door ?? ''),
      }
    })
  }

  const mapLeemtes = (arr: unknown): RisicoIntegratieResult['leemtes'] => {
    if (!Array.isArray(arr)) return []
    return arr.map((x) => {
      const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      return {
        ontbrekende_informatie: String(r.ontbrekende_informatie ?? ''),
        waarom_belangrijk: String(r.waarom_belangrijk ?? ''),
        risico_voor_inschrijver: String(r.risico_voor_inschrijver ?? ''),
        vraag_nvi: String(r.vraag_nvi ?? ''),
      }
    })
  }

  const mapTegen = (arr: unknown): RisicoIntegratieResult['tegenstrijdigheden'] => {
    if (!Array.isArray(arr)) return []
    return arr.map((x) => {
      const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      return {
        omschrijving: String(r.omschrijving ?? ''),
        document_1: String(r.document_1 ?? ''),
        document_2: String(r.document_2 ?? ''),
        risico: String(r.risico ?? ''),
        actie: String(r.actie ?? ''),
      }
    })
  }

  return {
    overall_score: nlScore(o.overall_score, 'Middel'),
    overall_toelichting: String(o.overall_toelichting ?? ''),
    top5_risicos: mapTop5R(o.top5_risicos),
    top5_prijsverhogende_risicofactoren: mapTop5Prijs(o.top5_prijsverhogende_risicofactoren),
    top5_planningsrisicos: mapTop5Plan(o.top5_planningsrisicos),
    geintegreerd_risicoregister: mapRegister(o.geintegreerd_risicoregister),
    no_go_factoren: mapNoGo(o.no_go_factoren),
    leemtes: mapLeemtes(o.leemtes),
    tegenstrijdigheden: mapTegen(o.tegenstrijdigheden),
  }
}

const SYSTEM = `Je bent de Risico-integratie Agent.

Bundel alle risico's van de gespecialiseerde agents tot één geïntegreerd risicoregister.

Taken:
- combineer overlappende risico's;
- verwijder doublures;
- behoud bronverwijzingen;
- harmoniseer kans, impact en ernstscore;
- benoem top 5 zwaarste risico's;
- benoem top 5 prijsverhogende risicofactoren;
- benoem top 5 planningsrisico's;
- benoem no-go-factoren;
- benoem leemtes;
- benoem tegenstrijdigheden.

Gebruik geen nieuwe aannames. Voeg geen nieuwe risico's toe tenzij ze rechtstreeks volgen uit de output van de agents.

BELANGRIJK: Gebruik UITSLUITEND de onderstaande Nederlandse veldnamen. Gebruik NOOIT Engelse veldnamen.

Geef je antwoord als JSON met exact dit schema (alle namen in het Nederlands):
{
  "overall_score": "Laag"|"Middel"|"Hoog",
  "overall_toelichting": "...",
  "top5_risicos": [{"titel":"...","ernstscore":"Hoog","waarom_toprisico":"...","bron":"...","actie":"..."}],
  "top5_prijsverhogende_risicofactoren": [{"factor":"...","bron":"...","status":"...","mogelijke_prijsimpact":"Hoog","toelichting":"...","verificatie":"..."}],
  "top5_planningsrisicos": [{"risico":"...","bron":"...","status_van_onderbouwing":"...","mogelijke_planningsimpact":"Hoog","toelichting":"...","actie":"..."}],
  "geintegreerd_risicoregister": [{"nummer":1,"titel":"...","categorie":"...","ernstscore":"Hoog","kans":"Hoog","impact":"Hoog","type":"...","feit":"...","bron":"...","status_van_onderbouwing":"...","professionele_duiding":"...","juridische_duiding":"...","waarom_risico":"...","mogelijke_prijsimpact":"Middel","mogelijke_planningsimpact":"Middel","actie":"...","gekoppelde_nvi_vraag":"..."}],
  "no_go_factoren": [{"factor":"...","bron":"...","waarom_no_go":"...","kan_worden_opgelost_door":"..."}],
  "leemtes": [{"ontbrekende_informatie":"...","waarom_belangrijk":"...","risico_voor_inschrijver":"...","vraag_nvi":"..."}],
  "tegenstrijdigheden": [{"omschrijving":"...","document_1":"...","document_2":"...","risico":"...","actie":"..."}]
}

Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface RisicoIntegratieResult {
  overall_score: 'Laag' | 'Middel' | 'Hoog'
  overall_toelichting: string
  top5_risicos: Array<{
    titel: string
    ernstscore: 'Laag' | 'Middel' | 'Hoog'
    waarom_toprisico: string
    bron: string
    actie: string
  }>
  top5_prijsverhogende_risicofactoren: Array<{
    factor: string
    bron: string
    status: string
    mogelijke_prijsimpact: 'Laag' | 'Middel' | 'Hoog'
    toelichting: string
    verificatie: string
  }>
  top5_planningsrisicos: Array<{
    risico: string
    bron: string
    status_van_onderbouwing: string
    mogelijke_planningsimpact: 'Laag' | 'Middel' | 'Hoog'
    toelichting: string
    actie: string
  }>
  geintegreerd_risicoregister: Array<{
    nummer: number
    titel: string
    categorie: string
    ernstscore: 'Laag' | 'Middel' | 'Hoog'
    kans: 'Laag' | 'Middel' | 'Hoog'
    impact: 'Laag' | 'Middel' | 'Hoog'
    type: string
    feit: string
    bron: string
    status_van_onderbouwing: string
    professionele_duiding: string
    juridische_duiding: string
    waarom_risico: string
    mogelijke_prijsimpact: 'Laag' | 'Middel' | 'Hoog'
    mogelijke_planningsimpact: 'Laag' | 'Middel' | 'Hoog'
    actie: string
    gekoppelde_nvi_vraag: string
  }>
  no_go_factoren: Array<{
    factor: string
    bron: string
    waarom_no_go: string
    kan_worden_opgelost_door: string
  }>
  leemtes: Array<{
    ontbrekende_informatie: string
    waarom_belangrijk: string
    risico_voor_inschrijver: string
    vraag_nvi: string
  }>
  tegenstrijdigheden: Array<{
    omschrijving: string
    document_1: string
    document_2: string
    risico: string
    actie: string
  }>
}

export async function runRisicoIntegratieAgent(
  chatFn: RisicoChatFn,
  feiten: FeitenJson,
  stage2Results: Record<string, unknown>,
  fallbackDraft: RisicoAnalyseV2Result,
): Promise<RisicoIntegratieResult> {
  const feitenJson = JSON.stringify(compactFeitenForIntegratie(feiten))
  const stage2Json = JSON.stringify(compactStage2ForIntegratie(stage2Results))

  try {
    const raw = await chatFn(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Hieronder staan de feitenbasis en de output van alle 11 domeinagenten. Integreer alle risico's tot één geharmoniseerd risicoregister en geef het resultaat als JSON.

## Feitenbasis
${feitenJson}

## Alle domeinrisico's
${stage2Json}`,
        },
      ],
      { phase: 'merge' },
    )
    const parsed = parseAgentJson<unknown>(raw, 'RisicoIntegratie')
    return coerceRisicoIntegratieResult(parsed)
  } catch (e) {
    log.warn(
      '[risico-integratie] LLM-integratie mislukt — gebruik deterministische fallback (stage 2 + feiten):',
      e instanceof Error ? e.message : e,
    )
    return buildIntegratieFallbackFromDraft(fallbackDraft, feiten)
  }
}
