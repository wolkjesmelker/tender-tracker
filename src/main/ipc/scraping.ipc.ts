import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'
import { runScrapePipeline } from '../scraping/pipeline'
import { enqueuePostScrapeAnalysis } from './analysis.ipc'
import { getMainWindow } from '../index'
import log from 'electron-log'
import { acquireBusyWorkBlocker, releaseBusyWorkBlocker } from '../utils/busy-work-blocker'
import {
  discoverDocumentsFromBronWithAi,
  getPendingDocumentFetchRows,
  type PendingDocumentFetchRow,
} from '../ai/document-discovery'

/** Globale guard: voorkomt dat de scheduler én handmatige scrape gelijktijdig draaien. */
let scrapingActive = false

/** Voorkomt gelijktijdige scrape en hervat-documenten-run. */
let documentFetchResumeActive = false

/** Na true: volgende tender in de wachtrij wordt niet meer gestart (lopende taak mag nog afronden). */
let documentFetchResumeCancelRequested = false

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function runDocumentFetchResumeJob(
  rows: PendingDocumentFetchRow[],
  settingsMap: Record<string, string>,
): Promise<void> {
  const mainWindow = getMainWindow()
  let processed = 0
  let failures = 0
  try {
    mainWindow?.webContents.send(IPC.SCRAPING_PROGRESS, {
      jobId: 'doc-fetch-resume',
      status: 'bezig',
      message: `Documentophalen hervat: 0/${rows.length}…`,
      found: rows.length,
    })
    for (let i = 0; i < rows.length; i++) {
      if (documentFetchResumeCancelRequested) {
        const failHint = failures > 0 ? ` (${failures} met fout)` : ''
        mainWindow?.webContents.send(IPC.SCRAPING_PROGRESS, {
          jobId: 'doc-fetch-resume',
          status: 'fout',
          message: `Gestopt: ${processed}/${rows.length} afgerond; rest blijft in de wachtrij${failHint}.`,
          found: rows.length,
        })
        return
      }
      const { id, titel } = rows[i]
      const label = titel?.slice(0, 56) || id
      mainWindow?.webContents.send(IPC.SCRAPING_PROGRESS, {
        jobId: 'doc-fetch-resume',
        status: 'bezig',
        message: `Documenten hervatten (${i + 1}/${rows.length}): ${label}…`,
        found: rows.length,
      })
      try {
        const result = await discoverDocumentsFromBronWithAi(id, settingsMap, (p) => {
          mainWindow?.webContents.send(IPC.SCRAPING_PROGRESS, {
            jobId: 'doc-fetch-resume',
            status: 'bezig',
            message: `${label}: ${p.step}`,
            found: rows.length,
          })
        })
        if (result.success) processed++
        else failures++
      } catch (e: unknown) {
        failures++
        log.warn(`[doc-fetch-resume] tender ${id}:`, e)
      }
      await sleep(400)
    }
    const tail = failures > 0 ? ` (${failures} met fout)` : ''
    mainWindow?.webContents.send(IPC.SCRAPING_PROGRESS, {
      jobId: 'doc-fetch-resume',
      status: 'gereed',
      message: `Documentophalen hervat: ${processed}/${rows.length} afgerond${tail}`,
      found: rows.length,
    })
  } catch (e: unknown) {
    log.error('[doc-fetch-resume] onverwachte fout:', e)
    mainWindow?.webContents.send(IPC.SCRAPING_PROGRESS, {
      jobId: 'doc-fetch-resume',
      status: 'fout',
      message: `Documentophalen mislukt: ${e instanceof Error ? e.message : String(e)}`,
      found: rows.length,
    })
  } finally {
    documentFetchResumeActive = false
    documentFetchResumeCancelRequested = false
    releaseBusyWorkBlocker('document-fetch-resume')
  }
}

export function isScrapingActive(): boolean {
  return scrapingActive
}

export function setScrapingActive(value: boolean): void {
  scrapingActive = value
}

export function isDocumentFetchResumeActive(): boolean {
  return documentFetchResumeActive
}

export function registerScrapingHandlers(): void {
  ipcMain.handle(IPC.SCRAPING_START, async (_event, options: { sourceIds?: string[], zoektermen?: string[] }) => {
    if (scrapingActive) {
      log.warn('SCRAPING_START genegeerd: er loopt al een tracking.')
      return { success: false, error: 'Er loopt al een tracking. Wacht tot die klaar is.' }
    }
    if (documentFetchResumeActive) {
      return {
        success: false,
        error: 'Documentophalen wordt hervat. Wacht tot dat klaar is voordat je een nieuwe tracking start.',
      }
    }
    scrapingActive = true

    const db = getDb()
    const sources = options.sourceIds
      ? db.prepare(`SELECT * FROM bron_websites WHERE id IN (${options.sourceIds.map(() => '?').join(',')}) AND is_actief = 1`).all(...options.sourceIds)
      : db.prepare('SELECT * FROM bron_websites WHERE is_actief = 1').all()

    const zoektermen = options.zoektermen
      ?? (db.prepare('SELECT term FROM zoektermen WHERE is_actief = 1 ORDER BY volgorde').all() as { term: string }[]).map(z => z.term)

    const mainWindow = getMainWindow()

    try {
      const results = await runScrapePipeline(
        sources as any[],
        zoektermen,
        (progress) => {
          mainWindow?.webContents.send(IPC.SCRAPING_PROGRESS, progress)
        }
      )
      if (results.newTenderIds.length > 0) {
        enqueuePostScrapeAnalysis(results.newTenderIds)
      }
      return { success: true, results }
    } catch (error: any) {
      log.error('Scraping failed:', error)
      return { success: false, error: error.message }
    } finally {
      scrapingActive = false
    }
  })

  ipcMain.handle(IPC.SCRAPING_STOP, (_event, jobId: string) => {
    // Mark job as stopped
    getDb().prepare("UPDATE scrape_jobs SET status = 'fout', fout_melding = 'Gestopt door gebruiker' WHERE id = ?").run(jobId)
    return { success: true }
  })

  ipcMain.handle(IPC.SCRAPING_JOBS, () => {
    return getDb().prepare('SELECT * FROM scrape_jobs ORDER BY created_at DESC LIMIT 50').all()
  })

  ipcMain.handle(IPC.SCRAPING_PENDING_DOCUMENT_FETCH, () => {
    const rows = getPendingDocumentFetchRows()
    return { count: rows.length, items: rows }
  })

  ipcMain.handle(IPC.SCRAPING_RESUME_DOCUMENT_FETCH, async () => {
    if (scrapingActive) {
      return { success: false, error: 'Er loopt een tracking. Wacht tot die klaar is.' }
    }
    if (documentFetchResumeActive) {
      return { success: false, error: 'Hervatten van documentophalen is al bezig.' }
    }
    const rows = getPendingDocumentFetchRows()
    if (rows.length === 0) {
      return { success: true, started: false, processed: 0, message: 'Geen openstaande documentophalingen.' }
    }

    const db = getDb()
    const settingsRows = db.prepare('SELECT key, value FROM app_settings').all() as {
      key: string
      value: string
    }[]
    const settingsMap: Record<string, string> = {}
    settingsRows.forEach((r) => {
      settingsMap[r.key] = r.value
    })

    documentFetchResumeActive = true
    documentFetchResumeCancelRequested = false
    acquireBusyWorkBlocker('document-fetch-resume')
    void runDocumentFetchResumeJob(rows, settingsMap)
    return { success: true, started: true, total: rows.length }
  })

  ipcMain.handle(IPC.SCRAPING_STOP_DOCUMENT_FETCH, () => {
    if (!documentFetchResumeActive) {
      return { success: false, error: 'Er loopt geen hervatting van documentophalen.' }
    }
    documentFetchResumeCancelRequested = true
    return { success: true }
  })

  ipcMain.handle(
    IPC.SCRAPING_DELETE_JOBS,
    (_event, payload: { all?: boolean; ids?: string[] } | undefined) => {
      const db = getDb()
      if (payload?.all === true) {
        const r = db.prepare('DELETE FROM scrape_jobs').run()
        log.info(`[scraping] Alle scrape_jobs gewist: ${r.changes} rijen`)
        return { success: true, deleted: r.changes }
      }
      const ids = [...new Set((payload?.ids ?? []).filter((id) => typeof id === 'string' && id.length > 0))]
      if (ids.length === 0) {
        return { success: false, error: 'Geen items geselecteerd' }
      }
      const ph = ids.map(() => '?').join(',')
      const r = db.prepare(`DELETE FROM scrape_jobs WHERE id IN (${ph})`).run(...ids)
      log.info(`[scraping] scrape_jobs verwijderd: ${r.changes} (aanvraag ${ids.length} id’s)`)
      return { success: true, deleted: r.changes }
    },
  )
}
