import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import log from 'electron-log'
import { getDb } from '../db/connection'
import { getAppDataPath, getDocumentsPath } from '../utils/paths'

const LEGACY_DOCUMENT_ROOT = 'documents'
const MANIFEST_NAME = 'tender-tracker-sync-manifest.json'

export type CloudSyncManifest = {
  lastMirrorAt: string | null
  lastBackupAt: string | null
  appVersion: string
}

export function readManifest(syncRoot: string): CloudSyncManifest {
  const p = path.join(syncRoot, MANIFEST_NAME)
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<CloudSyncManifest>
      return {
        lastMirrorAt: typeof raw.lastMirrorAt === 'string' ? raw.lastMirrorAt : null,
        lastBackupAt: typeof raw.lastBackupAt === 'string' ? raw.lastBackupAt : null,
        appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : app.getVersion(),
      }
    }
  } catch (e) {
    log.warn('[cloud-backup] manifest lezen mislukt', e)
  }
  return { lastMirrorAt: null, lastBackupAt: null, appVersion: app.getVersion() }
}

function writeManifest(syncRoot: string, patch: Partial<CloudSyncManifest>): void {
  const prev = readManifest(syncRoot)
  const next: CloudSyncManifest = {
    ...prev,
    ...patch,
    appVersion: app.getVersion(),
  }
  fs.writeFileSync(path.join(syncRoot, MANIFEST_NAME), JSON.stringify(next, null, 2), 'utf8')
}

/** SQLite-consistente kopie: VACUUM INTO naar tijdelijk bestand, daarna atomisch vervangen. */
export function vacuumDatabaseCopyTo(destDbPath: string): void {
  const dir = path.dirname(destDbPath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${destDbPath}.${process.pid}.tmp`
  try {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true })
  } catch {
    /* ignore */
  }
  const db = getDb()
  db.prepare('VACUUM INTO ?').run(tmp)
  fs.renameSync(tmp, destDbPath)
}

/**
 * Map kopiëren: alleen nieuwe/gewijzigde bestanden (geen verwijderingen doorzetten).
 */
export function copyTreeIncremental(srcRoot: string, destRoot: string): { filesCopied: number } {
  if (!fs.existsSync(srcRoot)) return { filesCopied: 0 }
  let filesCopied = 0

  function walk(rel: string): void {
    const srcDir = path.join(srcRoot, rel)
    const destDir = path.join(destRoot, rel)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(srcDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const relNext = rel ? path.join(rel, ent.name) : ent.name
      const src = path.join(srcRoot, relNext)
      const dest = path.join(destRoot, relNext)
      if (ent.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true })
        walk(relNext)
      } else if (ent.isFile()) {
        let need = true
        try {
          if (fs.existsSync(dest)) {
            const stS = fs.statSync(src)
            const stD = fs.statSync(dest)
            need = stS.mtimeMs > stD.mtimeMs || stS.size !== stD.size
          }
        } catch {
          need = true
        }
        if (need) {
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.copyFileSync(src, dest)
          filesCopied++
        }
      }
    }
  }

  fs.mkdirSync(destRoot, { recursive: true })
  walk('')
  return { filesCopied }
}

export type RunMirrorResult = {
  ok: boolean
  error?: string
  dbPath?: string
  documentFilesCopied?: number
}

export type RunBackupSubfolderResult = RunMirrorResult

function syncDocumentsTo(destBase: string): number {
  const appData = getAppDataPath()
  const internal = getDocumentsPath()
  const legacy = path.join(appData, LEGACY_DOCUMENT_ROOT)
  let n = 0
  n += copyTreeIncremental(internal, path.join(destBase, 'internal-document-store')).filesCopied
  n += copyTreeIncremental(legacy, path.join(destBase, 'documents')).filesCopied
  return n
}

/** Actuele spiegel in de gekozen cloud-map: vaste bestandsnamen, overschrijven / bijwerken. */
export function runMirrorToCloudFolder(syncRoot: string): RunMirrorResult {
  const root = path.resolve(syncRoot.trim())
  if (!root) return { ok: false, error: 'Geen synchronisatiemap ingesteld.' }
  try {
    fs.mkdirSync(root, { recursive: true })
    const backupDir = path.join(root, 'backup')
    fs.mkdirSync(backupDir, { recursive: true })

    const dbDest = path.join(root, 'tender-tracker.db')
    vacuumDatabaseCopyTo(dbDest)

    const docCopied = syncDocumentsTo(root)

    writeManifest(root, { lastMirrorAt: new Date().toISOString() })
    log.info(`[cloud-backup] Mirror voltooid: ${dbDest}, ${docCopied} documentbestand(en) bijgewerkt/toegevoegd`)
    return { ok: true, dbPath: dbDest, documentFilesCopied: docCopied }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    log.error('[cloud-backup] Mirror mislukt:', e)
    return { ok: false, error: msg }
  }
}

/**
 * Dagelijkse back-up in `…/backup/`:zelfde logica (één tender-tracker.db, incrementele documenten),
 * geen nieuwe kopie per dag met datum in de bestandsnaam.
 */
export function runDailyBackupToSubfolder(syncRoot: string): RunBackupSubfolderResult {
  const root = path.resolve(syncRoot.trim())
  if (!root) return { ok: false, error: 'Geen synchronisatiemap ingesteld.' }
  try {
    const backupDir = path.join(root, 'backup')
    fs.mkdirSync(backupDir, { recursive: true })

    const dbDest = path.join(backupDir, 'tender-tracker.db')
    vacuumDatabaseCopyTo(dbDest)

    const docCopied = syncDocumentsTo(backupDir)

    writeManifest(root, { lastBackupAt: new Date().toISOString() })
    log.info(`[cloud-backup] Dagelijkse backup-map bijgewerkt: ${dbDest}, ${docCopied} documentbestand(en)`)
    return { ok: true, dbPath: dbDest, documentFilesCopied: docCopied }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    log.error('[cloud-backup] Dagelijkse backup mislukt:', e)
    return { ok: false, error: msg }
  }
}

export function getCloudSyncSettingsFromDb(): { path: string; enabled: boolean } {
  const db = getDb()
  const rowPath = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('cloud_sync_path') as
    | { value: string }
    | undefined
  const rowEn = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('cloud_sync_enabled') as
    | { value: string }
    | undefined
  return {
    path: (rowPath?.value ?? '').trim(),
    enabled: rowEn?.value === '1' || rowEn?.value === 'true',
  }
}
