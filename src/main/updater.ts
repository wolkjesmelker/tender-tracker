import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { IPC } from '../shared/constants'

export function setupAutoUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) {
    log.info('[updater] Alleen actief in geïnstalleerde app')
    return
  }

  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    log.info(`[updater] Nieuwe versie beschikbaar: ${info.version}`)
    getWindow()?.webContents.send(IPC.APP_UPDATE_AVAILABLE, info)
  })

  autoUpdater.on('update-not-available', () => {
    log.info('[updater] App is up-to-date')
  })

  autoUpdater.on('download-progress', (progress) => {
    getWindow()?.webContents.send(IPC.APP_UPDATE_PROGRESS, { percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`[updater] Versie ${info.version} gedownload — klaar voor installatie`)
    getWindow()?.webContents.send(IPC.APP_UPDATE_DOWNLOADED, info)
  })

  autoUpdater.on('error', (err) => {
    log.warn('[updater]', err)
  })

  // Check 10 seconden na opstart, daarna elk uur
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((e) => log.warn('[updater] checkForUpdates', e))
  }, 10_000)

  setInterval(() => {
    void autoUpdater.checkForUpdates().catch((e) => log.warn('[updater] checkForUpdates (interval)', e))
  }, 60 * 60 * 1_000)
}

export async function checkForUpdatesManual(): Promise<{
  isUpdateAvailable: boolean
  updateInfo?: unknown
} | null> {
  if (!app.isPackaged) return null
  const r = await autoUpdater.checkForUpdates()
  if (!r) return null
  return {
    isUpdateAvailable: r.isUpdateAvailable,
    updateInfo: r.updateInfo,
  }
}

export function downloadUpdateNow(): Promise<string[]> {
  return autoUpdater.downloadUpdate()
}

export function quitAndInstallNow(): void {
  autoUpdater.quitAndInstall(false, true)
}
