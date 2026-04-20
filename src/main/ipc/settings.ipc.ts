import { ipcMain } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_GET, (_event, key: string) => {
    const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  })

  ipcMain.handle(IPC.SETTINGS_SET, (_event, key: string, value: string) => {
    getDb().prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
    ).run(key, value, value)
    return { success: true }
  })

  ipcMain.handle(IPC.SETTINGS_GET_ALL, () => {
    const rows = getDb().prepare('SELECT key, value FROM app_settings').all() as { key: string, value: string }[]
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = row.value
    }
    return settings
  })
}
