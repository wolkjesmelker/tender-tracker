import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'
import { addSchedule, removeSchedule, toggleSchedule } from '../scheduler/scheduler'

export function registerSchedulerHandlers(): void {
  ipcMain.handle(IPC.SCHEDULER_LIST, () => {
    return getDb().prepare('SELECT * FROM scrape_schema ORDER BY naam').all()
  })

  ipcMain.handle(IPC.SCHEDULER_CREATE, (_event, data: Record<string, unknown>) => {
    const db = getDb()
    const id = crypto.randomUUID().replace(/-/g, '')
    db.prepare('INSERT INTO scrape_schema (id, naam, cron_expressie, bron_website_ids, zoektermen) VALUES (?, ?, ?, ?, ?)')
      .run(id, data.naam, data.cron_expressie, JSON.stringify(data.bron_website_ids), data.zoektermen ? JSON.stringify(data.zoektermen) : null)

    const schedule = db.prepare('SELECT * FROM scrape_schema WHERE id = ?').get(id) as any
    addSchedule(schedule)
    return schedule
  })

  ipcMain.handle(IPC.SCHEDULER_UPDATE, (_event, id: string, data: Record<string, unknown>) => {
    const db = getDb()
    const fields = Object.keys(data).filter(k => k !== 'id')
    if (fields.length === 0) return
    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => {
      const v = data[f]
      return Array.isArray(v) ? JSON.stringify(v) : v
    })
    db.prepare(`UPDATE scrape_schema SET ${setClause} WHERE id = ?`).run(...values, id)
    const schedule = db.prepare('SELECT * FROM scrape_schema WHERE id = ?').get(id) as any
    removeSchedule(id)
    if (schedule.is_actief) addSchedule(schedule)
    return schedule
  })

  ipcMain.handle(IPC.SCHEDULER_DELETE, (_event, id: string) => {
    removeSchedule(id)
    getDb().prepare('DELETE FROM scrape_schema WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle(IPC.SCHEDULER_TOGGLE, (_event, id: string) => {
    const db = getDb()
    const schedule = db.prepare('SELECT * FROM scrape_schema WHERE id = ?').get(id) as any
    const newActive = schedule.is_actief ? 0 : 1
    db.prepare('UPDATE scrape_schema SET is_actief = ? WHERE id = ?').run(newActive, id)
    toggleSchedule(id, newActive === 1)
    return db.prepare('SELECT * FROM scrape_schema WHERE id = ?').get(id)
  })
}
