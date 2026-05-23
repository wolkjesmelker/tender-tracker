/**
 * Risico-Orchestrator V2 — coördineert de 4-stage agentic pipeline.
 *
 * Na elke stage wordt een `assembledDraft` deterministisch opgebouwd en opgeslagen
 * in het checkpoint. De eindrapportage-agent hoeft daardoor alleen narratieve
 * tekstvelden te verfijnen (management_samenvatting, overall_toelichting) — alle
 * structurele data komt altijd uit de agents zelf.
 *
 * Stage 0  (conditioneel): Document-manifest + chunked stage 1 als tekst > limiet
 * Stage 1a (parallel):     Document Intake + Tenderanalyse
 * Stage 1b (parallel/serial): Feitenextractie — per chunk parallel, dan merge
 * Stage 2  (parallel, concurrency=4): 11 domeinagenten ontvangen feiten.json
 * Stage 3  (parallel): Inschrijfstrategie + NVI-vragen + Risico-integratie
 * Stage 4  (serial): Gatekeeper op assembledDraft → Eindrapportage (narratief)
 */

import log from 'electron-log'
import type { RisicoChatFn, RisicoProgressReporter } from './risico-analysis'
import type { RisicoAnalyseV2Result } from '../../shared/types-risico-v2'
import { runBatchedParallel } from '../utils/llm-chunk-concurrency'

import { runDocumentIntakeAgent } from './risico-agents/stage1-document-intake'
import { runTenderAnalyseAgent } from './risico-agents/stage1-tenderanalyse'
import { runFeitenExtractieAgent } from './risico-agents/stage1-feitenextractie'

import { runJuridischAgent } from './risico-agents/stage2-juridisch'
import { runProcedureAgent } from './risico-agents/stage2-procedure'
import { runContractRisicoAgent } from './risico-agents/stage2-contract'
import { runScopeEisenAgent } from './risico-agents/stage2-scope'
import { runHoeveelhedenAgent } from './risico-agents/stage2-hoeveelheden'
import { runUitvoeringsAgent } from './risico-agents/stage2-uitvoering'
import { runLocatieOmgevingAgent } from './risico-agents/stage2-locatie'
import { runBodemAgent } from './risico-agents/stage2-bodem'
import { runVerkeerAgent } from './risico-agents/stage2-verkeer'
import { runPlanningAgent } from './risico-agents/stage2-planning'
import { runFinancieelAgent } from './risico-agents/stage2-financieel'

import { runInschrijfstrategieAgent } from './risico-agents/stage3-inschrijfstrategie'
import { runNviVragenAgent } from './risico-agents/stage3-nvi-vragen'
import { runRisicoIntegratieAgent } from './risico-agents/stage3-risico-integratie'

import { runGatekeeperAgent } from './risico-agents/stage4-gatekeeper'
import { runEindrapportageAgent } from './risico-agents/stage4-eindrapportage'

import type { FeitenJson, RisicoScoreV2 } from '../../shared/types-risico-v2'
import {
  CHUNK_MAX_CHARS,
  splitDocumentChunks,
  extractDocumentManifest,
  mergeFeitenJsonResults,
  mergeDocumentIntakeResults,
  mergeTenderAnalyseResults,
} from './risico-agents/chunk-utils'
import type { RisicoV2Checkpoint } from './risico-agents/checkpoint-utils'
import {
  assembleDraftStage1a,
  assembleDraftStage1b,
  assembleDraftStage2,
  assembleDraftStage3,
  assembleDraftPreFinal,
  attachGatekeeperToDraft,
} from './risico-agents/riscov2-draft-assembler'
import { enrichParsedEindrapport } from './risico-agents/eindrapportage-enrichment'

const SCORE_RANK: Record<RisicoScoreV2, number> = { Laag: 1, Middel: 2, Hoog: 3 }

function isRisicoScoreV2(s: unknown): s is RisicoScoreV2 {
  return s === 'Laag' || s === 'Middel' || s === 'Hoog'
}

function maxRisicoScore(scores: RisicoScoreV2[]): RisicoScoreV2 {
  return scores.reduce((b, x) => (SCORE_RANK[x] > SCORE_RANK[b] ? x : b), scores[0] ?? 'Middel')
}

const STAGE2_CONCURRENCY = 4
const FEITENEXTRACTIE_CONCURRENCY = 5

export async function runRisicoOrchestratorV2(
  chatFn: RisicoChatFn,
  documentTexts: string,
  onProgress?: RisicoProgressReporter,
  chunkMaxChars?: number,
  checkpoint?: RisicoV2Checkpoint | null,
  onCheckpointSave?: (cp: RisicoV2Checkpoint) => void,
): Promise<RisicoAnalyseV2Result> {
  const report = (step: string, pct: number) => {
    log.info(`[RisicoV2] ${step} (${pct}%)`)
    onProgress?.(step, pct)
  }

  const effectiveChunkMax = chunkMaxChars ?? CHUNK_MAX_CHARS
  const chunks = splitDocumentChunks(documentTexts, effectiveChunkMax)
  const isChunked = chunks.length > 1

  if (isChunked) {
    log.info(
      `[RisicoV2] Documenten te groot voor één call — opgesplitst in ${chunks.length} delen ` +
      `(totaal ${Math.round(documentTexts.length / 1000)}K tekens, max ${Math.round(effectiveChunkMax / 1000)}K/chunk)`,
    )
  }

  const manifest = isChunked ? extractDocumentManifest(documentTexts) : ''

  function buildChunkInput(chunk: string, chunkIdx: number): string {
    if (!isChunked) return chunk
    return (
      `[DOCUMENT OVERZICHT — ${chunks.length} documenten aanwezig]\n` +
      `${manifest}\n\n` +
      `[INHOUD DEEL ${chunkIdx + 1}/${chunks.length}]\n` +
      chunk
    )
  }

  // ── Checkpoint helper ────────────────────────────────────────────────────
  let currentCheckpoint: RisicoV2Checkpoint = checkpoint ?? { aanbestedingId: '', savedAt: '' }

  function saveCheckpoint(
    update: Partial<RisicoV2Checkpoint>,
    draft?: RisicoAnalyseV2Result,
    stage?: RisicoV2Checkpoint['assembledDraftStage'],
  ): void {
    currentCheckpoint = {
      ...currentCheckpoint,
      ...update,
      savedAt: new Date().toISOString(),
      ...(draft
        ? {
            assembledDraft: draft,
            assembledDraftStage: stage,
            assembledDraftSavedAt: new Date().toISOString(),
          }
        : {}),
    }
    onCheckpointSave?.(currentCheckpoint)
  }

  // ── Stage 1a: DocumentIntake + TenderAnalyse ─────────────────────────────
  const stage1aIntakeInput = isChunked ? manifest : chunks[0]
  const stage1aTenderInput = buildChunkInput(chunks[0], 0)

  let intakeResult: Awaited<ReturnType<typeof runDocumentIntakeAgent>>
  let tenderResult: Awaited<ReturnType<typeof runTenderAnalyseAgent>>

  if (checkpoint?.stage1a) {
    report('Stage 1a/4: Documenten inlezen (hersteld uit checkpoint)…', 5)
    log.info('[RisicoV2] Stage 1a: hersteld uit checkpoint')
    intakeResult = checkpoint.stage1a.intakeResult
    tenderResult = checkpoint.stage1a.tenderResult
  } else {
    if (isChunked) {
      report(
        `Stage 1a/4: Documenten inlezen (manifest ${Math.round(manifest.length / 1000)}K + tender chunk 1/${chunks.length})…`,
        5,
      )
    } else {
      report('Stage 1a/4: Documenten inlezen (parallel)…', 5)
    }
    ;[intakeResult, tenderResult] = await Promise.all([
      runDocumentIntakeAgent(chatFn, stage1aIntakeInput),
      runTenderAnalyseAgent(chatFn, stage1aTenderInput),
    ])
    const draft1a = assembleDraftStage1a(intakeResult, tenderResult)
    saveCheckpoint({ stage1a: { intakeResult, tenderResult } }, draft1a, '1a')
  }
  report('Stage 1a/4: Documenten ingelezen', 10)

  // ── Stage 1b: Feitenextractie ─────────────────────────────────────────────
  let feiten: FeitenJson

  if (checkpoint?.stage1b) {
    report('Stage 1b/4: Feitenbasis hersteld uit checkpoint', 20)
    log.info('[RisicoV2] Stage 1b: hersteld uit checkpoint')
    feiten = checkpoint.stage1b.feiten
  } else if (!isChunked) {
    report('Stage 1b/4: Feitenextractie (kennisbrug)…', 12)
    feiten = await runFeitenExtractieAgent(chatFn, documentTexts, intakeResult, tenderResult)
    const draft1b = assembleDraftStage1b(
      currentCheckpoint.assembledDraft ?? assembleDraftStage1a(intakeResult, tenderResult),
      feiten,
    )
    saveCheckpoint({ stage1b: { feiten } }, draft1b, '1b')
    report('Stage 1b/4: Feitenbasis gereed', 20)
  } else {
    const compactIntake = {
      document_inventarisatie: (intakeResult.document_inventarisatie ?? []).map((d) => ({
        naam: d.naam, type: d.type, rol: d.rol, leidend_document: d.leidend_document,
      })),
      ontbrekende_documenten: intakeResult.ontbrekende_documenten ?? [],
    }
    const compactTender = {
      algemene_tenderanalyse: {
        aanbestedende_dienst: tenderResult.algemene_tenderanalyse?.aanbestedende_dienst,
        procedure: tenderResult.algemene_tenderanalyse?.procedure,
        opdrachtomschrijving: tenderResult.algemene_tenderanalyse?.opdrachtomschrijving,
        contractvorm: tenderResult.algemene_tenderanalyse?.contractvorm,
      },
    }

    report(`Stage 1b/4: Feitenextractie (${chunks.length} delen, max ${FEITENEXTRACTIE_CONCURRENCY} parallel)…`, 12)

    let completedFeiten = 0
    const feitenResults = await runBatchedParallel(
      chunks,
      FEITENEXTRACTIE_CONCURRENCY,
      async (chunk, i) => {
        const chunkInput = buildChunkInput(chunk, i)
        const result = await runFeitenExtractieAgent(
          chatFn, chunkInput,
          compactIntake as typeof intakeResult,
          compactTender as typeof tenderResult,
        )
        completedFeiten++
        report(
          `Stage 1b/4: Feitenextractie deel ${completedFeiten}/${chunks.length} gereed…`,
          12 + Math.round((completedFeiten / chunks.length) * 8),
        )
        return result
      },
    )

    feiten = mergeFeitenJsonResults(feitenResults)
    log.info(
      `[RisicoV2] Feitenextractie samengevoegd: ${feiten.feiten.length} feiten, ` +
      `${feiten.ontbrekende_kerninformatie.length} ontbrekend, ` +
      `${feiten.conflicterende_feiten.length} conflicten`,
    )
    const draft1b = assembleDraftStage1b(
      currentCheckpoint.assembledDraft ?? assembleDraftStage1a(intakeResult, tenderResult),
      feiten,
    )
    saveCheckpoint({ stage1b: { feiten } }, draft1b, '1b')
    report('Stage 1b/4: Feitenbasis gereed (alle delen samengevoegd)', 20)
  }

  // ── Stage 2: 11 domeinagenten ────────────────────────────────────────────
  type Stage2AgentFn = (chatFn: RisicoChatFn, feiten: FeitenJson) => Promise<unknown>

  const stage2Agents: Array<{ name: string; fn: Stage2AgentFn }> = [
    { name: 'Juridisch', fn: runJuridischAgent },
    { name: 'Procedure', fn: runProcedureAgent },
    { name: 'Contract', fn: runContractRisicoAgent },
    { name: 'Scope & Eisen', fn: runScopeEisenAgent },
    { name: 'Hoeveelheden', fn: runHoeveelhedenAgent },
    { name: 'Uitvoering', fn: runUitvoeringsAgent },
    { name: 'Locatie & Omgeving', fn: runLocatieOmgevingAgent },
    { name: 'Bodem & Grondwater', fn: runBodemAgent },
    { name: 'Verkeer & BLVC', fn: runVerkeerAgent },
    { name: 'Planning & Fasering', fn: runPlanningAgent },
    { name: 'Financieel', fn: runFinancieelAgent },
  ]

  let stage2Combined: Record<string, unknown>

  if (checkpoint?.stage2) {
    report('Stage 2/4: Domeinanalyse hersteld uit checkpoint (11/11)', 65)
    log.info('[RisicoV2] Stage 2: hersteld uit checkpoint')
    stage2Combined = checkpoint.stage2.stage2Combined
  } else {
    let completedCount = 0
    const stage2Results = await runBatchedParallel(
      stage2Agents,
      STAGE2_CONCURRENCY,
      async (agent, _i) => {
        const result = await agent.fn(chatFn, feiten)
        completedCount++
        report(
          `Stage 2/4: Domeinanalyse [${completedCount}/${stage2Agents.length}] — ${agent.name}…`,
          20 + Math.round((completedCount / stage2Agents.length) * 45),
        )
        return result
      },
    )

    stage2Combined = {}
    for (let i = 0; i < stage2Agents.length; i++) {
      Object.assign(stage2Combined, stage2Results[i] as Record<string, unknown>)
    }

    const draft2 = assembleDraftStage2(
      currentCheckpoint.assembledDraft ?? assembleDraftStage1b(
        assembleDraftStage1a(intakeResult, tenderResult),
        feiten,
      ),
      stage2Combined,
    )
    log.info(`[RisicoV2] Stage2 draft: ${draft2.risicogebieden.length} gebieden, ${draft2.risicogebieden.flatMap(g => g.risicos).length} risico's`)
    saveCheckpoint({ stage2: { stage2Combined } }, draft2, '2')
  }

  // ── Stage 3: parallel synthese ───────────────────────────────────────────
  let strategie: Awaited<ReturnType<typeof runInschrijfstrategieAgent>>
  let nvi: Awaited<ReturnType<typeof runNviVragenAgent>>
  let integratie: Awaited<ReturnType<typeof runRisicoIntegratieAgent>>

  if (checkpoint?.stage3) {
    report('Stage 3/4: Synthese hersteld uit checkpoint', 80)
    log.info('[RisicoV2] Stage 3: hersteld uit checkpoint')
    strategie = checkpoint.stage3.strategie
    nvi = checkpoint.stage3.nvi
    integratie = checkpoint.stage3.integratie
  } else {
    report('Stage 3/4: Synthese (parallel)…', 65)
    ;[strategie, nvi, integratie] = await Promise.all([
      runInschrijfstrategieAgent(chatFn, feiten, stage2Combined),
      runNviVragenAgent(chatFn, feiten, stage2Combined),
      runRisicoIntegratieAgent(
        chatFn,
        feiten,
        stage2Combined,
        assembleDraftStage2(
          currentCheckpoint.assembledDraft ?? assembleDraftStage1b(
            assembleDraftStage1a(intakeResult, tenderResult),
            feiten,
          ),
          stage2Combined,
        ),
      ),
    ])

    const baseDraft2 = currentCheckpoint.assembledDraft ?? assembleDraftStage2(
      assembleDraftStage1b(assembleDraftStage1a(intakeResult, tenderResult), feiten),
      stage2Combined,
    )
    const draft3 = assembleDraftStage3(baseDraft2, integratie, nvi, strategie, feiten)
    log.info(
      `[RisicoV2] Stage3 draft: ${draft3.risicogebieden.length} gebieden, ` +
      `${draft3.vragen_nvi.length} NVI, ${draft3.leemtes.length} leemtes, ` +
      `${draft3.tegenstrijdigheden.length} tegenstrijdigheden`,
    )
    saveCheckpoint({ stage3: { strategie, nvi, integratie } }, draft3, '3')
    report('Stage 3/4: Synthese gereed', 80)
  }

  // Zorg dat we altijd een actuele stage3-draft hebben (ook bij checkpoint-herstel)
  if (!currentCheckpoint.assembledDraft || currentCheckpoint.assembledDraftStage === '2' || currentCheckpoint.assembledDraftStage === '1b' || currentCheckpoint.assembledDraftStage === '1a') {
    const baseDraft = assembleDraftStage2(
      assembleDraftStage1b(assembleDraftStage1a(intakeResult, tenderResult), feiten),
      stage2Combined,
    )
    const draft3 = assembleDraftStage3(baseDraft, integratie, nvi, strategie, feiten)
    saveCheckpoint({}, draft3, '3')
  }

  // ── Stage 4a: Gatekeeper validatie ───────────────────────────────────────
  let gatekeeperOutput: Awaited<ReturnType<typeof runGatekeeperAgent>>

  if (checkpoint?.stage4a) {
    report('Stage 4a/4: Gatekeeper hersteld uit checkpoint', 90)
    log.info('[RisicoV2] Stage 4a: hersteld uit checkpoint')
    gatekeeperOutput = checkpoint.stage4a.gatekeeperOutput
  } else {
    report('Stage 4a/4: Gatekeeper validatie…', 82)
    // Gatekeeper krijgt de assembledDraft als primaire input — valideert wat de user ziet
    const draftVoorGatekeeper = currentCheckpoint.assembledDraft!
    gatekeeperOutput = await runGatekeeperAgent(chatFn, {
      intakeResult, tenderResult, feiten,
      stage2Results: stage2Combined, strategie, nvi, integratie,
      assembledDraft: draftVoorGatekeeper,
    })
    saveCheckpoint({ stage4a: { gatekeeperOutput } })
    report('Stage 4a/4: Gatekeeper gereed', 90)
  }

  // ── Stage 4b: Eindrapportage (narratieve afronding) ──────────────────────
  report('Stage 4b/4: Eindrapportage (narratieve afronding)…', 92)
  const draftVoorFinale = currentCheckpoint.assembledDraft!

  const eindrapportRaw = await runEindrapportageAgent(chatFn, {
    intakeResult, tenderResult, feiten,
    stage2Results: stage2Combined, strategie, nvi, integratie, gatekeeperOutput,
    assembledDraft: draftVoorFinale,
  })

  // Merge: narratieve snippets over de draft leggen
  const preFinalDraft = assembleDraftPreFinal(draftVoorFinale, eindrapportRaw)
  // Gatekeeper-resultaat toevoegen
  const withGatekeeper = attachGatekeeperToDraft(preFinalDraft, gatekeeperOutput)

  // Safety-net enrichment (puur defensief — data mag nooit verloren gaan)
  const eindrapport = enrichParsedEindrapport(withGatekeeper, tenderResult, integratie, nvi, stage2Combined)

  let overallFix: RisicoScoreV2 = isRisicoScoreV2(eindrapport.overall_score)
    ? eindrapport.overall_score
    : 'Middel'
  if (!isRisicoScoreV2(eindrapport.overall_score)) {
    const gebScores = (eindrapport.risicogebieden ?? []).map((g) => g.score).filter(isRisicoScoreV2)
    if (gebScores.length > 0) overallFix = maxRisicoScore(gebScores)
  }

  report('Stage 4b/4: Eindrapportage gereed', 100)
  log.info(
    `[RisicoV2] Voltooid: overall=${overallFix}, ` +
    `gebieden=${eindrapport.risicogebieden?.length ?? 0}, ` +
    `risicos=${eindrapport.risicogebieden?.flatMap(g => g.risicos).length ?? 0}, ` +
    `NVI=${eindrapport.vragen_nvi?.length ?? 0}`,
  )

  return { ...eindrapport, overall_score: overallFix }
}
