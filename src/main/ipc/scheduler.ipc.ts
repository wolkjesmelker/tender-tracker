import { ipcMain } from 'electron'
import cron from 'node-cron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'
import { requestDebouncedCloudPush } from '../db/supabase-sync'
import { addSchedule, removeSchedule, toggleSchedule } from '../scheduler/scheduler'

function assertValidCron(expr: unknown): string {
  const s = typeof expr === 'string' ? expr.trim() : ''
  if (!s || !cron.validate(s)) {
    throw new Error(`Ongeldige planning (cron): "${String(expr)}". Controleer het schema in Instellingen.`)
  }
  return s
}

export function registerSchedulerHandlers(): void {
  ipcMain.handle(IPC.SCHEDULER_LIST, () => {
    return getDb().prepare('SELECT * FROM scrape_schema ORDER BY naam').all()
  })

  ipcMain.handle(IPC.SCHEDULER_CREATE, (_event, data: Record<string, unknown>) => {
    const cronExpr = assertValidCron(data.cron_expressie)
    const db = getDb()
    const id = crypto.randomUUID().replace(/-/g, '')
    db.prepare('INSERT INTO scrape_schema (id, naam, cron_expressie, bron_website_ids, zoektermen) VALUES (?, ?, ?, ?, ?)')
      .run(id, data.naam, cronExpr, JSON.stringify(data.bron_website_ids), data.zoektermen ? JSON.stringify(data.zoektermen) : null)

    const schedule = db.prepare('SELECT * FROM scrape_schema WHERE id = ?').get(id) as any
    addSchedule(schedule)
    requestDebouncedCloudPush()
    return schedule
  })

  ipcMain.handle(IPC.SCHEDULER_UPDATE, (_event, id: string, data: Record<string, unknown>) => {
    const db = getDb()
    if (Object.prototype.hasOwnProperty.call(data, 'cron_expressie')) {
      assertValidCron(data.cron_expressie)
    }
    const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'updated_at')
    if (fields.length === 0) return
    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => {
      const v = data[f]
      return Array.isArray(v) ? JSON.stringify(v) : v
    })
    db.prepare(`UPDATE scrape_schema SET ${setClause}, updated_at = datetime('now') WHERE id = ?`).run(...values, id)
    const schedule = db.prepare('SELECT * FROM scrape_schema WHERE id = ?').get(id) as any
    removeSchedule(id)
    if (schedule.is_actief) addSchedule(schedule)
    requestDebouncedCloudPush()
    return schedule
  })

  ipcMain.handle(IPC.SCHEDULER_DELETE, (_event, id: string) => {
    removeSchedule(id)
    getDb().prepare('DELETE FROM scrape_schema WHERE id = ?').run(id)
    requestDebouncedCloudPush()
    return { success: true }
  })

  ipcMain.handle(IPC.SCHEDULER_TOGGLE, (_event, id: string) => {
    const db = getDb()
    const schedule = db.prepare('SELECT * FROM scrape_schema WHERE id = ?').get(id) as any
    const newActive = schedule.is_actief ? 0 : 1
    db.prepare('UPDATE scrape_schema SET is_actief = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newActive, id)
    toggleSchedule(id, newActive === 1)
    requestDebouncedCloudPush()
    return db.prepare('SELECT * FROM scrape_schema WHERE id = ?').get(id)
  })
}
