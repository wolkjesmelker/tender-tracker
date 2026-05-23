import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'
import type { TenderUpdate } from '../../shared/types'
import log from 'electron-log'

export function registerTenderUpdatesHandlers(): void {
  /** Haal alle (ongelezen) updates op, nieuwste eerst. */
  ipcMain.handle(IPC.TENDER_UPDATES_LIST, () => {
    try {
      const db = getDb()
      return db
        .prepare('SELECT * FROM tender_updates ORDER BY detected_at DESC LIMIT 200')
        .all() as TenderUpdate[]
    } catch (err: any) {
      log.error('TENDER_UPDATES_LIST:', err.message)
      return []
    }
  })

  /** Aantal ongelezen updates (badge). */
  ipcMain.handle(IPC.TENDER_UPDATES_COUNT, () => {
    try {
      const db = getDb()
      const row = db
        .prepare('SELECT COUNT(*) as c FROM tender_updates WHERE is_gelezen = 0')
        .get() as { c: number }
      return row.c
    } catch {
      return 0
    }
  })

  /** Markeer één update als gelezen. */
  ipcMain.handle(IPC.TENDER_UPDATES_MARK_READ, (_event, id: string) => {
    try {
      const db = getDb()
      db.prepare('UPDATE tender_updates SET is_gelezen = 1 WHERE id = ?').run(id)
      return true
    } catch {
      return false
    }
  })

  /** Markeer alle updates als gelezen. */
  ipcMain.handle(IPC.TENDER_UPDATES_MARK_ALL_READ, () => {
    try {
      const db = getDb()
      db.prepare('UPDATE tender_updates SET is_gelezen = 1').run()
      return true
    } catch {
      return false
    }
  })

  /** Verwijder alle updates. */
  ipcMain.handle(IPC.TENDER_UPDATES_CLEAR, () => {
    try {
      const db = getDb()
      db.prepare('DELETE FROM tender_updates').run()
      return true
    } catch {
      return false
    }
  })

  /** Haal ongelezen update(s) op voor één specifieke aanbesteding. */
  ipcMain.handle(IPC.TENDER_UPDATES_FOR_TENDER, (_event, aanbestedingId: string) => {
    try {
      const db = getDb()
      return db
        .prepare(
          'SELECT * FROM tender_updates WHERE aanbesteding_id = ? AND is_gelezen = 0 ORDER BY detected_at DESC LIMIT 10',
        )
        .all(aanbestedingId) as TenderUpdate[]
    } catch (err: any) {
      log.error('TENDER_UPDATES_FOR_TENDER:', err.message)
      return []
    }
  })
}
