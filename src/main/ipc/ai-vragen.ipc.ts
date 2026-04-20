import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'

export function registerAIVragenHandlers(): void {
  ipcMain.handle(IPC.AI_VRAGEN_LIST, () => {
    return getDb().prepare('SELECT * FROM ai_vragen ORDER BY volgorde, vraag').all()
  })

  ipcMain.handle(IPC.AI_VRAGEN_CREATE, (_event, data: Record<string, unknown>) => {
    const db = getDb()
    const id = crypto.randomUUID().replace(/-/g, '')
    db.prepare('INSERT INTO ai_vragen (id, vraag, categorie, is_standaard, volgorde) VALUES (?, ?, ?, ?, ?)')
      .run(id, data.vraag, data.categorie ?? null, data.is_standaard ? 1 : 0, data.volgorde ?? 0)
    return db.prepare('SELECT * FROM ai_vragen WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.AI_VRAGEN_UPDATE, (_event, id: string, data: Record<string, unknown>) => {
    const db = getDb()
    const fields = Object.keys(data).filter(k => k !== 'id')
    if (fields.length === 0) return
    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => data[f])
    db.prepare(`UPDATE ai_vragen SET ${setClause} WHERE id = ?`).run(...values, id)
    return db.prepare('SELECT * FROM ai_vragen WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.AI_VRAGEN_DELETE, (_event, id: string) => {
    getDb().prepare('DELETE FROM ai_vragen WHERE id = ?').run(id)
    return { success: true }
  })
}
