import { ipcMain, dialog } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'
import { generatePdf } from '../export/pdf-generator'
import { generateWord } from '../export/word-generator'
import { getMainWindow } from '../index'
import fs from 'fs'
import log from 'electron-log'

export function registerExportHandlers(): void {
  ipcMain.handle(IPC.EXPORT_GENERATE, async (_event, options: {
    format: 'pdf' | 'word',
    aanbestedingIds: string[],
    includeAnalysis?: boolean,
    includeScores?: boolean,
  }) => {
    const db = getDb()
    const tenders = db.prepare(
      `SELECT * FROM aanbestedingen WHERE id IN (${options.aanbestedingIds.map(() => '?').join(',')})`
    ).all(...options.aanbestedingIds) as any[]

    if (tenders.length === 0) {
      return { success: false, error: 'Geen aanbestedingen gevonden' }
    }

    const criteria = db.prepare('SELECT * FROM criteria WHERE is_actief = 1 ORDER BY volgorde').all() as any[]
    const questions = db.prepare('SELECT * FROM ai_vragen WHERE is_actief = 1 ORDER BY volgorde').all() as any[]

    const sanitize = (name: string) =>
      name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80)

    const datePart = new Date().toISOString().slice(0, 10)
    const baseName = tenders.length === 1
      ? `${sanitize(tenders[0].titel)} - ${datePart}`
      : `aanbestedingen-export (${tenders.length}) - ${datePart}`

    try {
      let buffer: Buffer
      let defaultName: string

      if (options.format === 'pdf') {
        buffer = await generatePdf(tenders, criteria, questions, options)
        defaultName = `${baseName}.pdf`
      } else {
        buffer = await generateWord(tenders, criteria, questions, options)
        defaultName = `${baseName}.docx`
      }

      const mainWindow = getMainWindow()
      const result = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: defaultName,
        filters: options.format === 'pdf'
          ? [{ name: 'PDF', extensions: ['pdf'] }]
          : [{ name: 'Word Document', extensions: ['docx'] }],
      })

      if (!result.canceled && result.filePath) {
        fs.writeFileSync(result.filePath, buffer)
        return { success: true, filePath: result.filePath }
      }

      return { success: false, error: 'Export geannuleerd' }
    } catch (error: any) {
      log.error('Export failed:', error)
      return { success: false, error: error.message }
    }
  })
}
