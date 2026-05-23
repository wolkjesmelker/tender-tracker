import { app, dialog, BrowserWindow } from 'electron'
import { isScrapingActive, isDocumentFetchResumeActive } from '../ipc/scraping.ipc'
import { isAnalysisPipelineBusy } from '../ipc/analysis.ipc'
import { getRisicoRunSnapshot } from '../ipc/risico-run-state'
import { getBusyWorkBlockerDebug } from './busy-work-blocker'

/** Na bevestigd afsluiten: volgende close/before-quit niet opnieuw vragen. */
let bypassOngoingWorkGuard = false

let beforeQuitHookRegistered = false

export function resetOngoingWorkQuitBypass(): void {
  bypassOngoingWorkGuard = false
}

function hasOngoingScrapeOrAnalysisWork(): boolean {
  if (isScrapingActive()) return true
  if (isDocumentFetchResumeActive()) return true
  if (isAnalysisPipelineBusy()) return true
  if (getRisicoRunSnapshot().running) return true
  if (getBusyWorkBlockerDebug().refCount > 0) return true
  return false
}

function dialogOptions() {
  return {
    type: 'warning' as const,
    buttons: ['Annuleren', 'Toch afsluiten'],
    defaultId: 0,
    cancelId: 0,
    title: 'Lopende taken',
    message: 'Er loopt een tracking (scrape), documentophalen en/of een AI-analyse.',
    detail:
      'Als u de app nu sluit, kan dat proces worden onderbroken of onvolledig blijven. Wilt u echt afsluiten?',
    noLink: true,
  }
}

async function promptQuitAnyway(resolveParent: () => BrowserWindow | null): Promise<boolean> {
  const parent = BrowserWindow.getFocusedWindow() ?? resolveParent()
  const opts = dialogOptions()
  const { response } =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, opts)
      : await dialog.showMessageBox(opts)
  return response === 1
}

/**
 * Waarschuwing bij sluiten zolang er scrape- of analysewerk loopt (incl. risico-inventarisatie en zware achtergrondtaken).
 */
export function registerOngoingWorkQuitGuard(resolveMainWindow: () => BrowserWindow | null): void {
  const win = resolveMainWindow()
  if (!win || win.isDestroyed()) return

  win.on('close', (e) => {
    if (bypassOngoingWorkGuard) return
    if (!hasOngoingScrapeOrAnalysisWork()) return
    e.preventDefault()
    void promptQuitAnyway(resolveMainWindow).then((quitAnyway) => {
      if (!quitAnyway) return
      bypassOngoingWorkGuard = true
      win.close()
    })
  })

  if (beforeQuitHookRegistered) return
  beforeQuitHookRegistered = true

  app.on('before-quit', (e) => {
    if (bypassOngoingWorkGuard) return
    if (!hasOngoingScrapeOrAnalysisWork()) return
    e.preventDefault()
    void promptQuitAnyway(resolveMainWindow).then((quitAnyway) => {
      if (!quitAnyway) return
      bypassOngoingWorkGuard = true
      app.quit()
    })
  })
}
