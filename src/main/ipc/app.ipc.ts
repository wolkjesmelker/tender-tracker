import { ipcMain, app } from 'electron'
import log from 'electron-log'
import { IPC } from '../../shared/constants'
import type { LicenseStatus } from '../../shared/types'
import { verifyLicenseSeat } from '../license/license-service'
import {
  checkForUpdatesManual,
  downloadUpdateNow,
  quitAndInstallNow,
} from '../updater'

let cachedLicense: LicenseStatus = { ok: true, skipped: true }

export function setStartupLicenseStatus(status: LicenseStatus): void {
  cachedLicense = status
}

export function registerAppHandlers(): void {
  ipcMain.handle(IPC.APP_VERSION, () => app.getVersion())

  ipcMain.handle(IPC.LICENSE_STATUS, () => cachedLicense)

  ipcMain.handle(IPC.LICENSE_REFRESH, async () => {
    const s = await verifyLicenseSeat()
    cachedLicense = s
    return s
  })

  ipcMain.handle(IPC.APP_CHECK_UPDATES, async () => {
    if (!app.isPackaged) {
      return { ok: true as const, isUpdateAvailable: false }
    }
    try {
      const r = await checkForUpdatesManual()
      return {
        ok: true as const,
        isUpdateAvailable: r?.isUpdateAvailable ?? false,
        updateInfo: r?.updateInfo,
      }
    } catch (e) {
      log.warn('[app-ipc] check updates', e)
      return {
        ok: false as const,
        message: e instanceof Error ? e.message : 'Controleren op updates mislukt.',
      }
    }
  })

  ipcMain.handle(IPC.APP_DOWNLOAD_UPDATE, async () => {
    if (!app.isPackaged) return { ok: false as const }
    await downloadUpdateNow()
    return { ok: true as const }
  })

  ipcMain.handle(IPC.APP_INSTALL_UPDATE, () => {
    quitAndInstallNow()
  })
}
