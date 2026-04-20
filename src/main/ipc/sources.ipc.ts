import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'

export function registerSourceHandlers(): void {
  ipcMain.handle(IPC.SOURCES_LIST, () => {
    return getDb().prepare('SELECT * FROM bron_websites ORDER BY naam').all()
  })

  ipcMain.handle(IPC.SOURCES_GET, (_event, id: string) => {
    return getDb().prepare('SELECT * FROM bron_websites WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.SOURCES_CREATE, (_event, data: Record<string, unknown>) => {
    const db = getDb()
    const id = crypto.randomUUID().replace(/-/g, '')
    db.prepare(
      'INSERT INTO bron_websites (id, naam, url, login_url, auth_type, vakgebied, zoekpad) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.naam, data.url, data.login_url ?? null, data.auth_type ?? 'none', data.vakgebied ?? 'Infrastructuur', data.zoekpad ?? null)
    return db.prepare('SELECT * FROM bron_websites WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.SOURCES_UPDATE, (_event, id: string, data: Record<string, unknown>) => {
    const db = getDb()
    const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'created_at')
    if (fields.length === 0) return
    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => data[f])
    db.prepare(`UPDATE bron_websites SET ${setClause}, updated_at = datetime('now') WHERE id = ?`).run(...values, id)
    return db.prepare('SELECT * FROM bron_websites WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.SOURCES_DELETE, (_event, id: string) => {
    const db = getDb()
    const deleteSource = db.transaction(() => {
      db.prepare('UPDATE aanbestedingen SET bron_website_id = NULL WHERE bron_website_id = ?').run(id)
      db.prepare('UPDATE scrape_jobs SET bron_website_id = NULL WHERE bron_website_id = ?').run(id)
      db.prepare('DELETE FROM bron_websites WHERE id = ?').run(id)
    })
    deleteSource()
    return { success: true }
  })
}
