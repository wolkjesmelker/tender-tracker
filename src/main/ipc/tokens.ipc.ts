import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { getTokenStats } from '../ai/token-logger'

export function registerTokenHandlers(): void {
  ipcMain.handle(IPC.TOKENS_GET_STATS, () => {
    return getTokenStats()
  })
}
