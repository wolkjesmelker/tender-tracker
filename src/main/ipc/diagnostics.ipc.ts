import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { getAnalysisPipelineDiagnosticsSnapshot } from './analysis.ipc'
import { collectAiDiagnosticsSnapshot } from '../ai/collect-ai-diagnostics'

export function registerDiagnosticsHandlers(): void {
  ipcMain.handle(IPC.AI_DIAGNOSTICS_SNAPSHOT, () => {
    return collectAiDiagnosticsSnapshot(getAnalysisPipelineDiagnosticsSnapshot())
  })
}
