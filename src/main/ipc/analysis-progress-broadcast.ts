import { BrowserWindow, type WebContents } from 'electron'
import { IPC } from '../../shared/constants'
import { getActiveAnalysisAanbestedingId } from './analysis-run-state'

const lastByTender = new Map<string, Record<string, unknown>>()

/**
 * Stuurt analyse-voortgang naar alle vensters (niet alleen `mainWindow`: bij gesloten venster
 * blijft de main-process-analyse lopen maar was `webContents.send` een no-op).
 */
export function broadcastAnalysisProgress(payload: Record<string, unknown>): void {
  const id = payload.aanbestedingId
  if (typeof id === 'string' && id.trim()) {
    lastByTender.set(id.trim(), { ...payload })
  }

  for (const w of BrowserWindow.getAllWindows()) {
    const wc = w.webContents
    if (!wc.isDestroyed()) {
      wc.send(IPC.ANALYSIS_PROGRESS, payload)
    }
  }
}

/**
 * Na opnieuw openen van een venster: laatste bekende stap + percentage voor de lopende analyse.
 */
export function replayAnalysisUiToWebContents(wc: WebContents): void {
  if (wc.isDestroyed()) return

  const activeId = getActiveAnalysisAanbestedingId()
  if (!activeId) return

  const last = lastByTender.get(activeId)
  if (last) {
    wc.send(IPC.ANALYSIS_PROGRESS, last)
    return
  }

  wc.send(IPC.ANALYSIS_PROGRESS, {
    aanbestedingId: activeId,
    step: 'Analyse loopt op de achtergrond — voortgang wordt vernieuwd…',
    percentage: 15,
  })
}
