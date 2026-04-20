import { aiService } from './ai-service'
import { parseAnalysisJsonResponse } from './parse-ai-json'
import {
  buildTenderBijlageContext,
  extractBijlageNamenFromDocumentTexts,
  extractBijlageHeaderFromSlice,
  normalizeBijlageNameKey,
  MAX_BIJLAGE_CHARS_IN_MAIN_PROMPT,
} from './bijlage-context'
import {
  extractTenderNedPublicatieId,
  fetchBronPaginaDetails,
  downloadAndExtractText,
  findBestLocalStoredFileName,
  readLocalDocumentAndExtractText,
  getSessionPartitionForBronUrl,
  isSkippableOffsiteDocumentUrl,
  resolveCanonicalBronUrlForAnalysis,
  type DocumentInfo,
} from '../scraping/document-fetcher'
import { expandZipEntriesInDocumentList } from '../scraping/zip-document-expand'
import { isAwardedTenderNotice } from '../scraping/scrape-qualification'
import {
  attachLinksToTimeline,
  buildMinimalProcedureContext,
  mergeProcedurePortals,
} from '../scraping/procedure-context'
import type { BronNavigatieLink, TenderProcedureContext } from '../../shared/types'
import { omitZipDownloadsWhenPartsAlreadyInList } from '../../shared/document-entry'
import {
  buildNavigatieLinksFromText,
  extractSupplementaryDocumentsFromText,
  mergeDocumentInfoLists,
  mergeNavigatieLinkRows,
  type BronNavigatieLinkRow,
} from '../utils/bron-inventory'
import { resolveTenderDocumentFile } from '../utils/paths'
import { getDb } from '../db/connection'
import { acquireBusyWorkBlocker, releaseBusyWorkBlocker } from '../utils/busy-work-blocker'
import { LLM_CHUNK_EXTRACTION_CONCURRENCY } from '../utils/llm-chunk-concurrency'
import type { AnalysisResult, AiExtractedTenderFields, BijlageAnalyse } from '../../shared/types'
import log from 'electron-log'
import { analysisControlPoll, analysisControlClearFlags } from './analysis-control'
import {
  saveAnalysisCheckpoint,
  loadAnalysisCheckpoint,
  clearAnalysisCheckpoint,
  buildAnalysisConfigFingerprint,
  type AnalysisDocRef,
  type AnalysisCheckpointV2,
  type NormalizedCriterionDetailJson,
} from './analysis-checkpoint'
interface ProgressCallback {
  (progress: { step: string; percentage: number; agent?: string }): void
}

type ReportFn = (step: string, percentage: number, mode: 'app' | 'llm') => void

/** Tijdens de LLM API-call geen native voortgang; periodiek rapporteren zodat de UI niet «hangt». */
function withLlmWaitHeartbeats(report: ReportFn, runChat: () => Promise<string>): Promise<string> {
  const t0 = Date.now()
  const tick = () => {
    const sec = Math.floor((Date.now() - t0) / 1000)
    const bump = Math.min(14, Math.floor(sec / 50))
    report(
      `Wachten op modelantwoord… ${sec}s (veel documenten: enkele minuten is normaal; app blijft actief)`,
      41 + bump,
      'llm'
    )
  }
  const first = setTimeout(tick, 8_000)
  const iv = setInterval(tick, 15_000)
  return runChat().finally(() => {
    clearTimeout(first)
    clearInterval(iv)
  })
}

/**
 * Tijdens parallelle LLM-calls (bijv. Promise.all) zijn er geen tussentijdse pipeline-stappen.
 * Periodieke updates voorkomen dat de UI lang op hetzelfde percentage blijft staan.
 */
function runWithPeriodicLlmProgress(
  report: ReportFn,
  basePercentage: number,
  capPercentage: number,
  makeStep: (elapsedSec: number) => string,
  run: () => Promise<void>,
): Promise<void> {
  const t0 = Date.now()
  const tick = () => {
    const sec = Math.floor((Date.now() - t0) / 1000)
    const span = Math.max(1, capPercentage - basePercentage)
    const bump = Math.min(span, Math.floor(sec / 25))
    report(makeStep(sec), Math.min(capPercentage, basePercentage + bump), 'llm')
  }
  const first = setTimeout(tick, 8_000)
  const iv = setInterval(tick, 15_000)
  return run().finally(() => {
    clearTimeout(first)
    clearInterval(iv)
  })
}

export type RunAnalysisOutcome =
  | AnalysisResult
  | { outcome: 'paused' }
  | { outcome: 'stopped' }

function normDocRef(doc: DocumentInfo, fallbackNaam: string): AnalysisDocRef {
  return {
    url: String(doc.url || ''),
    naam: String(doc.naam || fallbackNaam),
    type: String(doc.type || ''),
    localNaam: doc.localNaam?.trim() || undefined,
    bronZipLabel: doc.bronZipLabel,
  }
}

const MIN_LOCAL_DOC_BYTES = 100

function parseDocumentInfosFromTender(tender: any): DocumentInfo[] {
  try {
    const raw = tender.document_urls
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .map((d: any) => ({
        url: String(d.url || ''),
        localNaam: d.localNaam ? String(d.localNaam) : undefined,
        naam: String(d.naam || ''),
        type: String(d.type || ''),
        bronZipLabel: d.bronZipLabel ? String(d.bronZipLabel) : undefined,
      }))
      .filter((d: DocumentInfo) => Boolean(d.url?.trim() || d.localNaam?.trim()))
  } catch {
    return []
  }
}

/** Alle relevante bijlagen staan op schijf — geen `fetchBronPaginaDetails` / tab-scrape. */
function canSkipBronFetchForAnalysis(tenderId: string, tender: any): boolean {
  const merged = omitZipDownloadsWhenPartsAlreadyInList(parseDocumentInfosFromTender(tender))
  if (merged.length === 0) return false
  for (const doc of merged) {
    if (!doc.url?.trim() && !doc.localNaam?.trim()) continue
    if (doc.url?.trim() && isSkippableOffsiteDocumentUrl(doc.url)) continue
    const pick = findBestLocalStoredFileName(String(tenderId), doc.naam || '', doc.localNaam?.trim())
    if (!pick) return false
    const resolved = resolveTenderDocumentFile(String(tenderId), pick)
    if (!resolved || resolved.size <= MIN_LOCAL_DOC_BYTES) return false
  }
  return true
}

function handlePoll(tenderId: string, saver: () => void): 'pause' | 'stop' | null {
  const p = analysisControlPoll(tenderId)
  if (p === 'stop') {
    clearAnalysisCheckpoint(tenderId)
    analysisControlClearFlags()
    return 'stop'
  }
  if (p === 'pause') {
    saver()
    analysisControlClearFlags()
    return 'pause'
  }
  return null
}

export function isAnalysisPaused(outcome: RunAnalysisOutcome): outcome is { outcome: 'paused' } {
  return typeof outcome === 'object' && outcome !== null && 'outcome' in outcome && (outcome as any).outcome === 'paused'
}

export function isAnalysisStopped(outcome: RunAnalysisOutcome): outcome is { outcome: 'stopped' } {
  return typeof outcome === 'object' && outcome !== null && 'outcome' in outcome && (outcome as any).outcome === 'stopped'
}

/** Drempel (tekens documenttekst) waarboven criteria in afzonderlijke passes worden geanalyseerd. */
const DOCS_CHUNK_THRESHOLD = 270_000
/** Maximaal tekens documenttekst per criteria-chunk. */
const DOCS_CHUNK_CHARS = 200_000

/** Max. tekens bijlage-inhoud per aparte per-bijlage LLM-call (één bestand tegelijk). */
const MAX_CHARS_PER_BIJLAGE_LLM = 120_000

export async function runAnalysis(
  tender: any,
  questions: any[],
  criteria: any[],
  prompts: any[],
  settings: Record<string, string>,
  onProgress: ProgressCallback,
  options?: { resume?: boolean }
): Promise<RunAnalysisOutcome> {
  acquireBusyWorkBlocker('ai-analysis')
  /** Gezet zodra persist-debounce bestaat; voorkomt ReferenceError in `finally` bij vroege throw. */
  let flushDebouncedCkSafe: () => void = () => {}
  try {
  aiService.configure(settings)
  const agentApp = 'App · bron & documenten'
  const agentLlm = aiService.getConfiguredAgentLabel()
  const report = (step: string, percentage: number, mode: 'app' | 'llm') => {
    onProgress({ step, percentage, agent: mode === 'app' ? agentApp : agentLlm })
  }

  const isAvailable = await aiService.isAvailable()
  if (!isAvailable) {
    throw new Error('AI service is niet beschikbaar. Controleer je API-sleutel en instellingen.')
  }

  const ck0 = options?.resume ? loadAnalysisCheckpoint(tender.id) : null
  if (options?.resume && !ck0) {
    throw new Error('Geen opgeslagen gepauzeerde analyse voor deze aanbesteding.')
  }

  const agentPrompt = prompts.find(p => p.type === 'agent')?.prompt_tekst || ''
  const scorerPrompt = prompts.find(p => p.type === 'scorer')?.prompt_tekst || ''

  const configFingerprint = buildAnalysisConfigFingerprint({
    questionIds: questions.map((q: any) => String(q.id)),
    criterionIds: criteria.map((c: any) => String(c.id)),
    promptSignatures: prompts.map((p: any) => `${String(p.type)}:${String(p.id)}`),
  })

  let documentTexts: string[] = []
  let detailText = ''
  let resolvedBronUrl = tender.bron_url
    ? resolveCanonicalBronUrlForAnalysis(String(tender.bron_url))
    : ''
  let sessionPartition: string | undefined
  let bronAllDocs: AnalysisDocRef[] = []
  let bronNextIndex = 0
  let dbAllDocs: AnalysisDocRef[] = []
  let dbNextIndex = 0
  let stage: 'bron_docs' | 'db_docs' | 'ai' = 'bron_docs'

  if (ck0) {
    detailText = ck0.detailText
    documentTexts = [...ck0.documentTexts]
    resolvedBronUrl = ck0.resolvedBronUrl
    sessionPartition = ck0.sessionPartition
    bronAllDocs = ck0.bronAllDocs || []
    bronNextIndex = ck0.bronNextIndex ?? 0
    dbAllDocs = ck0.dbAllDocs || []
    dbNextIndex = ck0.dbNextIndex ?? 0
    stage = ck0.stage
    report('Hervatten van gepauzeerde analyse…', 2, 'app')
  }

  const ckAi: {
    configFingerprint: string
    aiPhase: AnalysisCheckpointV2['aiPhase']
    criteriaChunking: AnalysisCheckpointV2['criteriaChunking']
  } = {
    configFingerprint,
    aiPhase: null,
    criteriaChunking: null,
  }
  if (ck0) {
    if (ck0.configFingerprint && ck0.configFingerprint !== configFingerprint) {
      log.warn(
        '[analysis] Checkpoint hoort bij andere criteria/vragen/prompts — hervatten kan inconsistente scores geven.',
      )
    }
    ckAi.aiPhase = ck0.aiPhase
    ckAi.criteriaChunking = ck0.criteriaChunking
      ? {
          totalChunks: ck0.criteriaChunking.totalChunks,
          completedChunkIndices: [...ck0.criteriaChunking.completedChunkIndices],
          preComputedCriteria: { ...ck0.criteriaChunking.preComputedCriteria },
        }
      : null
  }

  let debTimer: ReturnType<typeof setTimeout> | null = null
  let debPayload: AnalysisCheckpointV2 | null = null
  function flushDebouncedCk() {
    if (debTimer) {
      clearTimeout(debTimer)
      debTimer = null
    }
    if (debPayload) {
      saveAnalysisCheckpoint(tender.id, debPayload)
      debPayload = null
    }
  }
  flushDebouncedCkSafe = flushDebouncedCk
  function persistCk(
    base: {
      stage: 'bron_docs' | 'db_docs' | 'ai'
      resolvedBronUrl: string
      detailText: string
      documentTexts: string[]
      sessionPartition?: string
      bronAllDocs: AnalysisDocRef[]
      bronNextIndex: number
      dbAllDocs: AnalysisDocRef[]
      dbNextIndex: number
    },
    mode: 'debounced' | 'immediate',
  ) {
    const full: AnalysisCheckpointV2 = {
      v: 2,
      ...base,
      aiPhase: ckAi.aiPhase,
      criteriaChunking: ckAi.criteriaChunking,
      configFingerprint: ckAi.configFingerprint,
    }
    if (mode === 'immediate') {
      flushDebouncedCk()
      saveAnalysisCheckpoint(tender.id, full)
    } else {
      debPayload = full
      if (!debTimer) {
        debTimer = setTimeout(() => {
          debTimer = null
          if (debPayload) {
            saveAnalysisCheckpoint(tender.id, debPayload)
            debPayload = null
          }
        }, 800)
      }
    }
  }

  if (!ck0) {
    const useLocalDocsOnly =
      Boolean(resolvedBronUrl) && canSkipBronFetchForAnalysis(String(tender.id), tender)

    if (useLocalDocsOnly) {
      log.info(
        `[analysis] Tender ${tender.id}: alle bijlagen staan lokaal — fetchBronPaginaDetails (tabs/API) overgeslagen`,
      )
      report(
        'Alle bijlagen staan al op deze computer — bronwebsite-tabbladen worden niet opnieuw geladen',
        6,
        'app',
      )
      const bronUrl = resolvedBronUrl
      detailText = String(tender.ruwe_tekst || '').trim()
      sessionPartition = getSessionPartitionForBronUrl(bronUrl)

      const textForLinkHarvest = [tender.beschrijving, detailText, tender.ruwe_tekst]
        .filter((x): x is string => Boolean(x && String(x).trim()))
        .join('\n\n')

      const dbDocInfos = parseDocumentInfosFromTender(tender)
      const mergedDocInfos = mergeDocumentInfoLists([
        dbDocInfos,
        extractSupplementaryDocumentsFromText(textForLinkHarvest),
      ])
      report('ZIP-verwerking vanaf schijf (indien van toepassing)…', 8, 'app')
      const mergedForZip = omitZipDownloadsWhenPartsAlreadyInList(mergedDocInfos)
      const expandedDocInfos = await expandZipEntriesInDocumentList(
        tender.id,
        mergedForZip,
        sessionPartition,
        resolvedBronUrl,
        {
          onProgress: (p) => report(p.step, p.percentage, 'app'),
        },
      )
      bronAllDocs = expandedDocInfos.map((d, idx) => normDocRef(d, d.naam || `bijlage-${idx}`))

      let navExisting: BronNavigatieLinkRow[] = []
      try {
        const ex = JSON.parse(String(tender.bron_navigatie_links || '[]'))
        if (Array.isArray(ex)) {
          navExisting = ex
            .filter((x: any) => x && typeof x.url === 'string')
            .map((x: any) => ({
              url: String(x.url),
              titel: String(x.titel || x.url),
              categorie: String(x.categorie || 'Gerelateerde link'),
            }))
        }
      } catch {
        navExisting = []
      }
      const navMerged = mergeNavigatieLinkRows(navExisting, buildNavigatieLinksFromText(textForLinkHarvest))
      const linkRowsForProc: BronNavigatieLink[] = navMerged.map((n) => ({
        titel: n.titel,
        url: n.url,
        categorie: n.categorie,
      }))
      let procCtx: TenderProcedureContext | undefined
      try {
        const rawCtx = tender.tender_procedure_context
        if (rawCtx != null && String(rawCtx).trim()) {
          procCtx = JSON.parse(String(rawCtx)) as TenderProcedureContext
        }
      } catch {
        procCtx = undefined
      }
      if (!procCtx && bronUrl.trim()) {
        procCtx = buildMinimalProcedureContext(bronUrl)
      }
      if (procCtx && linkRowsForProc.length) {
        procCtx = mergeProcedurePortals(procCtx, linkRowsForProc)
        procCtx = attachLinksToTimeline(procCtx, linkRowsForProc)
      }
      try {
        getDb()
          .prepare(
            `UPDATE aanbestedingen SET bron_navigatie_links = ?, tender_procedure_context = ? WHERE id = ?`,
          )
          .run(JSON.stringify(navMerged), procCtx ? JSON.stringify(procCtx) : null, tender.id)
        tender.bron_navigatie_links = JSON.stringify(navMerged)
      } catch {}

      const lowerDetail = detailText.toLowerCase()
      const isCancelled =
        lowerDetail.includes('aanbesteding is beëindigd') ||
        lowerDetail.includes('vroegtijdig beëindigd') ||
        lowerDetail.includes('ingetrokken') ||
        lowerDetail.includes('aanbesteding is geannuleerd') ||
        lowerDetail.includes('procedure is stopgezet') ||
        lowerDetail.includes('opdracht is niet gegund')

      const isAwarded = isAwardedTenderNotice({
        titel: tender.titel || '',
        beschrijving: tender.beschrijving,
        ruwe_tekst: detailText,
      })

      if (isCancelled && String(tender.bron_url || '').includes('tenderned.nl')) {
        log.info(`Tender "${tender.titel}" is beëindigd/ingetrokken - markeren als afgewezen`)
        try {
          getDb()
            .prepare(
              "UPDATE aanbestedingen SET status = 'afgewezen', notities = COALESCE(notities, '') || ? WHERE id = ?",
            )
            .run('\n[Automatisch afgewezen: aanbesteding is beëindigd/ingetrokken]', tender.id)
        } catch {}

        report('Aanbesteding is beëindigd/ingetrokken - overgeslagen', 100, 'app')
        clearAnalysisCheckpoint(tender.id)

        return {
          samenvatting: 'Deze aanbesteding is beëindigd of ingetrokken. Niet meer relevant.',
          antwoorden: {},
          criteria_scores: {},
          totaal_score: 0,
          match_uitleg: 'Aanbesteding is vroegtijdig beëindigd of ingetrokken door de aanbestedende dienst.',
          relevantie_score: 0,
          bijlage_analyses: [],
        }
      }

      if (isAwarded) {
        log.info(`Tender "${tender.titel}" is een gunningsaankondiging - archiveren en overslaan`)
        try {
          getDb()
            .prepare(
              "UPDATE aanbestedingen SET status = 'gearchiveerd', notities = COALESCE(notities, '') || ? WHERE id = ?",
            )
            .run(
              '\n[Automatisch gearchiveerd: reeds gegunde opdracht / gunningsaankondiging]',
              tender.id,
            )
        } catch {}

        report('Reeds gegunde opdracht - overgeslagen (geen analyse)', 100, 'app')
        clearAnalysisCheckpoint(tender.id)

        return {
          samenvatting:
            'Dit is een aankondiging van een reeds gegunde opdracht. Niet meer relevant om op in te schrijven.',
          antwoorden: {},
          criteria_scores: {},
          totaal_score: 0,
          match_uitleg:
            'Publicatie betreft een reeds gegunde opdracht; geen inschrijfkans meer.',
          relevantie_score: 0,
          bijlage_analyses: [],
        }
      }

      const afterFetch = handlePoll(tender.id, () =>
        persistCk(
          {
            stage: 'bron_docs',
            resolvedBronUrl,
            detailText,
            documentTexts: [...documentTexts],
            sessionPartition,
            bronAllDocs,
            bronNextIndex: 0,
            dbAllDocs: [],
            dbNextIndex: 0,
          },
          'immediate',
        ),
      )
      if (afterFetch === 'stop') return { outcome: 'stopped' }
      if (afterFetch === 'pause') return { outcome: 'paused' }
    } else if (resolvedBronUrl) {
      report('Detailpagina en bijlagen ophalen...', 2, 'app')
      const bronUrl = resolvedBronUrl
      /** Loopt monotonisch omhoog tijdens lange bron-fetch (API + verborgen browser tot2,5 min script-timeout). */
      let bronProgressFloor = 2
      const bronReport = (p: { step: string; percentage: number }) => {
        bronProgressFloor = Math.max(bronProgressFloor, Math.min(8, Math.round(p.percentage)))
        report(p.step, bronProgressFloor, 'app')
      }
      let details = await fetchBronPaginaDetails(bronUrl, {
        onProgress: bronReport,
        tenderId: tender.id,
      })
      const tnId = extractTenderNedPublicatieId(bronUrl)
      if (
        bronUrl.includes('tenderned.nl') &&
        (!details.documenten || details.documenten.length === 0) &&
        tnId
      ) {
        log.warn(`TenderNed ${tnId}: geen documenten na eerste fetch — tweede poging over 2,5s`)
        report('TenderNed: tweede poging na korte pauze (documentenlijst)…', 8, 'app')
        await new Promise((r) => setTimeout(r, 2500))
        details = await fetchBronPaginaDetails(bronUrl, {
          onProgress: bronReport,
          tenderId: tender.id,
        })
      }
      detailText = details.volledigeTekst || ''
      sessionPartition = details.sessionPartition

      const textForLinkHarvest = [
        tender.beschrijving,
        details.beschrijving,
        detailText,
        tender.ruwe_tekst,
      ]
        .filter((x): x is string => Boolean(x && String(x).trim()))
        .join('\n\n')

      let dbDocInfos: DocumentInfo[] = []
      try {
        const raw = tender.document_urls
        if (raw) {
          const arr = JSON.parse(raw)
          if (Array.isArray(arr)) {
            dbDocInfos = arr
              .map((d: any) => ({
                url: String(d.url || ''),
                localNaam: d.localNaam ? String(d.localNaam) : undefined,
                naam: String(d.naam || ''),
                type: String(d.type || ''),
                bronZipLabel: d.bronZipLabel ? String(d.bronZipLabel) : undefined,
              }))
              .filter((d: DocumentInfo) => Boolean(d.url?.trim() || d.localNaam?.trim()))
          }
        }
      } catch {
        dbDocInfos = []
      }

      /** Eerst DB (vaak al `localNaam` op schijf), daarna bron — merge bewaart bestaande lokale paden. */
      const mergedDocInfos = mergeDocumentInfoLists([
        dbDocInfos,
        details.documenten || [],
        extractSupplementaryDocumentsFromText(textForLinkHarvest),
      ])
      report('ZIP-bundels uitpakken (documentlijst)…', 9, 'app')
      const mergedForZip = omitZipDownloadsWhenPartsAlreadyInList(mergedDocInfos)
      const expandedDocInfos = await expandZipEntriesInDocumentList(
        tender.id,
        mergedForZip,
        details.sessionPartition,
        resolvedBronUrl,
        {
          onProgress: (p) => report(p.step, p.percentage, 'app'),
        }
      )
      bronAllDocs = expandedDocInfos.map((d, idx) => normDocRef(d, d.naam || `bijlage-${idx}`))

      let navExisting: BronNavigatieLinkRow[] = []
      try {
        const ex = JSON.parse(String(tender.bron_navigatie_links || '[]'))
        if (Array.isArray(ex)) {
          navExisting = ex
            .filter((x: any) => x && typeof x.url === 'string')
            .map((x: any) => ({
              url: String(x.url),
              titel: String(x.titel || x.url),
              categorie: String(x.categorie || 'Gerelateerde link'),
            }))
        }
      } catch {
        navExisting = []
      }
      const navMerged = mergeNavigatieLinkRows(navExisting, buildNavigatieLinksFromText(textForLinkHarvest))
      const linkRowsForProc: BronNavigatieLink[] = navMerged.map((n) => ({
        titel: n.titel,
        url: n.url,
        categorie: n.categorie,
      }))
      let procCtx =
        details.procedureContext ??
        (bronUrl.trim() ? buildMinimalProcedureContext(bronUrl) : undefined)
      if (procCtx && linkRowsForProc.length) {
        procCtx = mergeProcedurePortals(procCtx, linkRowsForProc)
        procCtx = attachLinksToTimeline(procCtx, linkRowsForProc)
      }
      try {
        getDb()
          .prepare(
            `UPDATE aanbestedingen SET bron_navigatie_links = ?, tender_procedure_context = ? WHERE id = ?`
          )
          .run(JSON.stringify(navMerged), procCtx ? JSON.stringify(procCtx) : null, tender.id)
        tender.bron_navigatie_links = JSON.stringify(navMerged)
      } catch {}

      const bronLeeg =
        !detailText.trim() &&
        !(details.beschrijving || '').trim() &&
        (!details.documenten || details.documenten.length === 0)
      if (bronLeeg) {
        log.warn(
          `Geen inhoud van bronpagina voor tender ${tender.id} — mogelijk timeout, inlogvenster of netwerk. Analyse gebruikt databasevelden.`
        )
        report('Bron niet volledig geladen — doorgaan met gegevens uit de app', 9, 'app')
      }

      const lowerDetail = detailText.toLowerCase()
      const isCancelled =
        lowerDetail.includes('aanbesteding is beëindigd') ||
        lowerDetail.includes('vroegtijdig beëindigd') ||
        lowerDetail.includes('ingetrokken') ||
        lowerDetail.includes('aanbesteding is geannuleerd') ||
        lowerDetail.includes('procedure is stopgezet') ||
        lowerDetail.includes('opdracht is niet gegund')

      const isAwarded = isAwardedTenderNotice({
        titel: tender.titel || '',
        beschrijving: tender.beschrijving,
        ruwe_tekst: detailText,
      })

      if (isCancelled && String(tender.bron_url || '').includes('tenderned.nl')) {
        log.info(`Tender "${tender.titel}" is beëindigd/ingetrokken - markeren als afgewezen`)
        try {
          getDb()
            .prepare(
              "UPDATE aanbestedingen SET status = 'afgewezen', notities = COALESCE(notities, '') || ? WHERE id = ?"
            )
            .run('\n[Automatisch afgewezen: aanbesteding is beëindigd/ingetrokken]', tender.id)
        } catch {}

        report('Aanbesteding is beëindigd/ingetrokken - overgeslagen', 100, 'app')
        clearAnalysisCheckpoint(tender.id)

        return {
          samenvatting: 'Deze aanbesteding is beëindigd of ingetrokken. Niet meer relevant.',
          antwoorden: {},
          criteria_scores: {},
          totaal_score: 0,
          match_uitleg: 'Aanbesteding is vroegtijdig beëindigd of ingetrokken door de aanbestedende dienst.',
          relevantie_score: 0,
          bijlage_analyses: [],
        }
      }

      if (isAwarded) {
        log.info(`Tender "${tender.titel}" is een gunningsaankondiging - archiveren en overslaan`)
        try {
          getDb()
            .prepare(
              "UPDATE aanbestedingen SET status = 'gearchiveerd', notities = COALESCE(notities, '') || ? WHERE id = ?"
            )
            .run(
              '\n[Automatisch gearchiveerd: reeds gegunde opdracht / gunningsaankondiging]',
              tender.id,
            )
        } catch {}

        report('Reeds gegunde opdracht - overgeslagen (geen analyse)', 100, 'app')
        clearAnalysisCheckpoint(tender.id)

        return {
          samenvatting:
            'Dit is een aankondiging van een reeds gegunde opdracht. Niet meer relevant om op in te schrijven.',
          antwoorden: {},
          criteria_scores: {},
          totaal_score: 0,
          match_uitleg:
            'Publicatie betreft een reeds gegunde opdracht; geen inschrijfkans meer.',
          relevantie_score: 0,
          bijlage_analyses: [],
        }
      }

      if (details.beschrijving && details.beschrijving.length > (tender.beschrijving?.length || 0)) {
        try {
          getDb()
            .prepare('UPDATE aanbestedingen SET beschrijving = ?, ruwe_tekst = ? WHERE id = ?')
            .run(
              details.beschrijving.slice(0, 5000),
              details.volledigeTekst.slice(0, 50000),
              tender.id
            )
        } catch {}
      }

      const afterFetch = handlePoll(tender.id, () =>
        persistCk(
          {
            stage: 'bron_docs',
            resolvedBronUrl,
            detailText,
            documentTexts: [...documentTexts],
            sessionPartition,
            bronAllDocs,
            bronNextIndex: 0,
            dbAllDocs: [],
            dbNextIndex: 0,
          },
          'immediate',
        )
      )
      if (afterFetch === 'stop') return { outcome: 'stopped' }
      if (afterFetch === 'pause') return { outcome: 'paused' }
    } else {
      bronAllDocs = []
    }
    stage = 'bron_docs'
    bronNextIndex = 0
  }

  if (stage === 'bron_docs') {
    if (bronAllDocs.length > 0 && bronNextIndex === 0) {
      report(
        `${bronAllDocs.length} bijlagen: bestaande bestanden hergebruiken, alleen ontbrekende downloaden…`,
        10,
        'app'
      )
    }

    for (let i = bronNextIndex; i < bronAllDocs.length; i++) {
      const doc = bronAllDocs[i]
      report(
        `Bijlage ${i + 1}/${bronAllDocs.length} lezen: ${doc.naam.slice(0, 50)}...`,
        10 + Math.round(((i + 1) / Math.max(bronAllDocs.length, 1)) * 10),
        'app'
      )

      if (!doc.localNaam?.trim() && isSkippableOffsiteDocumentUrl(doc.url)) {
        log.info(`Bijlage externe niet-documentlink (placeholder): ${doc.url}`)
        documentTexts.push(
          `\n--- BIJLAGE: ${doc.naam} ---\n[Geen leesbare tekst: externe link is geen tenderbijlage (bijv. social/tracking). URL: ${String(doc.url || '').slice(0, 240)}]\n`,
        )
      } else {
        let text = ''
        if (doc.localNaam?.trim()) {
          text = await readLocalDocumentAndExtractText(tender.id, doc.localNaam.trim(), doc.naam)
          if (!text || text.length <= 20) {
            log.warn(
              `Lokaal bijlagebestand leeg of ontbreekt (${doc.localNaam}), opnieuw van URL indien mogelijk: ${doc.url}`,
            )
          }
        }
        if ((!text || text.length <= 20) && doc.url?.trim() && !isSkippableOffsiteDocumentUrl(doc.url)) {
          const r = await downloadAndExtractText(doc.url, doc.naam, tender.id, sessionPartition, {
            preferredLocalNaam: doc.localNaam?.trim(),
          })
          text = r.text
          if (r.savedLocalName) {
            bronAllDocs[i] = { ...bronAllDocs[i], localNaam: r.savedLocalName }
          }
        }
        if (text && text.length > 20) {
          documentTexts.push(`\n--- BIJLAGE: ${doc.naam} ---\n${text}`)
          log.info(`Document "${doc.naam}": ${text.length} chars extracted`)
        } else {
          const urlHint = doc.url?.trim() ? String(doc.url).slice(0, 240) : 'geen URL'
          const localHint = doc.localNaam?.trim() || 'geen lokaal bestand'
          documentTexts.push(
            `\n--- BIJLAGE: ${doc.naam} ---\n[Geen leesbare tekst: extractie mislukt of document te kort. Lokaal: ${localHint}. URL: ${urlHint}]\n`,
          )
          log.warn(`Bijlage zonder bruikbare tekst: ${doc.naam}`)
        }
      }

      const px = handlePoll(tender.id, () =>
        persistCk(
          {
            stage: 'bron_docs',
            resolvedBronUrl,
            detailText,
            documentTexts: [...documentTexts],
            sessionPartition,
            bronAllDocs,
            bronNextIndex: i + 1,
            dbAllDocs: [],
            dbNextIndex: 0,
          },
          'immediate',
        ),
      )
      if (px === 'stop') return { outcome: 'stopped' }
      if (px === 'pause') return { outcome: 'paused' }
      persistCk(
        {
          stage: 'bron_docs',
          resolvedBronUrl,
          detailText,
          documentTexts: [...documentTexts],
          sessionPartition,
          bronAllDocs,
          bronNextIndex: i + 1,
          dbAllDocs: [],
          dbNextIndex: 0,
        },
        'debounced',
      )
    }

    if (bronAllDocs.length > 0) {
      try {
        const serialized = JSON.stringify(bronAllDocs)
        getDb().prepare('UPDATE aanbestedingen SET document_urls = ? WHERE id = ?').run(serialized, tender.id)
        tender.document_urls = serialized
      } catch (e) {
        log.warn('document_urls bijwerken na bijlagen verwerken mislukt', e)
      }
    }

    if (documentTexts.length === 0 && tender.document_urls) {
      try {
        const docUrls = JSON.parse(tender.document_urls)
        if (Array.isArray(docUrls)) {
          dbAllDocs = docUrls.map((d: any, idx: number) => normDocRef(d, `bijlage-${idx}`))
        } else {
          dbAllDocs = []
        }
      } catch {
        dbAllDocs = []
      }
    } else {
      dbAllDocs = []
    }

    dbNextIndex = 0
    stage = dbAllDocs.length > 0 ? 'db_docs' : 'ai'
  }

  if (stage === 'db_docs') {
    const partition =
      sessionPartition ?? getSessionPartitionForBronUrl(resolvedBronUrl || String(tender.bron_url || ''))

    for (let j = dbNextIndex; j < dbAllDocs.length; j++) {
      const doc = dbAllDocs[j]
      report(
        `Bijlage ${j + 1}/${dbAllDocs.length} lezen: ${(doc.naam || doc.url || '').slice(0, 50)}...`,
        10 + Math.round(((j + 1) / Math.max(dbAllDocs.length, 1)) * 10),
        'app'
      )

      const logical = doc.naam || `bijlage-${j}`
      if (!doc.localNaam?.trim() && isSkippableOffsiteDocumentUrl(String(doc.url || ''))) {
        documentTexts.push(
          `\n--- BIJLAGE: ${logical} ---\n[Geen leesbare tekst: externe link is geen tenderbijlage (bijv. social/tracking). URL: ${String(doc.url || '').slice(0, 240)}]\n`,
        )
      } else {
        let text = ''
        if (doc.localNaam?.trim()) {
          text = await readLocalDocumentAndExtractText(tender.id, doc.localNaam.trim(), logical)
          if (!text || text.length <= 20) {
            log.warn(
              `Lokaal bijlagebestand leeg of ontbreekt (${doc.localNaam}), opnieuw van URL indien mogelijk: ${doc.url}`,
            )
          }
        }
        if ((!text || text.length <= 20) && doc.url?.trim() && !isSkippableOffsiteDocumentUrl(String(doc.url))) {
          const r = await downloadAndExtractText(doc.url, logical, tender.id, partition, {
            preferredLocalNaam: doc.localNaam?.trim(),
          })
          text = r.text
          if (r.savedLocalName) {
            dbAllDocs[j] = { ...dbAllDocs[j], localNaam: r.savedLocalName }
          }
        }
        if (text && text.length > 20) {
          documentTexts.push(`\n--- BIJLAGE: ${doc.naam || `Bijlage ${j + 1}`} ---\n${text}`)
        } else {
          const urlHint = doc.url?.trim() ? String(doc.url).slice(0, 240) : 'geen URL'
          const localHint = doc.localNaam?.trim() || 'geen lokaal bestand'
          documentTexts.push(
            `\n--- BIJLAGE: ${doc.naam || `Bijlage ${j + 1}`} ---\n[Geen leesbare tekst: extractie mislukt of document te kort. Lokaal: ${localHint}. URL: ${urlHint}]\n`,
          )
          log.warn(`Bijlage zonder bruikbare tekst: ${logical}`)
        }
      }

      const px = handlePoll(tender.id, () =>
        persistCk(
          {
            stage: 'db_docs',
            resolvedBronUrl,
            detailText,
            documentTexts: [...documentTexts],
            sessionPartition,
            bronAllDocs,
            bronNextIndex: bronAllDocs.length,
            dbAllDocs,
            dbNextIndex: j + 1,
          },
          'immediate',
        ),
      )
      if (px === 'stop') return { outcome: 'stopped' }
      if (px === 'pause') return { outcome: 'paused' }
      persistCk(
        {
          stage: 'db_docs',
          resolvedBronUrl,
          detailText,
          documentTexts: [...documentTexts],
          sessionPartition,
          bronAllDocs,
          bronNextIndex: bronAllDocs.length,
          dbAllDocs,
          dbNextIndex: j + 1,
        },
        'debounced',
      )
    }

    if (dbAllDocs.length > 0) {
      try {
        const serialized = JSON.stringify(dbAllDocs)
        getDb().prepare('UPDATE aanbestedingen SET document_urls = ? WHERE id = ?').run(serialized, tender.id)
        tender.document_urls = serialized
      } catch (e) {
        log.warn('document_urls bijwerken (db_docs) mislukt', e)
      }
    }

    stage = 'ai'
  }

  if (stage !== 'ai') {
    log.warn(`runAnalysis: unexpected stage ${stage}, forcing AI`)
    stage = 'ai'
  }

  // ── Blokkeer analyse als er geen bijlagen/documenten zijn ──────────────────
  // Een aanbesteding zonder aanvullende documentatie kan niet betrouwbaar
  // worden beoordeeld. Alleen de TenderNed-beschrijving is onvoldoende.
  if (documentTexts.length === 0) {
    log.warn(`Analyse geblokkeerd voor "${tender.titel}": geen bijlagen gevonden`)
    report('Geen bijlagen gevonden — analyse niet mogelijk', 100, 'app')
    clearAnalysisCheckpoint(tender.id)

    return {
      samenvatting:
        'Analyse niet mogelijk: er zijn geen bijlagen of aanbestedingsdocumenten gevonden. ' +
        'Zonder bestek, selectieleidraad of andere documenten kan de aanbesteding niet worden beoordeeld. ' +
        'Controleer of de aanbesteding documenten heeft op TenderNed of Mercell en probeer opnieuw. ' +
        'Als de documenten op Mercell staan, zorg dan dat de OpenAI detectiesleutel is ingesteld in de instellingen.',
      antwoorden: {},
      criteria_scores: {},
      totaal_score: 0,
      match_uitleg: 'Analyse geblokkeerd: geen bijlagen of aanbestedingsdocumenten beschikbaar.',
      relevantie_score: 0,
      bijlage_analyses: [],
    }
  }

  report('Volledige analyse uitvoeren (1 prompt)...', 25, 'llm')

  // ── Chunked criteria-analyse voor grote documentsets ─────────────────────────
  // Als de totale documenttekst DOCS_CHUNK_THRESHOLD overschrijdt, worden de criteria
  // in afzonderlijke passes gescoord (één per chunk) en daarna samengevoegd.
  // De hoofd-AI-aanroep gebruikt de samengevoegde scores en hoeft criteria niet opnieuw te scoren.
  const totalDocChars = documentTexts.reduce((sum, t) => sum + t.length, 0)
  let preComputedCriteria: Record<string, NormalizedCriterionDetail> | null = null

  if (totalDocChars > DOCS_CHUNK_THRESHOLD && criteria.length > 0 && documentTexts.length > 1) {
    const docChunks = splitDocumentsIntoChunks(documentTexts, DOCS_CHUNK_CHARS)
    if (docChunks.length >= 2) {
      const allChunksDone =
        ckAi.criteriaChunking &&
        ckAi.criteriaChunking.totalChunks === docChunks.length &&
        ckAi.criteriaChunking.completedChunkIndices.length === docChunks.length
      const skipChunkCalls = ckAi.aiPhase === 'main_llm' && allChunksDone

      if (skipChunkCalls) {
        preComputedCriteria = {}
        for (const [id, d] of Object.entries(ckAi.criteriaChunking!.preComputedCriteria)) {
          preComputedCriteria[id] = d as NormalizedCriterionDetail
        }
        log.info('[analysis] Criteria-chunks volledig in checkpoint — sla LLM-deelpasses over')
      } else {
        log.info(
          `[analysis] Chunked analyse: ${documentTexts.length} bijlagen (${Math.round(totalDocChars / 1000)}k tekens) → ${docChunks.length} delen`,
        )
        report(
          `Grote documenten (${Math.round(totalDocChars / 1000)}k tekens) — criteria in ${docChunks.length} delen beoordelen…`,
          26,
          'llm',
        )

        if (!ckAi.criteriaChunking || ckAi.criteriaChunking.totalChunks !== docChunks.length) {
          ckAi.criteriaChunking = {
            totalChunks: docChunks.length,
            completedChunkIndices: [],
            preComputedCriteria: {},
          }
        }

        preComputedCriteria = {}
        for (const [id, d] of Object.entries(ckAi.criteriaChunking.preComputedCriteria)) {
          preComputedCriteria[id] = d as NormalizedCriterionDetail
        }

        const completed = new Set(ckAi.criteriaChunking.completedChunkIndices)
        const critChunkPhaseStart = Date.now()
        const perCritChunkMs: number[] = new Array(docChunks.length).fill(0)
        const chunkResults: (Awaited<ReturnType<typeof runCriteriaChunkAnalysis>> | undefined)[] = new Array(
          docChunks.length,
        )

        for (let batchStart = 0; batchStart < docChunks.length; batchStart += LLM_CHUNK_EXTRACTION_CONCURRENCY) {
          const pxChunk = handlePoll(tender.id, () =>
            persistCk(
              {
                stage: 'ai',
                resolvedBronUrl,
                detailText,
                documentTexts: [...documentTexts],
                sessionPartition,
                bronAllDocs,
                bronNextIndex: bronAllDocs.length,
                dbAllDocs,
                dbNextIndex: dbAllDocs.length,
              },
              'immediate',
            ),
          )
          if (pxChunk === 'stop') return { outcome: 'stopped' }
          if (pxChunk === 'pause') return { outcome: 'paused' }

          const batchEnd = Math.min(batchStart + LLM_CHUNK_EXTRACTION_CONCURRENCY, docChunks.length)
          const indicesToRun: number[] = []
          for (let ci = batchStart; ci < batchEnd; ci++) {
            if (!completed.has(ci)) indicesToRun.push(ci)
          }

          if (indicesToRun.length > 0) {
            const critPct = 27 + Math.round((batchEnd / docChunks.length) * 12)
            report(
              `Criteria beoordelen: delen ${batchStart + 1}-${batchEnd}/${docChunks.length} (parallel)…`,
              critPct,
              'llm',
            )

            await runWithPeriodicLlmProgress(
              report,
              critPct,
              Math.min(39, critPct + 5),
              (sec) =>
                `Criteria beoordelen: delen ${batchStart + 1}-${batchEnd}/${docChunks.length} — nog bezig (${sec}s, parallelle modelcalls)…`,
              async () => {
                await Promise.all(
                  indicesToRun.map((ci) =>
                    (async () => {
                      const t0 = Date.now()
                      const chunkResult = await runCriteriaChunkAnalysis(
                        docChunks[ci],
                        ci,
                        docChunks.length,
                        tender,
                        criteria,
                        settings,
                        agentPrompt,
                        scorerPrompt,
                      )
                      perCritChunkMs[ci] = Date.now() - t0
                      chunkResults[ci] = chunkResult
                    })(),
                  ),
                )
              },
            )

            for (const ci of indicesToRun) {
              completed.add(ci)
              const chunkResult = chunkResults[ci]
              if (!chunkResult) continue
              for (const [id, detail] of Object.entries(chunkResult)) {
                const ex = preComputedCriteria![id]
                if (!ex || detail.score > ex.score) {
                  preComputedCriteria![id] = detail
                }
              }
            }

            ckAi.aiPhase = 'criteria_chunks'
            ckAi.criteriaChunking = {
              totalChunks: docChunks.length,
              completedChunkIndices: [...completed].sort((a, b) => a - b),
              preComputedCriteria: criteriaRecordForCheckpoint(preComputedCriteria),
            }
            persistCk(
              {
                stage: 'ai',
                resolvedBronUrl,
                detailText,
                documentTexts: [...documentTexts],
                sessionPartition,
                bronAllDocs,
                bronNextIndex: bronAllDocs.length,
                dbAllDocs,
                dbNextIndex: dbAllDocs.length,
              },
              'debounced',
            )
          }
        }

        const critChunkPhaseMs = Date.now() - critChunkPhaseStart
        const sumCritChunkMs = perCritChunkMs.reduce((a, b) => a + b, 0)
        const critSavingMs = Math.max(0, sumCritChunkMs - critChunkPhaseMs)
        const critSavingPct = sumCritChunkMs > 0 ? Math.round((critSavingMs / sumCritChunkMs) * 100) : 0
        log.info(
          `[analysis] Criteria chunk-fase: ${critChunkPhaseMs}ms muur (parallel, batch=${LLM_CHUNK_EXTRACTION_CONCURRENCY}); ` +
            `som chunk-wachttijden ~${sumCritChunkMs}ms; geschatte tijdswinst in deze fase ~${critSavingMs}ms (${critSavingPct}%)`,
        )

        const nScored = Object.keys(preComputedCriteria).length
        log.info(`[analysis] Chunked criteria samengevoegd: ${nScored}/${criteria.length} criteria gescoord`)
        if (nScored === 0) preComputedCriteria = null
      }
    }
  }

  const criteriaList = criteria
    .map((c: any) => `- [ID:${c.id}] ${c.naam}: ${c.beschrijving || ''}`)
    .join('\n')
  const questionsList = questions.map((q, i) => `${i + 1}. [ID:${q.id}] ${q.vraag}`).join('\n')

  const bijlageCtx = buildTenderBijlageContext(tender, detailText, documentTexts, MAX_BIJLAGE_CHARS_IN_MAIN_PROMPT)
  const tenderText = bijlageCtx.tenderText
  log.info(
    `[analysis] Bijlagen in hoofdprompt: ${bijlageCtx.stats.includedInPromptCount}/${bijlageCtx.stats.totalBijlagen} ` +
      `(bijlage-tekens in prompt ${bijlageCtx.stats.includedBijlageChars}/${bijlageCtx.stats.totalBijlageChars}` +
      `${bijlageCtx.stats.omittedFromPromptCount > 0 ? `; ${bijlageCtx.stats.omittedFromPromptCount} alleen in per-bijlage-stap` : ''})`,
  )
  log.info(`Analysis context for "${tender.titel}": ${tenderText.length} chars total (${documentTexts.length} bijlagen)`)

  const bijlageNamenAll = extractBijlageNamenFromDocumentTexts(documentTexts)
  const docsInMainPrompt = bijlageCtx.includedDocIndices.map(i => documentTexts[i])
  const bijlageNamenMain = extractBijlageNamenFromDocumentTexts(docsInMainPrompt)

  const docSummary =
    documentTexts.length > 0
      ? `De analyse is gebaseerd op ${documentTexts.length} bijlage(n)` +
        (bijlageCtx.stats.omittedFromPromptCount > 0
          ? `; ${bijlageNamenMain.length} staan (volledig of deels) in de BIJLAGEN-sectie van deze prompt, overige worden systeemtechnisch per bestand geanalyseerd.`
          : '.')
      : 'Er zijn geen bijlagen/documenten beschikbaar.'

  const bijlageRegels =
    bijlageNamenMain.length > 0
      ? bijlageNamenMain.map((n, i) => `${i + 1}. ${n}`).join('\n')
      : '(geen aparte bijlagenblokken in deze prompt — gebruik lege array bijlage_analyses voor STAP 2b)'

  /** Platform-label per bijlage (JSON-veld "bron"); bij ontbrekende modeloutput gebruiken we de tender-URL. */
  const portalBronHint = inferPortalBronFromBronUrl(resolvedBronUrl)

  // Als criteria al in chunks zijn gescoord: geef ze mee als pre-computed context
  const preComputedHint =
    preComputedCriteria && Object.keys(preComputedCriteria).length > 0
      ? `\n⚠️ CRITERIA ZIJN VOORAF GESCOORD OVER MEERDERE DOCUMENTDELEN. Kopieer de onderstaande pre-gescoorde criteria EXACT naar het "criteria" JSON-veld — niet opnieuw beoordelen. Zorg dat scores, status, toelichting en brontekst letterlijk worden overgenomen. Vul alle overige velden (antwoorden, tender_velden, bijlage_analyses, match_uitleg, samenvatting) normaal in.\n\nPRE-GESCOORDE CRITERIA:\n${JSON.stringify(preComputedCriteria)}\n`
      : ''

  const combinedSystemPrompt = `${agentPrompt}\n\n${scorerPrompt}`

  let combinedUserPrompt = `Je bent een aanbestedingsanalist. Neem de VOLLEDIGE tender mee: alle tekst van de bronpagina (inclusief tabbladen) én ELKE bijlage onder ========== BIJLAGEN ==========. Geen document overslaan.
${preComputedHint}
De bron is automatisch opgehaald via dezelfde URL als in de app (o.a. TenderNed-overzicht); de tekst bevat waar beschikbaar alle tabbladen (Details, Publicatie, Documenten, Vraag en antwoord) plus openbare API-velden. Waar van toepassing zijn ook Mercell/s2c-tabbladen en -documenten in de context opgenomen (zelfde werkwijze: beide sites).

De sectie "Volledige tekst detailpagina" bevat waar mogelijk: Details, Publicatie, Documenten, Vraag en antwoord (en vergelijkbaar op andere platforms).

Mercell/s2c: als er vragenlijsten, UEA-formulieren, prijs-/kwaliteitsschema's of inschrijf-/gunningsformulieren tussen de bijlagen staan (vaak als aparte downloads naast PDF-bijlagen): behandel die als kernstukken. Daarin staat vaak expliciet welke expertise, referenties, bewijsstukken en beoordelingslogica de aanbestedende dienst verwacht — gebruik die in antwoorden, tender_velden.beoordelingscriteria_kort en in bijlage_analyses om een scherp beeld van de gezochte expertise te geven.

${tenderText}

---

WERKVOLGORDE (strikt — zo vul je de JSON):

STAP 0 — VACATURE- / PERSONEELSCHECK (altijd als eerste, stil in je hoofd): Is dit een procedure voor uitvoering van civiele/GWW-werkzaamheden door een aannemer (bestek, object, hoeveelheden, planning), of gaat de kern om werving/inhuur/detachering van mensen (vacature, sollicitatie, functie, FTE, wegbeheerder, civiele medewerker, civiel technicus/engineer als hoofdlevering, uurtarief detachement, arbeidsovereenkomst)? Bij twijfel: lees titel, samenvatting en eerste koppen; zoek naar solliciteren/vacature/functie/uren per week. Is het personeel: dan in STAP 2 alle criteria op "niet_aanwezig" met score 0, totaal_score 0, en in match_uitleg + samenvatting expliciet vermelden dat het geen bouw-/aannemingsopdracht is maar personeelsinkoop — géén hoge scores op basis van woorden als "civiel" of "weg". Sla geen vragen over in STAP 1, maar wees inhoudelijk eerlijk (bijv. dat deelname als aannemer niet aan de orde is).

STAP 1 — VRAGEN (eerst): Beantwoord ELKE onderstaande vraag met ID op basis van de gehele inhoud (pagina + alle bijlagen). Elk vraag-ID moet een key in "antwoorden" hebben. Ontbreekt info: zeg dat expliciet in het antwoord.

STAP 2 — CRITERIA: Beoordeel elk criterium; brontekst waar mogelijk letterlijk uit bijlagen/pagina. Wees nauwkeurig: bij gedeeltelijke overlap (bijv. terreininrichting, riolering, verharding) géén score 0 tenzij de documenten uitdrukkelijk buiten het profiel vallen — behalve bij STAP 0 waar je reeds vaststelde dat het een vacature/personeelsprocedure is (dan wél overal 0 / niet_aanwezig).

STAP 2a — TENDER_VELDEN: Vul object "tender_velden" met kerngegevens uit de gehele context (pagina, API-velden, bijlagen). Datums als DD-MM-JJJJ of ISO; lege string alleen als nergens te vinden. Vul opdrachtgever, sluitingsdatum_inschrijving, publicatiedatum, uitvoeringsperiode, procedure_type, type_opdracht, CPV/werkzaamheden, waarde, locatie, beoordelingscriteria_kort. Extraheer tevens: adres/email/telefoon/website van de aanbestedende dienst, contactpersoon (naam + email + telefoon), het adres of platform waar de inschrijving ingediend moet worden, en alle hyperlinks (URLs) die in bijlagen of de bronpagina staan (procedure-links, portals, aanvullende informatie, formulieren) als JSON-array in document_links.

STAP 2b — PER BIJLAGE (alleen de onderstaande namen — dit zijn de bijlagen die in de BIJLAGEN-sectie hierboven staan): Voor ELKE regel exact één object in "bijlage_analyses" (zelfde "naam" als hieronder). Geen regel weglaten.
- bron: "tenderned" | "mercell" | "overig" (afleiden uit URL/tekst: mercell.com, s2c.mercell → mercell)
- samenvatting: 3–6 zinnen wat deze bijlage betekent voor de inschrijver
- belangrijkste_punten: korte strings
- risicos: inschrijvings- of uitvoeringsrisico's uit deze bijlage
- score: geheel getal 0–100 (relevantie/kritiek voor inschrijving)
- uitleg_score: minstens twee zinnen, concreet

STAP 3 — SAMENVATTING (laatste): Max. 300 woorden, synthese ${docSummary} die aansluit op de gegeven antwoorden, criteria en bijlage_analyses (type werk, eisen, risico's, relevantie voor aannemer).

=== BIJLAGEN (STAP 2b — exact deze namen) ===
${bijlageRegels}

=== VRAGEN (STAP 1) ===
${questionsList}

=== CRITERIA (STAP 2) ===
${criteriaList}

BELANGRIJK: in de JSON moet elke sleutel onder "criteria" EXACT de ID zijn uit [ID:...] (niet de leesbare naam). Kopieer de id-letter voor letter.

Per criterium: status match / gedeeltelijk / niet_aanwezig / risico; score; toelichting; EXACTE brontekst of "Niet vermeld in de beschikbare documentatie."

match_uitleg: minimaal 120 woorden, in duidelijke alinea's: (1) wat TenderNed/tabbladen toevoegen, (2) wat Mercell of tweede platform toevoegt indien aanwezig, (3) samenhang tussen documenten, (4) totaaloordeel voor inschrijving.

OUTPUT REGELS (KRITISCH):
- Alleen geldige JSON, geen markdown
- Velden: antwoorden, criteria, tender_velden, bijlage_analyses, match_uitleg, risico_factoren, samenvatting
- "samenvatting" is STAP 3 en vat alles samen na vragen, criteria, tender_velden en bijlagen

{
  "antwoorden": {
    "<vraag_id>": "antwoord"
  },
  "criteria": {
    "<exact_id_uit[ID:...]_hier>": {
      "score": 100,
      "status": "match",
      "toelichting": "uitleg",
      "brontekst": "EXACTE passage uit documenten"
    }
  },
  "tender_velden": {
    "publicatiedatum": "",
    "sluitingsdatum_inschrijving": "",
    "datum_start_uitvoering": "",
    "datum_einde_uitvoering": "",
    "opdrachtgever": "",
    "referentienummer": "",
    "procedure_type": "",
    "type_opdracht": "",
    "cpv_of_werkzaamheden": "",
    "geraamde_waarde": "",
    "locatie_of_regio": "",
    "beoordelingscriteria_kort": "",
    "opmerkingen": "",
    "opdrachtgever_adres": "",
    "opdrachtgever_email": "",
    "opdrachtgever_telefoon": "",
    "opdrachtgever_website": "",
    "contactpersoon_naam": "",
    "contactpersoon_email": "",
    "contactpersoon_telefoon": "",
    "indiening_adres": "",
    "document_links": "[{\"url\":\"https://...\",\"titel\":\"...\",\"categorie\":\"procedure\"}]"
  },
  "bijlage_analyses": [
    {
      "naam": "exact uit lijst STAP 2b",
      "bron": "tenderned",
      "samenvatting": "...",
      "belangrijkste_punten": ["..."],
      "risicos": ["..."],
      "score": 75,
      "uitleg_score": "..."
    }
  ],
  "match_uitleg": "min. 120 woorden — zie instructie",
  "risico_factoren": ["..."],
  "samenvatting": "max 300 woorden — synthese na alle bovenstaande"
}`

  const promptCharsTotal = combinedSystemPrompt.length + combinedUserPrompt.length

  // Context-guard: kap tenderText in als het totaal de model-limiet overschrijdt.
  // ~4 chars per token; reserveer completion-tokens zodat het model altijd kan antwoorden.
  const CHARS_PER_TOKEN = 4
  const providerForLimit = (settings as any).ai_provider || 'claude'
  const MAX_INPUT_TOKENS =
    providerForLimit === 'claude'
      ? 180_000  // Claude 200k window − veiligheidsmarge
      : 108_000  // OpenAI/Moonshot/Ollama 128k − 16k completion − veiligheidsmarge
  const MAX_INPUT_CHARS = MAX_INPUT_TOKENS * CHARS_PER_TOKEN

  if (promptCharsTotal > MAX_INPUT_CHARS && tenderText.length > 1000) {
    const overhead = promptCharsTotal - tenderText.length
    const budgetForTenderText = Math.max(10_000, MAX_INPUT_CHARS - overhead - 500)
    if (tenderText.length > budgetForTenderText) {
      const truncatedTenderText =
        tenderText.slice(0, budgetForTenderText) +
        '\n\n[... CONTEXT INGEKORT — origineel te lang voor model-limiet. Alle beschikbare info hierboven is meegenomen. ...]'
      combinedUserPrompt = combinedUserPrompt.replace(tenderText, truncatedTenderText)
      log.warn(
        `[analysis] Context ingekort voor provider="${providerForLimit}": tenderText ${tenderText.length} → ${budgetForTenderText} chars` +
          ` (prompt was ${promptCharsTotal} chars, budget ${MAX_INPUT_CHARS})`,
      )
    }
  }

  const promptCharsFinal = combinedSystemPrompt.length + combinedUserPrompt.length
  report(
    `Prompt klaar (~${Math.round(promptCharsFinal / 1000)}k tekens) — controle vóór versturen naar model…`,
    33,
    'llm'
  )

  ckAi.aiPhase = 'main_llm'
  if (preComputedCriteria && ckAi.criteriaChunking) {
    ckAi.criteriaChunking.preComputedCriteria = criteriaRecordForCheckpoint(preComputedCriteria)
  }

  const beforeAi = handlePoll(tender.id, () =>
    persistCk(
      {
        stage: 'ai',
        resolvedBronUrl,
        detailText,
        documentTexts: [...documentTexts],
        sessionPartition,
        bronAllDocs,
        bronNextIndex: bronAllDocs.length,
        dbAllDocs,
        dbNextIndex: dbAllDocs.length,
      },
      'immediate',
    ),
  )
  if (beforeAi === 'stop') return { outcome: 'stopped' }
  if (beforeAi === 'pause') return { outcome: 'paused' }

  let antwoorden: Record<string, string> = {}
  let scores: Record<string, number> = {}
  let criteriaDetails: Record<string, { score: number; status: string; toelichting: string; brontekst: string }> = {}
  let totaalScore = 0
  let matchUitleg = ''
  let relevantieScore = 0
  let samenvatting = ''
  let bijlageAnalysesFromMain: BijlageAnalyse[] = normalizeBijlageAnalyses(null, bijlageNamenMain, portalBronHint)
  let tenderVelden: AiExtractedTenderFields | undefined = undefined

  try {
    report('AI analyse wordt uitgevoerd...', 40, 'llm')

    const prov = settings.ai_provider || 'claude'
    const preferJsonOutput =
      prov === 'ollama' || prov === 'openai' || prov === 'moonshot' || prov === 'kimi_cli'

    const response = await withLlmWaitHeartbeats(report, () =>
      aiService.chat(
        [
          { role: 'system', content: combinedSystemPrompt },
          { role: 'user', content: combinedUserPrompt },
        ],
        { preferJsonOutput }
      )
    )

    report('Resultaten verwerken...', 80, 'llm')

    const { parsed, parseError, parseRoute, extractMode } = parseAnalysisJsonResponse(response)

    if (!parsed) {
      log.error(
        `[analysis] JSON parse mislukt tenderId=${tender.id}: ${parseError} (responseChars=${response.length}, promptChars=${promptCharsFinal})`,
        response.slice(0, 2500)
      )
      const truncatieHint =
        response.length > 0 && response.length < 500
          ? ' Het antwoord is waarschijnlijk afgekapt door de token-limiet van het model.'
          : ''
      samenvatting =
        'Analyse kon niet worden uitgevoerd: ' +
        (parseError ||
          'Het model gaf geen geldige JSON. Bij Ollama: zorg dat je model JSON-modus ondersteunt, of probeer een ander model.') +
        truncatieHint
      matchUitleg = (parseError || 'Parsefout') + truncatieHint
      bijlageAnalysesFromMain = normalizeBijlageAnalyses(null, bijlageNamenMain, portalBronHint)
    } else {
      if (parsed.antwoorden && typeof parsed.antwoorden === 'object' && !Array.isArray(parsed.antwoorden)) {
        antwoorden = parsed.antwoorden as Record<string, string>
      }

      if (typeof parsed.samenvatting === 'string') {
        samenvatting = parsed.samenvatting
      }

      const rawCrit =
        parsed.criteria ??
        (parsed as Record<string, unknown>).criterium_scores ??
        (parsed as Record<string, unknown>).criteria_scores

      const critRows = criteria.map((c: any) => ({
        id: String(c.id || ''),
        naam: String(c.naam || ''),
      })).filter((c) => c.id.length > 0)

      let criteriaNormalized = normalizeModelCriteriaOutput(rawCrit, critRows)

      // Merge met pre-computed criteria (chunk-passes): neem het beste score per criterium
      if (preComputedCriteria && Object.keys(preComputedCriteria).length > 0) {
        if (!criteriaNormalized) {
          criteriaNormalized = { ...preComputedCriteria }
          log.info(`[analysis] Criteria uitsluitend van chunk-passes (${Object.keys(criteriaNormalized).length} stuks)`)
        } else {
          let improved = 0
          for (const [id, preDetail] of Object.entries(preComputedCriteria)) {
            const ex = criteriaNormalized[id]
            if (!ex || preDetail.score > ex.score) {
              criteriaNormalized[id] = preDetail
              improved++
            }
          }
          log.info(`[analysis] Criteria samengevoegd met chunk-passes: ${improved} verbeterd, totaal ${Object.keys(criteriaNormalized).length}`)
        }
      }

      if (criteriaNormalized) {
        let hasMatch = false
        let hasPartial = false
        let risicoAftrek = 0

        for (const [key, detail] of Object.entries(criteriaNormalized)) {
          const score = detail.score ?? 0
          const status = detail.status

          scores[key] = score
          criteriaDetails[key] = {
            score,
            status,
            toelichting: detail.toelichting || '',
            brontekst: detail.brontekst || '',
            ...(detail.criterium_naam ? { criterium_naam: detail.criterium_naam } : {}),
          }

          if (status === 'match' || score >= 75) hasMatch = true
          else if (status === 'gedeeltelijk' || (score >= 25 && score < 75)) hasPartial = true
          else if (status === 'risico' || score < 0) risicoAftrek += Math.abs(score / 50) * 10
        }

        if (hasMatch) {
          totaalScore = hasPartial ? 90 : 85
        } else if (hasPartial) {
          totaalScore = 55
        } else {
          totaalScore = 20
        }
        totaalScore = Math.max(0, Math.min(100, totaalScore - risicoAftrek))

        const scoreVals = Object.values(criteriaDetails)
          .map(d => d.score)
          .filter(s => Number.isFinite(s)) as number[]
        if (scoreVals.length > 0) {
          const avgCrit = scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length
          totaalScore = Math.max(0, Math.min(100, Math.round(0.38 * totaalScore + 0.62 * avgCrit)))
        }
      } else if (critRows.length > 0) {
        log.warn(
          `[analysis] Geen bruikbaar criteria-blok na normalisatie (provider ${prov}). ` +
          `rawCrit type=${typeof rawCrit}, keys=${rawCrit && typeof rawCrit === 'object' ? Object.keys(rawCrit as object).slice(0, 10).join(',') : String(rawCrit)?.slice(0, 80)}. ` +
          `Parsed top-keys: ${Object.keys(parsed).join(', ')}`
        )
      }

      tenderVelden = normalizeTenderVelden(parsed.tender_velden)

      matchUitleg = typeof parsed.match_uitleg === 'string' ? parsed.match_uitleg : ''
      if (parsed.risico_factoren && Array.isArray(parsed.risico_factoren) && parsed.risico_factoren.length > 0) {
        matchUitleg += '\n\nRisicofactoren: ' + (parsed.risico_factoren as string[]).join('; ')
      }
      relevantieScore = totaalScore
      bijlageAnalysesFromMain = normalizeBijlageAnalyses(parsed.bijlage_analyses, bijlageNamenMain, portalBronHint)

      const expQ = questions.length
      const expC = criteria.length
      const expB = bijlageNamenMain.length
      const gotQ = Object.keys(antwoorden).length
      const gotC =
        Object.keys(criteriaDetails).length > 0
          ? Object.keys(criteriaDetails).length
          : Object.keys(scores).length
      const gotB = bijlageAnalysesFromMain.length

      log.info(
        `[analysis] verwerking OK tenderId=${tender.id} titel="${String(tender.titel || '').slice(0, 72)}" ` +
          `json=${parseRoute ?? '?'} extract=${extractMode ?? '?'} ` +
          `vragen ${gotQ}/${expQ} criteria ${gotC}/${expC} bijlage_analyses ${gotB}/${expB} ` +
          `totaal_score=${totaalScore} samenvattingChars=${samenvatting.length} matchUitlegChars=${matchUitleg.length} ` +
          `api=${String(settings.ai_provider || '')} promptChars=${promptCharsFinal}`
      )

      if (expQ > 0 && gotQ === 0) {
        log.warn(`[analysis] check: geen antwoorden in JSON terwijl ${expQ} actieve vraag/vragen — inhoud mogelijk incompleet`)
      }
      if (expC > 0 && gotC === 0) {
        log.warn(`[analysis] check: geen criteria-scores in JSON terwijl ${expC} actief — inhoud mogelijk incompleet`)
      }
      if (expB > 0 && gotB === 0) {
        log.warn(`[analysis] check: geen bijlage_analyses terwijl ${expB} bijlage(n) in context — inhoud mogelijk incompleet`)
      }
    }
  } catch (error: any) {
    log.error('Combined analysis failed:', error)
    samenvatting = 'Analyse kon niet worden uitgevoerd: ' + error.message
    matchUitleg = error.message
    bijlageAnalysesFromMain = normalizeBijlageAnalyses(null, bijlageNamenMain, portalBronHint)
  }

  report('Per-bijlage analyse (alle documenten)…', 86, 'llm')
  const saverAi = () =>
    persistCk(
      {
        stage: 'ai',
        resolvedBronUrl,
        detailText,
        documentTexts: [...documentTexts],
        sessionPartition,
        bronAllDocs,
        bronNextIndex: bronAllDocs.length,
        dbAllDocs,
        dbNextIndex: dbAllDocs.length,
      },
      'immediate',
    )
  const perBijlageOutcome = await runPerBijlageAnalysisPasses({
    tenderId: tender.id,
    tender,
    documentTexts,
    portalBronHint,
    settings,
    report,
    poll: () => handlePoll(tender.id, saverAi),
  })
  if (!perBijlageOutcome.ok) return { outcome: perBijlageOutcome.outcome }

  const bijlageAnalyses = mergeMainAndPerBijlage(
    bijlageAnalysesFromMain,
    perBijlageOutcome.analyses,
    bijlageNamenAll,
    portalBronHint,
  )
  log.info(
    `[analysis] Per-bijlage ronde: ${perBijlageOutcome.modelCallsOk}/${perBijlageOutcome.modelCallsAttempted} model OK, ` +
      `${perBijlageOutcome.skippedUnreadable} zonder leesbare tekst, ${perBijlageOutcome.modelCallsFailed} model/parse-fout`,
  )

  // Als de AI wel reageerde maar geen bruikbare samenvatting of criteria leverde, zet een
  // herkenbare foutmelding zodat de batch-skip logica (tenderHasStoredAiScore) de analyse
  // als "mislukt" beschouwt en bij een volgende batch opnieuw probeert.
  if (!samenvatting.trim() && Object.keys(criteriaDetails).length === 0 && Object.keys(scores).length === 0) {
    samenvatting =
      'Analyse incompleet: het model gaf geen bruikbare criteria-scores of samenvatting. ' +
      `Controleer het AI-model (huidig: ${settings.ai_provider || 'onbekend'} / ${settings.ai_model || 'onbekend'}) ` +
      'en voer de analyse opnieuw uit. Bij Ollama: gebruik een model met goede JSON-ondersteuning (bijv. llama3.1, mistral, phi4).'
    log.warn(`[analysis] Analyse incompleet voor "${String(tender.titel || '').slice(0, 72)}" — geen criteria of samenvatting in model-output`)
  }

  const criteriaScoresForDb = Object.keys(criteriaDetails).length > 0 ? criteriaDetails : scores

  report('Analyse voltooid', 100, 'llm')

  clearAnalysisCheckpoint(tender.id)

  return {
    samenvatting,
    antwoorden,
    criteria_scores: criteriaScoresForDb as any,
    totaal_score: totaalScore,
    match_uitleg: matchUitleg,
    relevantie_score: relevantieScore,
    bijlage_analyses: bijlageAnalyses,
    tender_velden: tenderVelden,
  }
  } finally {
    flushDebouncedCkSafe()
    releaseBusyWorkBlocker('ai-analysis')
  }
}

function normalizeTenderVelden(raw: unknown): AiExtractedTenderFields | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const str = (k: string) => (typeof o[k] === 'string' ? o[k].trim() : typeof o[k] === 'number' ? String(o[k]) : '')
  const keys = [
    'publicatiedatum',
    'sluitingsdatum_inschrijving',
    'datum_start_uitvoering',
    'datum_einde_uitvoering',
    'opdrachtgever',
    'referentienummer',
    'procedure_type',
    'type_opdracht',
    'cpv_of_werkzaamheden',
    'geraamde_waarde',
    'locatie_of_regio',
    'beoordelingscriteria_kort',
    'opmerkingen',
    'opdrachtgever_adres',
    'opdrachtgever_email',
    'opdrachtgever_telefoon',
    'opdrachtgever_website',
    'contactpersoon_naam',
    'contactpersoon_email',
    'contactpersoon_telefoon',
    'indiening_adres',
    'document_links',
  ] as const
  const out: AiExtractedTenderFields = {}
  for (const k of keys) {
    const v = str(k)
    if (v) (out as Record<string, string>)[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

type CriteriaRow = { id: string; naam: string }

type NormalizedCriterionDetail = {
  score: number
  status: string
  toelichting: string
  brontekst: string
  criterium_naam: string
}

function criteriaRecordForCheckpoint(
  m: Record<string, NormalizedCriterionDetail>,
): Record<string, NormalizedCriterionDetailJson> {
  const o: Record<string, NormalizedCriterionDetailJson> = {}
  for (const [k, v] of Object.entries(m)) {
    o[k] = {
      score: v.score,
      status: v.status,
      toelichting: v.toelichting,
      brontekst: v.brontekst,
      criterium_naam: v.criterium_naam,
    }
  }
  return o
}

function normCritKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Brengt ruwe model-output (object met naam-keys, array, alternatieve veldnamen) naar
 * stabiele sleutels = criterion.id, met leesbare naam voor de UI.
 */
function normalizeModelCriteriaOutput(
  raw: unknown,
  criteria: CriteriaRow[]
): Record<string, NormalizedCriterionDetail> | null {
  if (raw == null) return null

  const byId = new Map(criteria.map((c) => [c.id, c]))
  const byNaamNorm = new Map(criteria.map((c) => [normCritKey(c.naam), c]))

  const pairs: [string, Record<string, unknown>][] = []

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const o = item as Record<string, unknown>
      const k =
        typeof o.id === 'string' && o.id.trim()
          ? o.id.trim()
          : typeof o.criterium_id === 'string' && String(o.criterium_id).trim()
            ? String(o.criterium_id).trim()
            : typeof o.criterium === 'string' && o.criterium.trim()
              ? o.criterium.trim()
              : typeof o.naam === 'string' && o.naam.trim()
                ? o.naam.trim()
                : typeof o.name === 'string' && o.name.trim()
                  ? o.name.trim()
                  : ''
      if (!k) continue
      pairs.push([k, o])
    }
  } else if (typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        pairs.push([k, v as Record<string, unknown>])
      } else if (typeof v === 'number' || typeof v === 'string') {
        const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
        pairs.push([k, { score: Number.isFinite(n) ? n : 0 }])
      }
    }
  } else {
    return null
  }

  function resolveTargetId(key: string): string | null {
    const t = key.trim()
    if (byId.has(t)) return t
    const nk = normCritKey(t)
    const hit = byNaamNorm.get(nk)
    if (hit) return hit.id
    for (const c of criteria) {
      const cn = normCritKey(c.naam)
      if (cn === nk) return c.id
      if (nk.length >= 4 && cn.length >= 4 && (cn.includes(nk) || nk.includes(cn))) return c.id
    }
    return null
  }

  const out: Record<string, NormalizedCriterionDetail> = {}

  for (const [key, o] of pairs) {
    const targetId = resolveTargetId(key)
    if (!targetId || !byId.has(targetId)) continue

    const c = byId.get(targetId)!
    const scoreRaw = o.score
    let score = 0
    if (typeof scoreRaw === 'number' && Number.isFinite(scoreRaw)) score = scoreRaw
    else if (typeof scoreRaw === 'string' && scoreRaw.trim()) {
      const n = Number(scoreRaw.replace(',', '.'))
      if (Number.isFinite(n)) score = n
    }
    if (score > 100) score = 100
    if (score < -100) score = -100

    const statusRaw = typeof o.status === 'string' ? o.status : ''
    // Derive status from score — don't trust the AI's status string which can contradict
    // the numeric score (e.g. score=40 but status='niet_aanwezig'). Score is the ground truth.
    const scoreDerived = score >= 75 ? 'match' : score >= 25 ? 'gedeeltelijk' : score < 0 ? 'risico' : 'niet_aanwezig'
    const status = scoreDerived

    const row: NormalizedCriterionDetail = {
      score,
      status,
      toelichting: typeof o.toelichting === 'string' ? o.toelichting : '',
      brontekst: typeof o.brontekst === 'string' ? o.brontekst : '',
      criterium_naam: c.naam,
    }

    const prev = out[targetId]
    if (!prev || prev.score < score) {
      out[targetId] = row
    }
  }

  return Object.keys(out).length > 0 ? out : null
}

/** Zelfde semantiek als in de AI-prompt: portal waar de bijlage vandaan komt (niet de bron-config in de app). */
function inferPortalBronFromBronUrl(url: string): 'tenderned' | 'mercell' | 'overig' | null {
  const u = String(url || '').toLowerCase()
  if (!u.trim()) return null
  if (u.includes('mercell') || u.includes('negometrix') || u.includes('s2c.mercell')) return 'mercell'
  if (u.includes('tenderned.nl')) return 'tenderned'
  return 'overig'
}

function bijlageAnalyseFallback(naam: string, portalBronHint: 'tenderned' | 'mercell' | 'overig' | null): BijlageAnalyse {
  const fallbackBron: BijlageAnalyse['bron'] = portalBronHint ?? 'onbekend'
  return {
    naam,
    bron: fallbackBron,
    samenvatting: 'Geen aparte modelanalyse voor deze bijlage.',
    belangrijkste_punten: [],
    risicos: [],
    score: 0,
    uitleg_score: 'Het model heeft geen volledige bijlage-analyse opgeleverd; voer de analyse desgewenst opnieuw uit.',
  }
}

function isUnreadablePlaceholderBijlageBody(body: string): boolean {
  return body.trimStart().startsWith('[Geen leesbare tekst')
}

function bijlageAnalyseFromPlaceholderBody(
  naam: string,
  body: string,
  portalBronHint: 'tenderned' | 'mercell' | 'overig' | null,
): BijlageAnalyse {
  const summary = body.trim().split('\n')[0]?.slice(0, 600) || body.slice(0, 600)
  return {
    naam,
    bron: portalBronHint ?? 'onbekend',
    samenvatting: summary,
    belangrijkste_punten: [],
    risicos: [],
    score: 0,
    uitleg_score:
      'Geen machineleesbare inhoud voor deze bijlage in de app (download, formaat of extractie). Geen inhoudelijke modelscore.',
  }
}

function bijlageAnalyseLlmFailed(
  naam: string,
  err: string,
  portalBronHint: 'tenderned' | 'mercell' | 'overig' | null,
): BijlageAnalyse {
  return {
    naam,
    bron: portalBronHint ?? 'onbekend',
    samenvatting: 'Per-bijlage modelanalyse mislukt.',
    belangrijkste_punten: [],
    risicos: [],
    score: 0,
    uitleg_score: `Technische fout bij per-bijlage analyse: ${err.slice(0, 400)}`,
  }
}

async function runOneBijlageLlm(
  naam: string,
  body: string,
  tenderTitel: string,
  settings: Record<string, string>,
  portalBronHint: 'tenderned' | 'mercell' | 'overig' | null,
): Promise<BijlageAnalyse | null> {
  const prov = settings.ai_provider || 'claude'
  const preferJsonOutput =
    prov === 'ollama' || prov === 'openai' || prov === 'moonshot' || prov === 'kimi_cli'
  const slice =
    body.length > MAX_CHARS_PER_BIJLAGE_LLM
      ? body.slice(0, MAX_CHARS_PER_BIJLAGE_LLM) + '\n[... ingekort voor model ...]'
      : body
  const system = `Je bent een aanbestedingsanalist. Beoordeel uitsluitend de gegeven bijlage voor een inschrijver (aannemer).
Antwoord alleen met geldige JSON, geen markdown, met exact deze sleutels: "samenvatting", "belangrijkste_punten", "risicos", "score", "uitleg_score".
- samenvatting: 3–6 zinnen, Nederlands
- belangrijkste_punten: array van korte strings
- risicos: array van strings (inschrijving/uitvoering)
- score: geheel getal 0–100 (relevantie/kritiek voor inschrijving)
- uitleg_score: minstens twee zinnen`
  const user = `Aanbesteding: ${tenderTitel}\nBijlage: ${naam}\n\nTekst:\n${slice}`
  const response = await aiService.chat(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { preferJsonOutput },
  )
  const { parsed } = parseAnalysisJsonResponse(response)
  if (!parsed) return null
  const punten = Array.isArray(parsed.belangrijkste_punten)
    ? (parsed.belangrijkste_punten as unknown[]).map(x => String(x))
    : []
  const risicos = Array.isArray(parsed.risicos) ? (parsed.risicos as unknown[]).map(x => String(x)) : []
  let score = Number(parsed.score)
  if (!Number.isFinite(score)) score = 50
  score = Math.max(0, Math.min(100, Math.round(score)))
  return {
    naam,
    bron: portalBronHint ?? 'onbekend',
    samenvatting: typeof parsed.samenvatting === 'string' ? parsed.samenvatting : '',
    belangrijkste_punten: punten,
    risicos,
    score,
    uitleg_score: typeof parsed.uitleg_score === 'string' ? parsed.uitleg_score : '',
  }
}

type PerBijlagePassResult =
  | {
      ok: true
      analyses: BijlageAnalyse[]
      modelCallsAttempted: number
      modelCallsOk: number
      modelCallsFailed: number
      skippedUnreadable: number
    }
  | { ok: false; outcome: 'stopped' | 'paused' }

async function runPerBijlageAnalysisPasses(args: {
  tenderId: string
  tender: any
  documentTexts: string[]
  portalBronHint: 'tenderned' | 'mercell' | 'overig' | null
  settings: Record<string, string>
  report: ReportFn
  poll: () => 'pause' | 'stop' | null
}): Promise<PerBijlagePassResult> {
  const { tender, documentTexts, portalBronHint, settings, report, poll } = args
  const results: BijlageAnalyse[] = []
  let modelCallsAttempted = 0
  let modelCallsOk = 0
  let modelCallsFailed = 0
  let skippedUnreadable = 0
  const titel = String(tender?.titel || '')

  for (let batchStart = 0; batchStart < documentTexts.length; batchStart += LLM_CHUNK_EXTRACTION_CONCURRENCY) {
    const px = poll()
    if (px === 'stop') return { ok: false, outcome: 'stopped' }
    if (px === 'pause') return { ok: false, outcome: 'paused' }

    const batchEnd = Math.min(batchStart + LLM_CHUNK_EXTRACTION_CONCURRENCY, documentTexts.length)
    const indices: number[] = []
    for (let i = batchStart; i < batchEnd; i++) indices.push(i)

    const bijlagePct = 86 + Math.round((batchEnd / Math.max(documentTexts.length, 1)) * 12)
    report(
      `Per-bijlage: batch ${batchStart + 1}-${batchEnd}/${documentTexts.length}…`,
      bijlagePct,
      'llm',
    )

    await runWithPeriodicLlmProgress(
      report,
      bijlagePct,
      Math.min(98, bijlagePct + 6),
      (sec) =>
        `Per-bijlage: batch ${batchStart + 1}-${batchEnd}/${documentTexts.length} — nog bezig (${sec}s, parallelle modelcalls)…`,
      async () => {
        const batchOut = await Promise.all(
          indices.map(async (i) => {
            const slice = documentTexts[i]
            const header = extractBijlageHeaderFromSlice(slice)
            if (!header) {
              return bijlageAnalyseFallback(`(onbekend document ${i + 1})`, portalBronHint)
            }
            const { naam, body } = header
            if (isUnreadablePlaceholderBijlageBody(body)) {
              skippedUnreadable++
              return bijlageAnalyseFromPlaceholderBody(naam, body, portalBronHint)
            }
            modelCallsAttempted++
            try {
              const r = await runOneBijlageLlm(naam, body, titel, settings, portalBronHint)
              if (r) {
                modelCallsOk++
                return r
              }
              modelCallsFailed++
              return bijlageAnalyseLlmFailed(naam, 'Geen geldige JSON in modelantwoord.', portalBronHint)
            } catch (e: any) {
              modelCallsFailed++
              return bijlageAnalyseLlmFailed(naam, e?.message || String(e), portalBronHint)
            }
          }),
        )
        results.push(...batchOut)
      },
    )
  }

  return {
    ok: true,
    analyses: results,
    modelCallsAttempted,
    modelCallsOk,
    modelCallsFailed,
    skippedUnreadable,
  }
}

function mergeMainAndPerBijlage(
  fromMain: BijlageAnalyse[],
  perFileOrdered: BijlageAnalyse[],
  allNames: string[],
  portalBronHint: 'tenderned' | 'mercell' | 'overig' | null,
): BijlageAnalyse[] {
  const pfMap = new Map<string, BijlageAnalyse>()
  for (const b of perFileOrdered) {
    if (b?.naam) pfMap.set(normalizeBijlageNameKey(b.naam), b)
  }
  const mainMap = new Map<string, BijlageAnalyse>()
  for (const b of fromMain) {
    mainMap.set(normalizeBijlageNameKey(b.naam), b)
  }
  return allNames.map(canonical => {
    const k = normalizeBijlageNameKey(canonical)
    const pf = pfMap.get(k)
    if (pf) return { ...pf, naam: canonical }
    const m = mainMap.get(k)
    if (m) return { ...m, naam: canonical }
    return bijlageAnalyseFallback(canonical, portalBronHint)
  })
}

function normalizeBijlageAnalyses(
  raw: unknown,
  expectedNames: string[],
  portalBronHint: 'tenderned' | 'mercell' | 'overig' | null
): BijlageAnalyse[] {
  if (!Array.isArray(raw)) {
    return expectedNames.length ? expectedNames.map(n => bijlageAnalyseFallback(n, portalBronHint)) : []
  }
  const byKey = new Map<string, BijlageAnalyse>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const naam = String(o.naam || '').trim()
    if (!naam) continue
    const punten = Array.isArray(o.belangrijkste_punten)
      ? (o.belangrijkste_punten as unknown[]).map(x => String(x))
      : []
    const risicos = Array.isArray(o.risicos) ? (o.risicos as unknown[]).map(x => String(x)) : []
    let score = Number(o.score)
    if (!Number.isFinite(score)) score = 50
    score = Math.max(0, Math.min(100, Math.round(score)))
    const bronRaw = typeof o.bron === 'string' ? o.bron.toLowerCase() : ''
    const bronParsed: BijlageAnalyse['bron'] =
      bronRaw === 'tenderned' || bronRaw === 'mercell' || bronRaw === 'overig' || bronRaw === 'onbekend'
        ? bronRaw
        : undefined
    const row: BijlageAnalyse = {
      naam,
      bron: bronParsed ?? portalBronHint ?? 'onbekend',
      samenvatting: typeof o.samenvatting === 'string' ? o.samenvatting : '',
      belangrijkste_punten: punten,
      risicos,
      score,
      uitleg_score: typeof o.uitleg_score === 'string' ? o.uitleg_score : '',
    }
    const k = normalizeBijlageNameKey(naam)
    const prev = byKey.get(k)
    if (!prev || (row.score ?? 0) > (prev.score ?? 0)) byKey.set(k, row)
  }
  const ordered: BijlageAnalyse[] = []
  for (const canonical of expectedNames) {
    const k = normalizeBijlageNameKey(canonical)
    const hit = byKey.get(k)
    if (hit) ordered.push({ ...hit, naam: canonical })
    else ordered.push(bijlageAnalyseFallback(canonical, portalBronHint))
  }
  return ordered
}

/** Splits documentTexts in chunks van maximaal maxChunkChars tekens elk. */
function splitDocumentsIntoChunks(documentTexts: string[], maxChunkChars: number): string[][] {
  const chunks: string[][] = []
  let cur: string[] = []
  let curChars = 0
  for (const t of documentTexts) {
    if (curChars + t.length > maxChunkChars && cur.length > 0) {
      chunks.push(cur)
      cur = []
      curChars = 0
    }
    cur.push(t)
    curChars += t.length
  }
  if (cur.length > 0) chunks.push(cur)
  return chunks.length > 0 ? chunks : [documentTexts]
}

/**
 * Voert een criteria-only analyse uit op één documentchunk.
 * Geeft het genormaliseerde criteria-object terug, of null bij een fout.
 */
async function runCriteriaChunkAnalysis(
  docChunk: string[],
  chunkIdx: number,
  totalChunks: number,
  tender: any,
  criteria: any[],
  settings: Record<string, string>,
  agentPrompt: string,
  scorerPrompt: string
): Promise<Record<string, NormalizedCriterionDetail> | null> {
  const criteriaList = criteria
    .map((c: any) => `- [ID:${c.id}] ${c.naam}: ${c.beschrijving || ''}`)
    .join('\n')

  const tenderBrief = [
    tender.titel ? `Titel: ${tender.titel}` : '',
    tender.opdrachtgever ? `Opdrachtgever: ${tender.opdrachtgever}` : '',
    tender.beschrijving
      ? `Beschrijving:\n${String(tender.beschrijving || '').slice(0, 1500)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  const docText = docChunk.join('\n')

  const userPrompt = `Beoordeel op basis van de onderstaande aanbestedingsdocumenten (deel ${chunkIdx + 1} van ${totalChunks}) elk criterium. Dit is een tussenstap; de eindscores worden over alle delen samengevoegd.

${tenderBrief}

${docText}

=== CRITERIA (beoordeel op basis van dit deel) ===
${criteriaList}

Geef UITSLUITEND een JSON-object. Elke sleutel onder "criteria" is de EXACTE ID uit [ID:...] (letter voor letter kopiëren, NIET de naam).
Als dit deel geen relevante informatie bevat voor een criterium: score 0, status niet_aanwezig, brontekst "Niet vermeld in dit deel".

{
  "criteria": {
    "<exact_id_uit_[ID:...]>": {
      "score": 0,
      "status": "niet_aanwezig",
      "toelichting": "korte toelichting",
      "brontekst": "letterlijke passage of \\"Niet vermeld in dit deel\\""
    }
  }
}`

  const prov = settings.ai_provider || 'claude'
  const preferJsonOutput =
    prov === 'ollama' || prov === 'openai' || prov === 'moonshot' || prov === 'kimi_cli'

  try {
    const response = await aiService.chat(
      [
        { role: 'system', content: `${agentPrompt}\n\n${scorerPrompt}` },
        { role: 'user', content: userPrompt },
      ],
      { preferJsonOutput }
    )

    const { parsed } = parseAnalysisJsonResponse(response)
    if (!parsed) {
      log.warn(`[analysis] Chunk ${chunkIdx + 1}/${totalChunks}: JSON parse mislukt (responseChars=${response.length})`)
      return null
    }

    const rawCrit =
      parsed.criteria ??
      (parsed as Record<string, unknown>).criteria_scores ??
      (parsed as Record<string, unknown>).criterium_scores
    const critRows = criteria
      .map((c: any) => ({ id: String(c.id || ''), naam: String(c.naam || '') }))
      .filter((c) => c.id.length > 0)

    const result = normalizeModelCriteriaOutput(rawCrit, critRows)
    log.info(
      `[analysis] Chunk ${chunkIdx + 1}/${totalChunks}: ${Object.keys(result || {}).length} criteria gescoord`
    )
    return result
  } catch (e: any) {
    log.warn(`[analysis] Chunk ${chunkIdx + 1}/${totalChunks} mislukt:`, e)
    return null
  }
}

