import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'
import { requestDebouncedCloudPush } from '../db/supabase-sync'

export function registerCriteriaHandlers(): void {
  ipcMain.handle(IPC.CRITERIA_LIST, () => {
    return getDb().prepare('SELECT * FROM criteria ORDER BY volgorde, naam').all()
  })

  ipcMain.handle(IPC.CRITERIA_CREATE, (_event, data: Record<string, unknown>) => {
    const db = getDb()
    const id = crypto.randomUUID().replace(/-/g, '')
    db.prepare('INSERT INTO criteria (id, naam, beschrijving, gewicht, volgorde) VALUES (?, ?, ?, ?, ?)')
      .run(id, data.naam, data.beschrijving ?? null, data.gewicht ?? 10, data.volgorde ?? 0)
    requestDebouncedCloudPush()
    return db.prepare('SELECT * FROM criteria WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.CRITERIA_UPDATE, (_event, id: string, data: Record<string, unknown>) => {
    const db = getDb()
    const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'updated_at')
    if (fields.length === 0) return
    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => data[f])
    db.prepare(`UPDATE criteria SET ${setClause}, updated_at = datetime('now') WHERE id = ?`).run(...values, id)
    requestDebouncedCloudPush()
    return db.prepare('SELECT * FROM criteria WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.CRITERIA_DELETE, (_event, id: string) => {
    getDb().prepare('DELETE FROM criteria WHERE id = ?').run(id)
    requestDebouncedCloudPush()
    return { success: true }
  })
}
