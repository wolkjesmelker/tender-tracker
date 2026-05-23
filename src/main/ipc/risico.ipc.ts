import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getDb } from '../db/connection'
import { requestDebouncedCloudPush } from '../db/supabase-sync'
import { IPC } from '../../shared/constants'
import { aiService } from '../ai/ai-service'
import {
  fetchBronPaginaDetails,
  downloadAndExtractText,
  findBestLocalStoredFileName,
  readLocalDocumentAndExtractText,
  getSessionPartitionForBronUrl,
  isSkippableOffsiteDocumentUrl,
  resolveCanonicalBronUrlForAnalysis,
} from '../scraping/document-fetcher'
import { expandZipEntriesInDocumentList } from '../scraping/zip-document-expand'
import { omitZipDownloadsWhenPartsAlreadyInList } from '../../shared/document-entry'
import { runRisicoAnalysisCore, buildRisicoChatFnFromConfig } from '../ai/risico-analysis'
import { runRisicoOrchestratorV2 } from '../ai/risico-orchestrator-v2'
import {
  CHUNK_MAX_CHARS_GEMINI,
  CHUNK_MAX_CHARS_CLAUDE,
  CHUNK_MAX_CHARS_OPENAI,
} from '../ai/risico-agents/chunk-utils'
import { deserializeCheckpoint, serializeCheckpoint } from '../ai/risico-agents/checkpoint-utils'
import { broadcastRisicoProgress, broadcastRisicoDraftSnapshot, replayRisicoUiToWebContents } from './risico-progress-broadcast'
import { gateRisicoAttachments, type RisicoAttachment } from '../ai/risico-document-gate'
import { getRisicoRunSnapshot, setRisicoRunState, shiftRisicoWachtrij, tryEnqueueRisicoWachtrij } from './risico-run-state'
import { acquireBusyWorkBlocker, releaseBusyWorkBlocker } from '../utils/busy-work-blocker'
import { preAnalyzeFillableDocuments } from '../ai/document-fill-engine'
import type { Aanbesteding, StoredDocumentEntry } from '../../shared/types'
import log from 'electron-log'

const RISICO_AGENT_LABEL_DEFAULT = 'Kimi (risico-inventarisatie)'

function agentLabelForModel(modelOverride?: string): string {
  if (!modelOverride) return RISICO_AGENT_LABEL_DEFAULT
  if (modelOverride.startsWith('claude-')) return `Claude ${modelOverride} (risico)`
  return `OpenAI ${modelOverride} (risico)`
}

function sendProgress(aanbestedingId: string, step: string, percentage: number, agentLabel = RISICO_AGENT_LABEL_DEFAULT): void {
  broadcastRisicoProgress({ aanbestedingId, step, percentage, agent: agentLabel })
}

/**
 * Eénmalige inventarisatie: na eerste succesvolle run niet opnieuw automatisch starten.
 * Handmatige herstart (IPC) negeert dit en draait altijd.
 */
export function tenderHasRisicoInventarisatie(aanbestedingId: string): boolean {
  const id = String(aanbestedingId || '').trim()
  if (!id) return false
  try {
    const db = getDb()
    const row = db
      .prepare(
        `SELECT TRIM(COALESCE(risico_analyse, '')) AS a, TRIM(COALESCE(risico_analyse_at, '')) AS t
         FROM aanbestedingen WHERE id = ?`,
      )
      .get(id) as { a: string; t: string } | undefined
    if (!row) return false
    return row.a.length > 0 || row.t.length > 0
  } catch (e) {
    log.warn('[risico] tenderHasRisicoInventarisatie: check mislukt', e)
    return false
  }
}

function bijlageSamenvattingMap(tender: any): Map<string, string> {
  const m = new Map<string, string>()
  if (!tender.bijlage_analyses) return m
  try {
    const arr = JSON.parse(tender.bijlage_analyses) as unknown
    if (!Array.isArray(arr)) return m
    for (const b of arr as { naam?: string; samenvatting?: string }[]) {
      if (b?.naam != null && b.samenvatting) {
        m.set(String(b.naam).trim().toLowerCase(), String(b.samenvatting))
      }
    }
  } catch {
    /* ignore */
  }
  return m
}

/**
 * @param allowDocDownload — false na voltooide AI-analyse: alleen lokale bestanden (geen netwerk-downloads in risico-stap).
 * @param onProgress — optioneel: voortgang 6–18 % tijdens I/O (documenten, ZIP, bron); daarna documentselectie.
 */
async function collectDocumentTexts(
  tender: any,
  allowDocDownload: boolean,
  onProgress?: (step: string, percentage: number) => void,
): Promise<string[]> {
  const coreBlocks: string[] = []
  const attachments: RisicoAttachment[] = []
  const summaryMap = bijlageSamenvattingMap(tender)

  if (tender.beschrijving) {
    coreBlocks.push(`Aanbestedingsbeschrijving:\n${tender.beschrijving}`)
  }
  if (tender.ruwe_tekst) {
    coreBlocks.push(`Ruwe tekst bronpagina:\n${tender.ruwe_tekst}`)
  }
  if (tender.beschrijving || tender.ruwe_tekst) {
    onProgress?.('Context: beschrijving en opgeslagen bronpagina toegevoegd', 6)
  }

  // Bronpagina alleen opnieuw ophalen als er nog geen opgeslagen tekst is
  let sessionPartition: string | undefined
  const heeftBronTekst = (tender.ruwe_tekst?.length ?? 0) > 200
  if (tender.bron_url && !heeftBronTekst) {
    try {
      onProgress?.('Bronpagina ophalen voor risico-context…', 7)
      const resolvedUrl = resolveCanonicalBronUrlForAnalysis(String(tender.bron_url))
      sessionPartition = getSessionPartitionForBronUrl(resolvedUrl)
      const details = await fetchBronPaginaDetails(resolvedUrl, {
        tenderId: String(tender.id || ''),
      })
      if (details.volledigeTekst?.trim()) {
        coreBlocks.push(`Bronpagina inhoud:\n${details.volledigeTekst.slice(0, 40_000)}`)
      }
    } catch (e) {
      log.warn('[risico] fetchBronPaginaDetails fout:', e)
    }
  } else if (tender.bron_url) {
    // Haal alleen de sessionPartition op voor eventuele document-downloads
    try {
      const resolvedUrl = resolveCanonicalBronUrlForAnalysis(String(tender.bron_url))
      sessionPartition = getSessionPartitionForBronUrl(resolvedUrl)
    } catch { /* ignore */ }
  }

  let dbDocs: StoredDocumentEntry[] = []
  if (tender.document_urls) {
    try {
      const parsed = JSON.parse(tender.document_urls) as StoredDocumentEntry[]
      dbDocs = Array.isArray(parsed) ? parsed : []
    } catch { /* ignore */ }
  }

  try {
    onProgress?.('Documentenlijst uitbreiden (ZIP-onderdelen indien aanwezig)…', 8)
    const docInfos = dbDocs.map((d) => ({
      url: d.url || '',
      naam: d.naam,
      type: d.type,
      localNaam: d.localNaam,
      bronZipLabel: d.bronZipLabel,
    }))
    let bronHint: string | undefined
    if (tender.bron_url) {
      try {
        bronHint = resolveCanonicalBronUrlForAnalysis(String(tender.bron_url))
      } catch {
        bronHint = undefined
      }
    }
    const expanded = await expandZipEntriesInDocumentList(
      String(tender.id),
      docInfos,
      sessionPartition,
      bronHint
    )
    dbDocs = expanded.map((d) => ({
      url: d.url,
      naam: d.naam,
      type: d.type,
      localNaam: d.localNaam,
      bronZipLabel: d.bronZipLabel,
    })) as StoredDocumentEntry[]
  } catch {
    /* ignore */
  }

  const mergedDocs = omitZipDownloadsWhenPartsAlreadyInList(dbDocs)

  const docTargets = mergedDocs.filter(
    (d) => !(!d.localNaam?.trim() && isSkippableOffsiteDocumentUrl(d.url || '')),
  )
  const nTargets = docTargets.length
  let docIdx = 0

  for (const doc of mergedDocs) {
    if (!doc.localNaam?.trim() && isSkippableOffsiteDocumentUrl(doc.url || '')) continue

    docIdx++
    if (nTargets > 0) {
      onProgress?.(
        `Document ${docIdx}/${nTargets}: ${String(doc.naam || 'zonder naam').slice(0, 72)}`,
        8 + Math.round((docIdx / nTargets) * 10),
      )
    }

    let text = ''
    if (doc.localNaam?.trim()) {
      try {
        text = await readLocalDocumentAndExtractText(tender.id, doc.localNaam.trim(), doc.naam)
      } catch (e) {
        log.warn(`[risico] lokaal document lezen mislukt: ${doc.localNaam}`, e)
      }
    }
    if (!text || text.length <= 20) {
      const pick = findBestLocalStoredFileName(String(tender.id), doc.naam || '', doc.localNaam?.trim())
      if (pick && pick !== doc.localNaam?.trim()) {
        try {
          text = await readLocalDocumentAndExtractText(tender.id, pick, doc.naam)
        } catch (e) {
          log.warn(`[risico] lokaal document (gevonden op schijf) lezen mislukt: ${pick}`, e)
        }
      }
    }
    if (
      allowDocDownload &&
      (!text || text.length <= 20) &&
      doc.url?.trim() &&
      !isSkippableOffsiteDocumentUrl(doc.url)
    ) {
      try {
        onProgress?.(
          `Document downloaden: ${String(doc.naam || doc.url).slice(0, 72)}`,
          8 + Math.round((docIdx / nTargets) * 10),
        )
        const r = await downloadAndExtractText(doc.url, doc.naam, tender.id, sessionPartition, {
          preferredLocalNaam: doc.localNaam?.trim(),
        })
        text = r.text
      } catch (e) {
        log.warn(`[risico] document downloaden mislukt: ${doc.naam}`, e)
      }
    }
    if (text && text.length > 20) {
      const naam = String(doc.naam || 'zonder naam')
      const sam = summaryMap.get(naam.trim().toLowerCase())
      attachments.push({
        naam,
        type: doc.type,
        text: text.slice(0, 60_000),
        samenvatting: sam,
      })
    }
  }

  onProgress?.('Documentselectie: bepalen welke bijlagen risico-relevant zijn…', 18)
  const gate = await gateRisicoAttachments(attachments)
  if (gate.excluded.length > 0) {
    log.info(
      `[risico] Documentgate: ${gate.included.length}/${attachments.length} bijlagen mee; uitgesloten: ${gate.excluded
        .map((e) => e.naam)
        .join(', ')
        .slice(0, 400)}${gate.fallbackAllAttachments ? ' (fallback alles)' : ''}`,
    )
  }
  onProgress?.(
    `Documentselectie: ${gate.included.length} van ${attachments.length} bijlagen meegenomen voor risico-analyse`,
    19,
  )

  const documentTexts: string[] = [...coreBlocks]
  for (const a of gate.included) {
    documentTexts.push(`Document: ${a.naam}\n${a.text}`)
  }

  if (tender.bijlage_analyses) {
    try {
      const bijlagen = JSON.parse(tender.bijlage_analyses)
      if (Array.isArray(bijlagen) && bijlagen.length > 0) {
        onProgress?.('AI-samenvattingen per bijlage toevoegen…', 19)
        const summaries = bijlagen.map((b: any) => `Bijlage "${b.naam}": ${b.samenvatting}`).join('\n')
        documentTexts.push(`AI-samenvatting per bijlage:\n${summaries}`)
      }
    } catch {
      /* ignore */
    }
  }

  return documentTexts
}

function finishRisicoRun(): void {
  setRisicoRunState(false, null)
}

async function performRisicoInventarisatie(
  aanbestedingId: string,
  allowDocDownload: boolean,
  modelOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  const db = getDb()
  const tender = db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(aanbestedingId) as any
  if (!tender) {
    return { success: false, error: 'Aanbesteding niet gevonden' }
  }

  const settings = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
  const settingsMap: Record<string, string> = {}
  settings.forEach((s) => { settingsMap[s.key] = s.value })
  aiService.configure(settingsMap)

  const agentLabel = agentLabelForModel(modelOverride)
  const progress = (step: string, pct: number) => sendProgress(aanbestedingId, step, pct, agentLabel)

  const isClaudeOverride = !!(modelOverride?.startsWith('claude-'))
  const isOpenAIOverride = !!modelOverride && !isClaudeOverride

  // Resolve Claude API key
  let claudeApiKey: string | undefined
  if (isClaudeOverride) {
    const mainProviderKey = settingsMap.ai_provider === 'claude'
      ? (settingsMap.ai_api_key || '').trim()
      : ''
    const dedicatedKey = (settingsMap.anthropic_api_key || '').trim()
    claudeApiKey = mainProviderKey || dedicatedKey || undefined
    if (!claudeApiKey) {
      return {
        success: false,
        error: 'Geen Anthropic API-sleutel gevonden. Stel Claude in als AI-provider via Instellingen, of voeg een Anthropic API-sleutel toe.',
      }
    }
  }

  // Resolve OpenAI API key
  let openaiApiKey: string | undefined
  if (isOpenAIOverride) {
    const mainProviderKey = settingsMap.ai_provider === 'openai'
      ? (settingsMap.ai_api_key || '').trim()
      : ''
    const detectionKey = (settingsMap.openai_detection_api_key || '').trim()
    openaiApiKey = mainProviderKey || detectionKey || undefined
    if (!openaiApiKey) {
      return {
        success: false,
        error: 'Geen OpenAI API-sleutel gevonden. Stel OpenAI in als AI-provider via Instellingen.',
      }
    }
  }

  // Default provider availability check (no override)
  if (!modelOverride) {
    const isAvailable = await aiService.isAvailable()
    if (!isAvailable) {
      return { success: false, error: 'AI service is niet beschikbaar. Controleer je API-sleutel en instellingen.' }
    }
  }

  progress('Documenten voor risico-inventarisatie laden…', 5)
  const documentTexts = await collectDocumentTexts(tender, allowDocDownload, (step, pct) =>
    progress(step, pct),
  )

  if (documentTexts.length === 0) {
    progress('Geen documenttekst beschikbaar voor risico-analyse', 100)
    return { success: false, error: 'Geen documenten beschikbaar voor risico-analyse.' }
  }

  const totalChars = documentTexts.reduce((s, t) => s + t.length, 0)
  progress(
    `${documentTexts.length} bron(nen) geladen (${Math.round(totalChars / 1000)}k tekens). AI-fase starten…`,
    20,
  )

  const isGeminiMain = (settingsMap.ai_provider || '').trim() === 'gemini'
  const risicoConfig = {
    moonshotApiKey: (settingsMap.moonshot_api_key || '').trim() || undefined,
    moonshotBaseUrl: (settingsMap.moonshot_api_base || '').trim() || undefined,
    geminiApiKey: isGeminiMain ? (settingsMap.ai_api_key || '').trim() || undefined : undefined,
    geminiModel: isGeminiMain ? (settingsMap.ai_model || 'gemini-2.5-flash').trim() : undefined,
    openaiModelOverride: isOpenAIOverride ? modelOverride : undefined,
    openaiApiKey: isOpenAIOverride ? openaiApiKey : undefined,
    claudeModelOverride: isClaudeOverride ? modelOverride : undefined,
    claudeApiKey: isClaudeOverride ? claudeApiKey : undefined,
    onProgress: (step: string, percentage: number) => progress(step, percentage),
  }

  const result = await runRisicoAnalysisCore(tender, documentTexts, risicoConfig)

  if (!result) {
    progress('Risico-analyse mislukt (ongeldige AI-respons)', 100)
    return { success: false, error: 'De AI heeft geen geldige risico-analyse teruggegeven. Probeer opnieuw.' }
  }

  progress('Risico-analyse opslaan…', 90)
  db.prepare(`
    UPDATE aanbestedingen
    SET risico_analyse = ?, risico_analyse_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(result), aanbestedingId)

  requestDebouncedCloudPush()

  // Pre-analyseer invulbare documenten zodat de agent direct kan starten
  try {
    const tenderForPrefill = db
      .prepare('SELECT * FROM aanbestedingen WHERE id = ?')
      .get(aanbestedingId) as Aanbesteding | undefined
    if (tenderForPrefill) {
      await preAnalyzeFillableDocuments({
        tender: tenderForPrefill,
        startPct: 92,
        endPct: 99,
        onProgress: (step, pct) => progress(step, pct),
      })
    }
  } catch (e) {
    log.warn('[risico] pre-analyse van invulbare documenten gefaald (niet-blokkerend):', e)
  }

  progress('Risico-inventarisatie + agent pre-analyse voltooid', 100)
  log.info(`[risico] Inventarisatie voltooid voor ${aanbestedingId}: overall=${result.overall_score}`)
  return { success: true }
}

/**
 * Direct na een voltooide hoofd-AI-analyse (zelfde sessie, sequentieel — geen parallelle IPC-risico).
 * Gebruikt alleen lokaal opgeslagen documenten; geen globale risico-wachtrijstatus.
 * Als er al inventarisatie is: geen tweede automatische run (handmatig via RISICO_START wél).
 */
export async function runRisicoAfterMainAnalysis(
  aanbestedingId: string,
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  if (tenderHasRisicoInventarisatie(aanbestedingId)) {
    log.info(`[risico] Auto-inventarisatie overgeslagen: bestaat al voor ${aanbestedingId}`)
    return { success: true, skipped: true }
  }
  acquireBusyWorkBlocker('risico-analyse')
  try {
    try {
      return await performRisicoInventarisatie(aanbestedingId, false)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('[risico] Keten na hoofdanalyse:', e)
      sendProgress(aanbestedingId, `Risico-analyse fout: ${msg.slice(0, 120)}`, 100)
      return { success: false, error: msg }
    }
  } finally {
    releaseBusyWorkBlocker('risico-analyse')
  }
}

async function runRisicoAnalysisJob(
  aanbestedingId: string,
  modelOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  let runGemarkeerd = false
  let returnValue: { success: boolean; error?: string } = { success: false, error: 'Onbekende fout' }
  try {
    runGemarkeerd = true
    setRisicoRunState(true, aanbestedingId)
    acquireBusyWorkBlocker('risico-analyse')
    try {
      returnValue = await performRisicoInventarisatie(aanbestedingId, true, modelOverride)
      return returnValue
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('[risico] Analyse fout:', e)
      sendProgress(aanbestedingId, `Risico-analyse fout: ${msg.slice(0, 120)}`, 100, agentLabelForModel(modelOverride))
      returnValue = { success: false, error: msg }
      return returnValue
    } finally {
      releaseBusyWorkBlocker('risico-analyse')
    }
  } finally {
    if (runGemarkeerd) {
      finishRisicoRun()
    }
    const next = shiftRisicoWachtrij()
    if (next) {
      void runRisicoAnalysisJob(next).catch((err) => log.error('[risico] Wachtrij-job fout:', err))
    }
  }
}

/** Gedeelde guard-logica voor RISICO_START en RISICO_START_WITH_MODEL. */
async function startRisicoJob(
  aanbestedingId: string,
  modelOverride?: string,
): Promise<{ success: boolean; error?: string; alreadyRunning?: boolean; queued?: boolean; position?: number; duplicateInQueue?: boolean }> {
  const { isAnalysisPipelineBusy, tenderHasStoredAiScore } = await import('./analysis.ipc')
  if (isAnalysisPipelineBusy()) {
    return {
      success: false,
      error:
        'Er loopt nog een AI-analyse of batch. Wacht tot die klaar is. Daarna: bij geen bestaande inventarisatie start die automatisch na de analyse; anders gebruik je de knop Nieuwe risico.',
    }
  }

  const db = getDb()
  const tender = db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(aanbestedingId) as any
  if (!tender) {
    return { success: false, error: 'Aanbesteding niet gevonden' }
  }

  if (!tenderHasStoredAiScore(tender)) {
    return {
      success: false,
      error:
        'Voer eerst de AI-analyse uit. Risico-inventarisatie gebruikt dezelfde lokale documenten. De eerste keer start die automatisch na de analyse (als die nog niet bestaat); daarna alleen via de knop Nieuwe risico.',
    }
  }

  const snap = getRisicoRunSnapshot()
  if (snap.running) {
    const enq = tryEnqueueRisicoWachtrij(aanbestedingId, snap.aanbestedingId)
    if (enq.alreadyActive) {
      return { success: true, alreadyRunning: true }
    }
    if (!enq.ok) {
      return { success: false, error: 'Kon niet in wachtrij plaatsen.' }
    }
    log.info(`[risico] In wachtrij (${enq.position}): ${aanbestedingId}`)
    return { success: true, queued: true, position: enq.position, duplicateInQueue: enq.duplicateInQueue }
  }

  return runRisicoAnalysisJob(aanbestedingId, modelOverride)
}

/** Voert de agentic V2 risico-inventarisatie uit en slaat op in risico_analyse_v2. */
async function performRisicoInventarisatieV2(
  aanbestedingId: string,
  modelOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  const db = getDb()
  const tender = db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(aanbestedingId) as any
  if (!tender) return { success: false, error: 'Aanbesteding niet gevonden' }

  const settings = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
  const settingsMap: Record<string, string> = {}
  settings.forEach((s) => { settingsMap[s.key] = s.value })
  aiService.configure(settingsMap)

  const agentLabel = modelOverride ? agentLabelForModel(modelOverride) : 'Agentic (19 agents)'
  const progress = (step: string, pct: number) => sendProgress(aanbestedingId, step, pct, agentLabel)

  const isClaudeOverride = !!(modelOverride?.startsWith('claude-'))
  const isOpenAIOverride = !!modelOverride && !isClaudeOverride

  let claudeApiKey: string | undefined
  if (isClaudeOverride) {
    const mainKey = settingsMap.ai_provider === 'claude' ? (settingsMap.ai_api_key || '').trim() : ''
    claudeApiKey = mainKey || (settingsMap.anthropic_api_key || '').trim() || undefined
    if (!claudeApiKey) return { success: false, error: 'Geen Anthropic API-sleutel gevonden.' }
  }

  let openaiApiKey: string | undefined
  if (isOpenAIOverride) {
    const mainKey = settingsMap.ai_provider === 'openai' ? (settingsMap.ai_api_key || '').trim() : ''
    openaiApiKey = mainKey || (settingsMap.openai_detection_api_key || '').trim() || undefined
    if (!openaiApiKey) return { success: false, error: 'Geen OpenAI API-sleutel gevonden.' }
  }

  if (!modelOverride) {
    const isAvailable = await aiService.isAvailable()
    if (!isAvailable) return { success: false, error: 'AI service is niet beschikbaar.' }
  }

  progress('Agentic V2: documenten laden…', 3)
  const documentTexts = await collectDocumentTexts(tender, true, (step, pct) => progress(step, pct))
  if (documentTexts.length === 0) {
    progress('Geen documenten beschikbaar', 100)
    return { success: false, error: 'Geen documenten beschikbaar voor risico-analyse.' }
  }

  // Volledige tekst doorgeven — de orchestrator handelt chunking intern af
  // als de totale tekst de context-limiet van het model overschrijdt.
  const combinedText = documentTexts.join('\n\n---\n\n')
  log.info(`[risico-v2] Documenten geladen: ${Math.round(combinedText.length / 1000)}K tekens totaal (${documentTexts.length} docs)`)
  const isGeminiMainV2 = (settingsMap.ai_provider || '').trim() === 'gemini'
  const chatFn = buildRisicoChatFnFromConfig({
    moonshotApiKey: (settingsMap.moonshot_api_key || '').trim() || undefined,
    moonshotBaseUrl: (settingsMap.moonshot_api_base || '').trim() || undefined,
    geminiApiKey: isGeminiMainV2 ? (settingsMap.ai_api_key || '').trim() || undefined : undefined,
    geminiModel: isGeminiMainV2 ? (settingsMap.ai_model || 'gemini-2.5-flash').trim() : undefined,
    openaiModelOverride: isOpenAIOverride ? modelOverride : undefined,
    openaiApiKey: isOpenAIOverride ? openaiApiKey : undefined,
    claudeModelOverride: isClaudeOverride ? modelOverride : undefined,
    claudeApiKey: isClaudeOverride ? claudeApiKey : undefined,
  })

  // Kies chunk-grootte passend bij de context van het actieve model.
  // Gemini heeft 1M tokens (≈3,5M tekens) — vrijwel elk dossier past in één chunk.
  // Claude heeft 200K tokens (≈600K tekens), OpenAI 128K (≈380K tekens).
  const chunkMaxChars = isGeminiMainV2
    ? CHUNK_MAX_CHARS_GEMINI
    : isClaudeOverride
      ? CHUNK_MAX_CHARS_CLAUDE
      : isOpenAIOverride
        ? CHUNK_MAX_CHARS_OPENAI
        : undefined // Kimi/fallback: gebruik de default uit chunk-utils

  if (chunkMaxChars) {
    log.info(`[risico-v2] Chunk-limiet voor model: ${Math.round(chunkMaxChars / 1000)}K tekens`)
  }

  // Laad bestaand checkpoint (als vorige run halverwege afbrak)
  const existingRow = db.prepare('SELECT risico_analyse_v2_checkpoint FROM aanbestedingen WHERE id = ?').get(aanbestedingId) as { risico_analyse_v2_checkpoint?: string | null } | undefined
  const checkpoint = deserializeCheckpoint(existingRow?.risico_analyse_v2_checkpoint)
  if (checkpoint) {
    const stagesCompleted = [
      checkpoint.stage1a ? '1a' : null,
      checkpoint.stage1b ? '1b' : null,
      checkpoint.stage2 ? '2' : null,
      checkpoint.stage3 ? '3' : null,
      checkpoint.stage4a ? '4a' : null,
    ].filter(Boolean)
    log.info(`[risico-v2] Checkpoint gevonden — herstarten vanaf stage. Voltooid: ${stagesCompleted.join(', ')}`)
    progress(`Checkpoint gevonden — herstarten na stage ${stagesCompleted[stagesCompleted.length - 1] ?? '?'}`, 4)
  }

  // Sla checkpoint op na elke stage en broadcast de assembledDraft naar de renderer
  function handleCheckpointSave(cp: import('./risico-agents/checkpoint-utils').RisicoV2Checkpoint): void {
    try {
      db.prepare('UPDATE aanbestedingen SET risico_analyse_v2_checkpoint = ? WHERE id = ?')
        .run(serializeCheckpoint(cp), aanbestedingId)
    } catch (e) {
      log.warn('[risico-v2] Checkpoint opslaan mislukt (niet-blokkerend):', e)
    }
    if (cp.assembledDraft && cp.assembledDraftStage) {
      broadcastRisicoDraftSnapshot({
        aanbestedingId,
        assembledDraftStage: cp.assembledDraftStage,
        assembledDraftSavedAt: cp.assembledDraftSavedAt ?? new Date().toISOString(),
        assembledDraft: cp.assembledDraft,
      })
    }
  }

  try {
    const result = await runRisicoOrchestratorV2(chatFn, combinedText, (step, pct) => progress(step, pct), chunkMaxChars, checkpoint, handleCheckpointSave)

    progress('Agentic V2: resultaat opslaan…', 99)
    db.prepare(`
      UPDATE aanbestedingen
      SET risico_analyse_v2 = ?, risico_analyse_v2_checkpoint = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(result), aanbestedingId)

    requestDebouncedCloudPush()
    progress('Agentic V2 risico-inventarisatie voltooid', 100)
    log.info(`[risico-v2] Voltooid voor ${aanbestedingId}: overall=${result.overall_score}`)
    return { success: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    log.error('[risico-v2] Analyse fout:', e)
    progress(`Agentic V2 fout: ${msg.slice(0, 120)}`, 100)
    return { success: false, error: msg }
  }
}

async function startRisicoV2Job(
  aanbestedingId: string,
  modelOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  const snap = getRisicoRunSnapshot()
  if (snap.running) {
    return { success: false, error: 'Er loopt al een risico-analyse. Wacht tot die klaar is.' }
  }

  let returnValue: { success: boolean; error?: string } = { success: false, error: 'Onbekende fout' }
  setRisicoRunState(true, aanbestedingId)
  acquireBusyWorkBlocker('risico-analyse')
  try {
    returnValue = await performRisicoInventarisatieV2(aanbestedingId, modelOverride)
    return returnValue
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    log.error('[risico-v2] Job fout:', e)
    sendProgress(aanbestedingId, `Agentic V2 fout: ${msg.slice(0, 120)}`, 100, 'Agentic (19 agents)')
    returnValue = { success: false, error: msg }
    return returnValue
  } finally {
    releaseBusyWorkBlocker('risico-analyse')
    finishRisicoRun()
    const next = shiftRisicoWachtrij()
    if (next) {
      void runRisicoAnalysisJob(next).catch((err) => log.error('[risico] Wachtrij-job fout:', err))
    }
  }
}

export function registerRisicoHandlers(): void {
  ipcMain.handle(IPC.RISICO_UI_REPLAY, (event) => {
    replayRisicoUiToWebContents(event.sender)
    return undefined
  })

  ipcMain.handle(IPC.RISICO_START, async (_event, aanbestedingId: string) => {
    return startRisicoJob(aanbestedingId)
  })

  ipcMain.handle(IPC.RISICO_START_WITH_MODEL, async (_event, aanbestedingId: string, modelOverride: string) => {
    if (!modelOverride?.trim()) {
      return { success: false, error: 'Geen model opgegeven.' }
    }
    log.info(`[risico] RISICO_START_WITH_MODEL: aanbestedingId=${aanbestedingId} model=${modelOverride}`)
    return startRisicoJob(aanbestedingId, modelOverride.trim())
  })

  ipcMain.handle(IPC.RISICO_START_V2, async (_event, aanbestedingId: string, modelOverride?: string) => {
    log.info(`[risico] RISICO_START_V2: aanbestedingId=${aanbestedingId} model=${modelOverride ?? 'default'}`)
    return startRisicoV2Job(aanbestedingId, modelOverride)
  })

  // Renderer haalt checkpoint-draft op bij mount (als er al een run loopt of was)
  ipcMain.handle(IPC.RISICO_FETCH_CHECKPOINT_DRAFT, (_event, aanbestedingId: string) => {
    try {
      const db = getDb()
      const row = db.prepare('SELECT risico_analyse_v2_checkpoint FROM aanbestedingen WHERE id = ?').get(aanbestedingId) as { risico_analyse_v2_checkpoint?: string | null } | undefined
      const cp = deserializeCheckpoint(row?.risico_analyse_v2_checkpoint)
      if (!cp?.assembledDraft || !cp.assembledDraftStage) return null
      return {
        aanbestedingId,
        assembledDraftStage: cp.assembledDraftStage,
        assembledDraftSavedAt: cp.assembledDraftSavedAt ?? '',
        assembledDraft: cp.assembledDraft,
      }
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.RISICO_SAVE_HTML, async (event, payload: { html: string; filename: string }) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: 'Risico-inventarisatie opslaan als HTML',
      defaultPath: payload.filename || 'risico-inventarisatie.html',
      filters: [{ name: 'HTML-bestand', extensions: ['html'] }],
    })
    if (canceled || !filePath) return { success: false, cancelled: true }
    try {
      await writeFile(filePath, payload.html, 'utf-8')
      log.info(`[risico] HTML opgeslagen: ${filePath}`)
      return { success: true, filePath }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('[risico] HTML opslaan mislukt:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(IPC.RISICO_SAVE_PDF, async (event, payload: { html: string; filename: string }) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: 'Risico-inventarisatie opslaan als PDF',
      defaultPath: payload.filename || 'risico-inventarisatie.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { success: false, cancelled: true }

    const tmpPath = join(app.getPath('temp'), `risico-pdf-${randomUUID()}.html`)
    let pdfWin: BrowserWindow | null = null
    try {
      await writeFile(tmpPath, payload.html, 'utf-8')
      pdfWin = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      })
      await pdfWin.loadFile(tmpPath)
      await pdfWin.webContents.executeJavaScript(
        `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`,
      )
      const pdfData = await pdfWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'default' },
      })
      await writeFile(filePath, pdfData)
      log.info(`[risico] PDF opgeslagen: ${filePath}`)
      return { success: true, filePath }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('[risico] PDF opslaan mislukt:', e)
      return { success: false, error: msg }
    } finally {
      pdfWin?.destroy()
      await unlink(tmpPath).catch(() => {})
    }
  })
}
