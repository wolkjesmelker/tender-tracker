import path from 'path'
import { ipcMain, dialog } from 'electron'
import { IPC } from '../../shared/constants'
import { runMirrorToCloudFolder, runDailyBackupToSubfolder, readManifest } from '../backup/cloud-backup'
import log from 'electron-log'

export function registerBackupHandlers(): void {
  ipcMain.handle(IPC.BACKUP_SELECT_CLOUD_FOLDER, async () => {
    try {
      const r = await dialog.showOpenDialog({
        title: 'Kies map voor cloud-synchronisatie (bijv. OneDrive of Google Drive)',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (r.canceled || !r.filePaths[0]) {
        return { ok: true, path: null as string | null }
      }
      return { ok: true, path: r.filePaths[0] }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('[backup-ipc] map kiezen mislukt', e)
      return { ok: false, error: msg, path: null as string | null }
    }
  })

  ipcMain.handle(IPC.BACKUP_GET_MANIFEST, async (_event, syncRoot?: string) => {
    try {
      const root = typeof syncRoot === 'string' ? syncRoot.trim() : ''
      if (!root) return { ok: true, manifest: null }
      return { ok: true, manifest: readManifest(path.resolve(root)) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg, manifest: null }
    }
  })

  ipcMain.handle(IPC.BACKUP_RUN_MIRROR_SYNC, async (_event, syncRoot?: string) => {
    try {
      const root = typeof syncRoot === 'string' ? syncRoot.trim() : ''
      if (!root) {
        return { ok: false, error: 'Geen map opgegeven.' }
      }
      const mirror = runMirrorToCloudFolder(root)
      if (!mirror.ok) return mirror
      const backup = runDailyBackupToSubfolder(root)
      if (!backup.ok) {
        return {
          ok: false,
          error: `Hoofdmap bijgewerkt, maar submap “backup” mislukt: ${backup.error}`,
        }
      }
      return {
        ok: true,
        dbPath: mirror.dbPath,
        documentFilesCopied: (mirror.documentFilesCopied ?? 0) + (backup.documentFilesCopied ?? 0),
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('[backup-ipc] handmatige sync mislukt', e)
      return { ok: false, error: msg }
    }
  })
}
