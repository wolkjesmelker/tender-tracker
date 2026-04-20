import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
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
import { runRisicoAnalysisCore } from '../ai/risico-analysis'
import { broadcastRisicoProgress, replayRisicoUiToWebContents } from './risico-progress-broadcast'
import { gateRisicoAttachments, type RisicoAttachment } from '../ai/risico-document-gate'
import { getRisicoRunSnapshot, setRisicoRunState, shiftRisicoWachtrij, tryEnqueueRisicoWachtrij } from './risico-run-state'
import { acquireBusyWorkBlocker, releaseBusyWorkBlocker } from '../utils/busy-work-blocker'
import { preAnalyzeFillableDocuments } from '../ai/document-fill-engine'
import type { Aanbesteding, StoredDocumentEntry } from '../../shared/types'
import log from 'electron-log'

const RISICO_AGENT_LABEL = 'Kimi (risico-inventarisatie)'

function sendProgress(aanbestedingId: string, step: string, percentage: number): void {
  broadcastRisicoProgress({
    aanbestedingId,
    step,
    percentage,
    agent: RISICO_AGENT_LABEL,
  })
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
): Promise<{ success: boolean; error?: string }> {
  const db = getDb()
  const tender = db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(aanbestedingId) as any
  if (!tender) {
    return { success: false, error: 'Aanbesteding niet gevonden' }
  }

  const settings = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
  const settingsMap: Record<string, string> = {}
  settings.forEach((s) => {
    settingsMap[s.key] = s.value
  })
  aiService.configure(settingsMap)

  const isAvailable = await aiService.isAvailable()
  if (!isAvailable) {
    return { success: false, error: 'AI service is niet beschikbaar. Controleer je API-sleutel en instellingen.' }
  }

  sendProgress(aanbestedingId, 'Documenten voor risico-inventarisatie laden…', 5)
  const documentTexts = await collectDocumentTexts(tender, allowDocDownload, (step, pct) =>
    sendProgress(aanbestedingId, step, pct),
  )

  if (documentTexts.length === 0) {
    sendProgress(aanbestedingId, 'Geen documenttekst beschikbaar voor risico-analyse', 100)
    return { success: false, error: 'Geen documenten beschikbaar voor risico-analyse.' }
  }

  const totalChars = documentTexts.reduce((s, t) => s + t.length, 0)
  sendProgress(
    aanbestedingId,
    `${documentTexts.length} bron(nen) geladen (${Math.round(totalChars / 1000)}k tekens). AI-fase starten…`,
    20,
  )

  const risicoConfig = {
    moonshotApiKey: (settingsMap.moonshot_api_key || '').trim() || undefined,
    moonshotBaseUrl: (settingsMap.moonshot_api_base || '').trim() || undefined,
    onProgress: (step: string, percentage: number) => sendProgress(aanbestedingId, step, percentage),
  }

  const result = await runRisicoAnalysisCore(tender, documentTexts, risicoConfig)

  if (!result) {
    sendProgress(aanbestedingId, 'Risico-analyse mislukt (ongeldige AI-respons)', 100)
    return { success: false, error: 'De AI heeft geen geldige risico-analyse teruggegeven. Probeer opnieuw.' }
  }

  sendProgress(aanbestedingId, 'Risico-analyse opslaan…', 90)
  db.prepare(`
    UPDATE aanbestedingen
    SET risico_analyse = ?, risico_analyse_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(result), aanbestedingId)

  // Pre-analyseer invulbare documenten met Claude Sonnet 4.5 zodat de agent
  // direct kan starten zonder on-demand veldextractie.
  try {
    const tenderForPrefill = db
      .prepare('SELECT * FROM aanbestedingen WHERE id = ?')
      .get(aanbestedingId) as Aanbesteding | undefined
    if (tenderForPrefill) {
      await preAnalyzeFillableDocuments({
        tender: tenderForPrefill,
        startPct: 92,
        endPct: 99,
        onProgress: (step, pct) => sendProgress(aanbestedingId, step, pct),
      })
    }
  } catch (e) {
    log.warn('[risico] pre-analyse van invulbare documenten gefaald (niet-blokkerend):', e)
  }

  sendProgress(aanbestedingId, 'Risico-inventarisatie + agent pre-analyse voltooid', 100)
  log.info(`[risico] Inventarisatie voltooid voor ${aanbestedingId}: overall=${result.overall_score}`)
  return { success: true }
}

/**
 * Direct na een voltooide hoofd-AI-analyse (zelfde sessie, sequentieel — geen parallelle IPC-risico).
 * Gebruikt alleen lokaal opgeslagen documenten; geen globale risico-wachtrijstatus.
 */
export async function runRisicoAfterMainAnalysis(aanbestedingId: string): Promise<{ success: boolean; error?: string }> {
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

async function runRisicoAnalysisJob(aanbestedingId: string): Promise<{ success: boolean; error?: string }> {
  let runGemarkeerd = false
  let returnValue: { success: boolean; error?: string } = { success: false, error: 'Onbekende fout' }
  try {
    runGemarkeerd = true
    setRisicoRunState(true, aanbestedingId)
    acquireBusyWorkBlocker('risico-analyse')
    try {
      returnValue = await performRisicoInventarisatie(aanbestedingId, true)
      return returnValue
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('[risico] Analyse fout:', e)
      sendProgress(aanbestedingId, `Risico-analyse fout: ${msg.slice(0, 120)}`, 100)
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

export function registerRisicoHandlers(): void {
  ipcMain.handle(IPC.RISICO_UI_REPLAY, (event) => {
    replayRisicoUiToWebContents(event.sender)
    return undefined
  })

  ipcMain.handle(IPC.RISICO_START, async (_event, aanbestedingId: string) => {
    const { isAnalysisPipelineBusy, tenderHasStoredAiScore } = await import('./analysis.ipc')
    if (isAnalysisPipelineBusy()) {
      return {
        success: false,
        error:
          'Er loopt nog een AI-analyse of batch. Wacht tot die klaar is — risico-inventarisatie start automatisch direct na de analyse.',
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
          'Voer eerst de AI-analyse uit. Risico-inventarisatie gebruikt dezelfde lokale documenten en start daarna automatisch, of handmatig zodra de analyse klaar is.',
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

    return runRisicoAnalysisJob(aanbestedingId)
  })
}
