import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { getTokenStats, resetTokenStats } from '../ai/token-logger'

export function registerTokenHandlers(): void {
  ipcMain.handle(IPC.TOKENS_GET_STATS, () => {
    return getTokenStats()
  })
  ipcMain.handle(IPC.TOKENS_RESET, () => {
    resetTokenStats()
    return { ok: true }
  })
}
