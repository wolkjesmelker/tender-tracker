import { ipcMain } from 'electron'
import log from 'electron-log'
import { IPC } from '../../shared/constants'
import { runSync, runFullPush, runFullPull, getSyncStatus } from '../db/supabase-sync'
import { checkSupabaseConnection } from '../db/supabase-client'

let _autoSyncTimer: ReturnType<typeof setInterval> | null = null

/** Periodieke achtergrond-sync (elke 5 minuten) wanneer de sessie actief is. */
export function startAutoSync(): void {
  if (_autoSyncTimer) return
  _autoSyncTimer = setInterval(() => {
    void runSync('both').catch((e: unknown) =>
      log.warn('[sync-ipc] achtergrond-sync mislukt:', e)
    )
  }, 2 * 60 * 1000)
  log.info('[sync-ipc] Achtergrond-sync gestart (elke 2 minuten)')
}

export function stopAutoSync(): void {
  if (_autoSyncTimer) {
    clearInterval(_autoSyncTimer)
    _autoSyncTimer = null
  }
}

export function registerSyncHandlers(): void {
  ipcMain.handle(IPC.SYNC_TEST_CONNECTION, async () => checkSupabaseConnection())

  ipcMain.handle(IPC.SYNC_STATUS, () => getSyncStatus())

  ipcMain.handle(IPC.SYNC_NOW, async () => {
    return runSync('both')
  })

  ipcMain.handle(IPC.SYNC_FULL_PUSH, async (event) => {
    return runFullPush((p) => {
      const s = event.sender
      if (s.isDestroyed()) return
      s.send(IPC.SYNC_PROGRESS, p)
    })
  })

  ipcMain.handle(IPC.SYNC_FULL_PULL, async () => {
    return runFullPull()
  })
}
