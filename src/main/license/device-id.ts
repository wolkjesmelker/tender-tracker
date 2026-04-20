import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const FILE = '.tender-tracker-device-id'

/** Stabiele installatie-ID per userData-map (één “seat” per installatie). */
export function getOrCreateDeviceId(): string {
  const dir = app.getPath('userData')
  const filePath = path.join(dir, FILE)
  try {
    const existing = fs.readFileSync(filePath, 'utf-8').trim()
    if (existing.length >= 16) return existing
  } catch {
    /* eerste start */
  }
  const id = crypto.randomUUID()
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath, id, 'utf-8')
  } catch {
    /* fallback: geen schijf — toch een sessie-id */
  }
  return id
}
