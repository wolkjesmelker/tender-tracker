import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'

export function registerZoektermenHandlers(): void {
  ipcMain.handle(IPC.ZOEKTERMEN_LIST, () => {
    return getDb().prepare('SELECT * FROM zoektermen ORDER BY volgorde, term').all()
  })

  ipcMain.handle(IPC.ZOEKTERMEN_CREATE, (_event, data: Record<string, unknown>) => {
    const db = getDb()
    const id = crypto.randomUUID().replace(/-/g, '')
    db.prepare('INSERT INTO zoektermen (id, term, categorie, volgorde) VALUES (?, ?, ?, ?)')
      .run(id, data.term, data.categorie ?? null, data.volgorde ?? 0)
    return db.prepare('SELECT * FROM zoektermen WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.ZOEKTERMEN_UPDATE, (_event, id: string, data: Record<string, unknown>) => {
    const db = getDb()
    const fields = Object.keys(data).filter(k => k !== 'id')
    if (fields.length === 0) return
    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => data[f])
    db.prepare(`UPDATE zoektermen SET ${setClause} WHERE id = ?`).run(...values, id)
    return db.prepare('SELECT * FROM zoektermen WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.ZOEKTERMEN_DELETE, (_event, id: string) => {
    getDb().prepare('DELETE FROM zoektermen WHERE id = ?').run(id)
    return { success: true }
  })
}
