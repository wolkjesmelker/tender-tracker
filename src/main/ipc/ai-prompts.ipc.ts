import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'
import { requestDebouncedCloudPush } from '../db/supabase-sync'

export function registerAIPromptsHandlers(): void {
  ipcMain.handle(IPC.AI_PROMPTS_LIST, () => {
    return getDb().prepare('SELECT * FROM ai_prompts ORDER BY type, naam').all()
  })

  ipcMain.handle(IPC.AI_PROMPTS_GET, (_event, id: string) => {
    return getDb().prepare('SELECT * FROM ai_prompts WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.AI_PROMPTS_CREATE, (_event, data: Record<string, unknown>) => {
    const db = getDb()
    const id = crypto.randomUUID().replace(/-/g, '')
    db.prepare('INSERT INTO ai_prompts (id, naam, type, agent_naam, prompt_tekst, beschrijving) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, data.naam, data.type, data.agent_naam ?? null, data.prompt_tekst, data.beschrijving ?? null)
    requestDebouncedCloudPush()
    return db.prepare('SELECT * FROM ai_prompts WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.AI_PROMPTS_UPDATE, (_event, id: string, data: Record<string, unknown>) => {
    const db = getDb()
    const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'updated_at')
    if (fields.length === 0) return
    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => data[f])
    db.prepare(`UPDATE ai_prompts SET ${setClause}, updated_at = datetime('now') WHERE id = ?`).run(...values, id)
    requestDebouncedCloudPush()
    return db.prepare('SELECT * FROM ai_prompts WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.AI_PROMPTS_DELETE, (_event, id: string) => {
    getDb().prepare('DELETE FROM ai_prompts WHERE id = ?').run(id)
    requestDebouncedCloudPush()
    return { success: true }
  })
}
