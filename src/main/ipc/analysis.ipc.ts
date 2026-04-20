import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'
import {
  runAnalysis,
  isAnalysisPaused,
  isAnalysisStopped,
} from '../ai/analysis-pipeline'
import {
  analysisControlBegin,
  analysisControlReset,
  analysisControlRequestPause,
  analysisControlRequestStop,
} from '../ai/analysis-control'
import {
  clearAnalysisCheckpoint,
  computeCurrentAnalysisConfigFingerprint,
  loadAnalysisCheckpoint,
} from '../ai/analysis-checkpoint'
import { getRisicoRunSnapshot } from './risico-run-state'
import { broadcastAnalysisProgress, replayAnalysisUiToWebContents } from './analysis-progress-broadcast'
import { setSingleAnalysisRunState, setBatchAnalysisRunState } from './analysis-run-state'
import log from 'electron-log'
import type { AnalysisResult, AiExtractedTenderFields } from '../../shared/types'

/** Vul alleen lege kolommen vanuit AI-velden (bron blijft leidend). */
function mergeAiExtractedIntoColumns(aanbestedingId: string, velden: AiExtractedTenderFields | undefined): void {
  if (!velden) return
  const db = getDb()
  const row = db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(aanbestedingId) as Record<string, unknown> | undefined
  if (!row) return

  const empty = (v: unknown) => v == null || String(v).trim() === ''
  const sets: string[] = []
  const vals: unknown[] = []

  const setIfEmpty = (col: string, value: string | undefined) => {
    if (!value?.trim() || !empty(row[col])) return
    sets.push(`${col} = ?`)
    vals.push(value.trim())
  }

  setIfEmpty('opdrachtgever', velden.opdrachtgever)
  setIfEmpty('publicatiedatum', velden.publicatiedatum)
  setIfEmpty('sluitingsdatum', velden.sluitingsdatum_inschrijving)
  setIfEmpty('referentienummer', velden.referentienummer)
  setIfEmpty('type_opdracht', velden.type_opdracht)
  setIfEmpty('geraamde_waarde', velden.geraamde_waarde)
  if (!empty(velden.locatie_of_regio) && empty(row.regio)) {
    sets.push('regio = ?')
    vals.push(String(velden.locatie_of_regio).trim())
  }

  if (sets.length > 0) {
    db.prepare(`UPDATE aanbestedingen SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, aanbestedingId)
  }
}

function persistAnalysisResult(aanbestedingId: string, result: AnalysisResult): void {
  const db = getDb()
  db.prepare(`
    UPDATE aanbestedingen SET
      ai_samenvatting = ?, ai_antwoorden = ?, criteria_scores = ?,
      totaal_score = ?, match_uitleg = ?, relevantie_score = ?,
      bijlage_analyses = ?, ai_extracted_fields = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    result.samenvatting,
    JSON.stringify(result.antwoorden),
    JSON.stringify(result.criteria_scores),
    result.totaal_score,
    result.match_uitleg,
    result.relevantie_score,
    JSON.stringify(result.bijlage_analyses ?? []),
    JSON.stringify(result.tender_velden ?? {}),
    aanbestedingId
  )
  mergeAiExtractedIntoColumns(aanbestedingId, result.tender_velden)
}

// Track running batch analysis in main process (persists across page navigations)
let batchState: {
  running: boolean
  ids: string[]
  current: number
  total: number
  currentId: string
  currentTitle: string
  errors: string[]
  skippedAlreadyScored: number
  analyzedOk: number
} = {
  running: false,
  ids: [],
  current: 0,
  total: 0,
  currentId: '',
  currentTitle: '',
  errors: [],
  skippedAlreadyScored: 0,
  analyzedOk: 0,
}

/** Na een scrape: ID’s wachten tot er geen losse/batch-analyse meer loopt, daarna `runBatchAnalysisForIds`. */
let pendingPostScrapeIds: string[] = []

/** Losse analyse vanuit detailpagina — wederzijds exclusief met batch. */
let singleAnalysisRunning = false
/** Huidige aanbesteding bij losse analyse (voor UI na navigatie). */
let singleAnalysisAanbestedingId: string | null = null
/** FIFO: detailpagina-start terwijl batch of andere losse analyse loopt. */
let pendingSingleAnalysisIds: string[] = []

/** Voorkomt dat meerdere `kickBackgroundQueues`-aanroepen tegelijk de wachtrij verwerken. */
let backgroundQueueProcessorRunning = false

function mergePostScrapePendingIds(ids: string[]): void {
  const seen = new Set(pendingPostScrapeIds)
  for (const id of ids) {
    if (id?.trim() && !seen.has(id)) {
      seen.add(id)
      pendingPostScrapeIds.push(id)
    }
  }
}

/**
 * Na elke scrape (handmatig of schema): volledige AI-analyse, daarna sequentieel risico-inventarisatie.
 * Blokkeert niet: draait op de achtergrond; vult een wachtrij als er al een analyse loopt.
 */
export function enqueuePostScrapeAnalysis(aanbestedingIds: string[]): void {
  if (!aanbestedingIds?.length) return
  mergePostScrapePendingIds(aanbestedingIds)
  log.info(
    `Post-scrape AI (incl. risico): ${aanbestedingIds.length} aanbesteding(en) — wachtrij ${pendingPostScrapeIds.length} totaal`
  )
  kickBackgroundQueues()
}

/**
 * Batch: overslaan alleen bij een “afgeronde” score > 0, óf bij 0 mét een echte samenvatting
 * (geen blokkeer-/parsefouttekst). Anders: `totaal_score === 0` door geblokkeerde analyse of Gemma-parse
 * telt niet als “al gescoord” — anders wordt batch ten onrechte overgeslagen en zie je geen nieuwe analyse.
 */
export function tenderHasStoredAiScore(tender: { totaal_score?: unknown; ai_samenvatting?: string | null }): boolean {
  const s = tender?.totaal_score
  if (s === null || s === undefined || !Number.isFinite(Number(s))) return false
  const n = Number(s)
  if (n > 0) return true
  const txt = String(tender?.ai_samenvatting || '').trim()
  if (!txt) return false
  const low = txt.toLowerCase()
  if (
    low.includes('analyse kon niet') ||
    low.includes('analyse niet mogelijk') ||
    low.includes('geen json-object') ||
    low.includes('parsefout') ||
    low.includes('geblokkeerd') ||
    (low.includes('ongeldig') && low.includes('json'))
  ) {
    return false
  }
  return true
}

/** Voor risico-IPC: geen parallelle inventarisatie tijdens analyse/batch. */
export function isAnalysisPipelineBusy(): boolean {
  return singleAnalysisRunning || batchState.running
}

/** Snapshot voor interne AI-diagnose (geen gevoelige inhoud). */
export type AnalysisPipelineDiagnosticsSnapshot = {
  batchRunning: boolean
  batchCurrent: number
  batchTotal: number
  batchCurrentId: string
  batchCurrentTitle: string
  singleRunning: boolean
  singleAnalysisId: string | null
  pendingSingleAnalysisIds: string[]
  pendingPostScrapeIdsCount: number
  analysisPipelineBusy: boolean
}

export function getAnalysisPipelineDiagnosticsSnapshot(): AnalysisPipelineDiagnosticsSnapshot {
  return {
    batchRunning: batchState.running,
    batchCurrent: batchState.current,
    batchTotal: batchState.total,
    batchCurrentId: batchState.currentId,
    batchCurrentTitle: batchState.currentTitle,
    singleRunning: singleAnalysisRunning,
    singleAnalysisId: singleAnalysisAanbestedingId,
    pendingSingleAnalysisIds: [...pendingSingleAnalysisIds],
    pendingPostScrapeIdsCount: pendingPostScrapeIds.length,
    analysisPipelineBusy: singleAnalysisRunning || batchState.running,
  }
}

function kickBackgroundQueues(): void {
  void processBackgroundAnalysisQueues().catch((e) => log.error('[analysis] Achtergrond-wachtrij:', e))
}

/**
 * Wachtrij: eerst alle losse detail-analyses (elk: AI-analyse + risico), daarna post-scrape-ID’s als batch
 * (per item hetzelfde). Loopt door tot er niets meer wacht of er weer een actieve run is.
 */
async function processBackgroundAnalysisQueues(): Promise<void> {
  if (backgroundQueueProcessorRunning) return
  backgroundQueueProcessorRunning = true
  try {
    for (;;) {
      if (singleAnalysisRunning || batchState.running) return

      const nextSingle = pendingSingleAnalysisIds.shift()
      if (nextSingle) {
        log.info(`[analysis] Wachtrij: start losse analyse + risico voor ${nextSingle} (${pendingSingleAnalysisIds.length} nog in wachtrij)`)
        clearAnalysisCheckpoint(nextSingle)
        await runSingleAnalysisWork(nextSingle, false).catch((err) =>
          log.error('[analysis] Wachtrij (losse AI-analyse) mislukt:', err)
        )
        continue
      }

      if (pendingPostScrapeIds.length === 0) return

      const nextBatch = [...pendingPostScrapeIds]
      pendingPostScrapeIds = []
      log.info(`[analysis] Wachtrij: start post-scrape batch (${nextBatch.length} aanbesteding(en), analyse + risico per stuk)`)
      try {
        await runBatchAnalysisForIds(nextBatch)
      } catch (err: unknown) {
        log.error('Post-scrape batch mislukt — ID’s terug in wachtrij:', err)
        mergePostScrapePendingIds(nextBatch)
      }
    }
  } finally {
    backgroundQueueProcessorRunning = false
  }
}

/**
 * Na hoofdanalyse: DB wegschrijven en risico-inventarisatie uitvoeren.
 * Als er al een risico-analyse bestaat wordt de automatische run overgeslagen —
 * de gebruiker kan via de handmatige knop in de UI opnieuw starten.
 */
async function persistAndRunRisico(aanbestedingId: string, result: AnalysisResult): Promise<void> {
  persistAnalysisResult(aanbestedingId, result)
  try {
    const db = getDb()
    const row = db.prepare('SELECT risico_analyse FROM aanbestedingen WHERE id = ?').get(aanbestedingId) as
      | { risico_analyse?: string | null }
      | undefined
    if (row?.risico_analyse) {
      log.info(`[analysis] Auto-risico overgeslagen — bestaande analyse aanwezig voor ${aanbestedingId}`)
      return
    }
  } catch {
    // DB-check mislukt — verloopt door en voert risico alsnog uit
  }
  try {
    const { runRisicoAfterMainAnalysis } = await import('./risico.ipc')
    const risicoOut = await runRisicoAfterMainAnalysis(aanbestedingId)
    if (!risicoOut.success && risicoOut.error) {
      log.warn(`[analysis] Risico na hoofdanalyse (${aanbestedingId}): ${risicoOut.error}`)
    }
  } catch (e: unknown) {
    log.error('[analysis] Risico na hoofdanalyse mislukt:', e)
  }
}

async function runSingleAnalysisWork(
  aanbestedingId: string,
  resume: boolean
): Promise<{ success: boolean; error?: string; paused?: boolean; stopped?: boolean; result?: AnalysisResult }> {
  const db = getDb()
  const tender = db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(aanbestedingId) as any
  if (!tender) {
    kickBackgroundQueues()
    return { success: false, error: 'Aanbesteding niet gevonden' }
  }

  const questions = db.prepare('SELECT * FROM ai_vragen WHERE is_actief = 1 ORDER BY volgorde').all() as any[]
  const criteria = db.prepare('SELECT * FROM criteria WHERE is_actief = 1 ORDER BY volgorde').all() as any[]
  const settings = db.prepare('SELECT key, value FROM app_settings').all() as { key: string, value: string }[]
  const settingsMap: Record<string, string> = {}
  settings.forEach(s => { settingsMap[s.key] = s.value })
  const prompts = db.prepare('SELECT * FROM ai_prompts WHERE is_actief = 1').all() as any[]

  analysisControlBegin(aanbestedingId)
  singleAnalysisRunning = true
  singleAnalysisAanbestedingId = aanbestedingId
  setSingleAnalysisRunState(true, aanbestedingId)
  /** Bij pauze blijft de gebruiker “eigenaar” van de sessie — geen volgende wachtrij-job starten. */
  let magWachtrijVoortzetten = true
  try {
    const outcome = await runAnalysis(
      tender, questions, criteria, prompts, settingsMap,
      (progress) => {
        broadcastAnalysisProgress({ aanbestedingId, ...progress })
      },
      { resume }
    )

    if (isAnalysisPaused(outcome)) {
      broadcastAnalysisProgress({
        aanbestedingId,
        step: 'Analyse gepauzeerd — klik Hervatten om verder te gaan (ook na herstart van de app).',
        percentage: 50,
      })
      magWachtrijVoortzetten = false
      return { success: true, paused: true }
    }
    if (isAnalysisStopped(outcome)) {
      broadcastAnalysisProgress({
        aanbestedingId,
        step: 'Analyse gestopt.',
        percentage: 0,
      })
      return { success: false, stopped: true }
    }

    const result = outcome
    await persistAndRunRisico(aanbestedingId, result)

    return { success: true, result }
  } catch (error: any) {
    log.error(resume ? 'Analysis resume failed:' : 'Analysis failed:', error)
    return { success: false, error: error.message }
  } finally {
    analysisControlReset()
    singleAnalysisRunning = false
    singleAnalysisAanbestedingId = null
    setSingleAnalysisRunState(false, null)
    if (magWachtrijVoortzetten) {
      kickBackgroundQueues()
    }
  }
}

export function registerAnalysisHandlers(): void {
  ipcMain.handle(IPC.ANALYSIS_UI_REPLAY, (event) => {
    replayAnalysisUiToWebContents(event.sender)
    return undefined
  })

  // Single analysis: bij bestaand checkpoint eerst UI-keuze (conflict), tenzij discardCheckpoint
  ipcMain.handle(
    IPC.ANALYSIS_START,
    async (_event, aanbestedingId: string, opts?: { discardCheckpoint?: boolean }) => {
    const idTrim = String(aanbestedingId || '').trim()
    const db = getDb()
    const tender = db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(idTrim) as any
    if (!tender) {
      return { success: false, error: 'Aanbesteding niet gevonden' }
    }

    const existingCk = loadAnalysisCheckpoint(idTrim)
    if (existingCk && !opts?.discardCheckpoint) {
      return { success: false, conflict: true, stage: existingCk.stage }
    }
    if (opts?.discardCheckpoint) {
      clearAnalysisCheckpoint(idTrim)
    }

    if (singleAnalysisRunning && singleAnalysisAanbestedingId === idTrim) {
      return { success: true, alreadyRunning: true }
    }

    if (batchState.running || singleAnalysisRunning) {
      const dupIdx = pendingSingleAnalysisIds.indexOf(idTrim)
      if (dupIdx >= 0) {
        return { success: true, queued: true, position: dupIdx + 1, duplicateInQueue: true }
      }
      pendingSingleAnalysisIds.push(idTrim)
      log.info(`[analysis] Losse AI-analyse in wachtrij (positie ${pendingSingleAnalysisIds.length}): ${idTrim}`)
      return { success: true, queued: true, position: pendingSingleAnalysisIds.length }
    }

    return runSingleAnalysisWork(idTrim, false)
  },
  )

  ipcMain.handle(IPC.ANALYSIS_RESUME, async (_event, aanbestedingId: string) => {
    if (batchState.running) {
      return { success: false, error: 'Er loopt een batch-analyse. Wacht tot deze is voltooid.' }
    }
    if (singleAnalysisRunning) {
      return { success: false, error: 'Er loopt al een analyse. Wacht tot deze is voltooid.' }
    }
    if (!loadAnalysisCheckpoint(aanbestedingId)) {
      return { success: false, error: 'Geen gepauzeerde analyse om te hervatten.' }
    }

    return runSingleAnalysisWork(String(aanbestedingId || '').trim(), true)
  })

  ipcMain.handle(IPC.ANALYSIS_PAUSE, () => {
    analysisControlRequestPause()
    return { ok: true }
  })

  ipcMain.handle(IPC.ANALYSIS_STOP, (_event, aanbestedingId?: string) => {
    analysisControlRequestStop()
    if (aanbestedingId) clearAnalysisCheckpoint(aanbestedingId)
    return { ok: true }
  })

  ipcMain.handle(IPC.ANALYSIS_CHECKPOINT_GET, (_event, aanbestedingId: string) => {
    const ck = loadAnalysisCheckpoint(aanbestedingId)
    const fpNow = computeCurrentAnalysisConfigFingerprint()
    const configMismatch = Boolean(ck?.configFingerprint && ck.configFingerprint !== fpNow)
    return { hasCheckpoint: !!ck, stage: ck?.stage ?? null, configMismatch }
  })

  // Batch analysis - runs in main process, survives page navigation
  ipcMain.handle(IPC.ANALYSIS_BATCH_START, async (_event, aanbestedingIds: string[]) => {
    if (singleAnalysisRunning) {
      return { success: false, error: 'Er loopt een losse AI-analyse. Wacht tot deze is voltooid.' }
    }
    if (batchState.running) {
      return { success: false, error: 'Er loopt al een batch-analyse. Wacht tot deze is voltooid.' }
    }

    batchState = {
      running: true,
      ids: aanbestedingIds,
      current: 0,
      total: aanbestedingIds.length,
      currentId: '',
      currentTitle: '',
      errors: [],
      skippedAlreadyScored: 0,
      analyzedOk: 0,
    }

    // Run async in background - don't await so the IPC returns immediately
    runBatchAnalysis().catch(err => {
      log.error('Batch analysis crashed:', err)
      batchState.running = false
      setBatchAnalysisRunState(false, null)
    })

    return { success: true, total: aanbestedingIds.length }
  })

  ipcMain.handle(IPC.ANALYSIS_BATCH_ALL, async () => {
    if (singleAnalysisRunning) {
      return { success: false, error: 'Er loopt een losse AI-analyse. Wacht tot deze is voltooid.' }
    }
    if (batchState.running) {
      return { success: false, error: 'Er loopt al een batch-analyse. Wacht tot deze is voltooid.' }
    }

    const db = getDb()
    const rows = db
      .prepare(
        `SELECT id FROM aanbestedingen
         WHERE bron_url IS NOT NULL AND TRIM(COALESCE(bron_url,'')) != ''
         AND (sluitingsdatum IS NULL OR TRIM(COALESCE(sluitingsdatum,'')) = '' OR DATE(sluitingsdatum) IS NULL OR DATE(sluitingsdatum) >= DATE('now'))
         ORDER BY created_at DESC`
      )
      .all() as { id: string }[]

    const ids = rows.map(r => r.id)
    if (ids.length === 0) {
      return { success: false, error: 'Geen actieve aanbesteding met bron-URL om te analyseren.' }
    }

    batchState = {
      running: true,
      ids,
      current: 0,
      total: ids.length,
      currentId: '',
      currentTitle: '',
      errors: [],
      skippedAlreadyScored: 0,
      analyzedOk: 0,
    }

    runBatchAnalysis().catch(err => {
      log.error('Batch analysis crashed:', err)
      batchState.running = false
      setBatchAnalysisRunState(false, null)
    })

    return { success: true, total: ids.length }
  })

  // Check batch status (polled by renderer)
  ipcMain.handle(IPC.ANALYSIS_BATCH_STATUS, () => {
    return {
      ...batchState,
      singleRunning: singleAnalysisRunning,
      singleAnalysisId: singleAnalysisAanbestedingId,
      singleAnalysisQueuedIds: [...pendingSingleAnalysisIds],
      risico: getRisicoRunSnapshot(),
    }
  })
}

/**
 * Na een geplande scrape: zelfde batch-pad als handmatig (`runAnalysis` daarna `runRisicoAfterMainAnalysis`).
 * Dynamisch geïmporteerd vanuit de scheduler om een laadcirkel met `index.ts` te vermijden.
 */
export async function runBatchAnalysisForIds(aanbestedingIds: string[]): Promise<void> {
  if (!aanbestedingIds?.length) return
  if (singleAnalysisRunning || pendingSingleAnalysisIds.length > 0) {
    mergePostScrapePendingIds(aanbestedingIds)
    log.info(
      `[batch] ${aanbestedingIds.length} ID(s) in post-scrape-wachtrij (losse AI-analyse of wachtrij)`
    )
    if (!singleAnalysisRunning) {
      kickBackgroundQueues()
    }
    return
  }
  if (batchState.running) {
    mergePostScrapePendingIds(aanbestedingIds)
    log.info(`[batch] ${aanbestedingIds.length} ID(s) in wachtrij (andere batch actief)`)
    return
  }

  batchState = {
    running: true,
    ids: aanbestedingIds,
    current: 0,
    total: aanbestedingIds.length,
    currentId: '',
    currentTitle: '',
    errors: [],
    skippedAlreadyScored: 0,
    analyzedOk: 0,
  }

  try {
    await runBatchAnalysis()
  } catch (err: unknown) {
    log.error('[batch] gecrasht:', err)
    throw err
  }
}

async function runBatchAnalysis() {
  try {
  setBatchAnalysisRunState(true, null)
  const db = getDb()

  const questions = db.prepare('SELECT * FROM ai_vragen WHERE is_actief = 1 ORDER BY volgorde').all() as any[]
  const criteria = db.prepare('SELECT * FROM criteria WHERE is_actief = 1 ORDER BY volgorde').all() as any[]
  const settings = db.prepare('SELECT key, value FROM app_settings').all() as { key: string, value: string }[]
  const settingsMap: Record<string, string> = {}
  settings.forEach(s => { settingsMap[s.key] = s.value })
  const prompts = db.prepare('SELECT * FROM ai_prompts WHERE is_actief = 1').all() as any[]

  for (let i = 0; i < batchState.ids.length; i++) {
    const aanbestedingId = batchState.ids[i]
    const tender = db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(aanbestedingId) as any
    if (!tender) {
      batchState.errors.push(`ID ${aanbestedingId}: niet gevonden`)
      continue
    }

    batchState.current = i + 1
    batchState.currentId = aanbestedingId
    batchState.currentTitle = tender.titel?.slice(0, 80) || 'Onbekend'
    setBatchAnalysisRunState(true, aanbestedingId)

    if (tenderHasStoredAiScore(tender)) {
      batchState.skippedAlreadyScored += 1
      log.info(`Batch skip ${i + 1}/${batchState.total} (reeds score ${tender.totaal_score}): ${tender.titel}`)
      broadcastAnalysisProgress({
        batch: true,
        current: i + 1,
        total: batchState.total,
        aanbestedingId,
        titel: tender.titel,
        step: `Overgeslagen ${i + 1}/${batchState.total} (heeft al score): ${tender.titel?.slice(0, 60)}...`,
        percentage: Math.round(((i + 1) / batchState.total) * 100),
        skippedAlreadyScored: true,
      })
      continue
    }

    log.info(`Batch analysis ${i + 1}/${batchState.total}: ${tender.titel}`)

    clearAnalysisCheckpoint(aanbestedingId)

    broadcastAnalysisProgress({
      batch: true,
      current: i + 1,
      total: batchState.total,
      aanbestedingId,
      titel: tender.titel,
      step: `Analyseren ${i + 1}/${batchState.total}: ${tender.titel?.slice(0, 60)}...`,
      percentage: Math.round((i / batchState.total) * 100),
    })

    try {
      const outcome = await runAnalysis(
        tender, questions, criteria, prompts, settingsMap,
        (progress) => {
          broadcastAnalysisProgress({
            batch: true,
            current: i + 1,
            total: batchState.total,
            aanbestedingId,
            ...progress,
          })
        }
      )

      if (isAnalysisPaused(outcome) || isAnalysisStopped(outcome)) {
        log.warn(`Batch: unexpected pause/stop for ${tender.titel}, skipping DB update`)
        batchState.errors.push(`${tender.titel?.slice(0, 50)}: analyse onderbroken (batch ondersteunt geen pauze)`)
        continue
      }

      const result = outcome

      await persistAndRunRisico(aanbestedingId, result)

      batchState.analyzedOk += 1
      log.info(`Batch analysis ${i + 1}/${batchState.total}: done, score=${result.totaal_score}`)
    } catch (error: any) {
      log.error(`Batch analysis failed for ${tender.titel}:`, error.message)
      batchState.errors.push(`${tender.titel?.slice(0, 50)}: ${error.message}`)
    }
  }

  const { analyzedOk, skippedAlreadyScored, errors } = batchState
  const summary = `Batch voltooid: ${analyzedOk} geanalyseerd${skippedAlreadyScored ? `, ${skippedAlreadyScored} overgeslagen (had al score)` : ''}${errors.length ? `, ${errors.length} fout(en)` : ''}`
  broadcastAnalysisProgress({
    batch: true,
    current: batchState.total,
    total: batchState.total,
    step: summary,
    percentage: 100,
    done: true,
    errors: batchState.errors,
    analyzedOk,
    skippedAlreadyScored,
  })

  log.info(`Batch analysis complete: ${summary}`)
  } finally {
    batchState.running = false
    setBatchAnalysisRunState(false, null)
    kickBackgroundQueues()
  }
}
