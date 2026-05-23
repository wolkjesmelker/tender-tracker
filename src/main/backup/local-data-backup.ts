import path from 'path'
import fs from 'fs'
import cron from 'node-cron'
import { app } from 'electron'
import log from 'electron-log'
import { vacuumDatabaseCopyTo, copyTreeIncremental } from './cloud-backup'
import { getAppDataPath, getDocumentsPath } from '../utils/paths'

const LEGACY_DOCUMENT_ROOT = 'documents'
/** Maximaal aantal tijdstempel-mappen `backup-*` (rolling). */
const MAX_TIMESTAMPED_BACKUPS = 14
/** Minimale tijd tussen startup-backups (tenzij geforceerd). */
const STARTUP_BACKUP_MIN_INTERVAL_MS = 3 * 60 * 60 * 1000

const LOCAL_BACKUPS_LEAF = 'local-backups'

function getLocalBackupRoot(): string {
  return path.join(getAppDataPath(), LOCAL_BACKUPS_LEAF)
}

function rotateTimestampedBackups(): void {
  const root = getLocalBackupRoot()
  if (!fs.existsSync(root)) return
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('backup-'))
    .map((d) => path.join(root, d.name))
    .sort()
  while (dirs.length > MAX_TIMESTAMPED_BACKUPS) {
    const old = dirs.shift()
    if (!old) break
    try {
      fs.rmSync(old, { recursive: true, force: true })
      log.info(`[local-backup] Oude backup verwijderd: ${path.basename(old)}`)
    } catch (e) {
      log.warn('[local-backup] Opruimen mislukt', e)
    }
  }
}

function writeBackupReadme(dir: string, tag: string): void {
  const text = [
    'TenderTracker — lokale volledige back-up',
    '',
    `Aangemaakt: ${new Date().toISOString()}`,
    `Reden: ${tag}`,
    '',
    'Inhoud:',
    '- tender-tracker.db (SQLite, consistente kopie)',
    '- internal-document-store/ (bijlagen)',
    '- documents/ (legacy bijlagen)',
    '',
    'Herstel: kopieer tender-tracker.db naar Application Support/tender-tracker/',
    'en voeg documentmappen samen (app gestopt).',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(dir, 'LEESMIJ.txt'), text, 'utf8')
}

/**
 * Volledige lokale back-up: database (VACUUM INTO) + documentstores in één tijdstempel-map.
 */
export function runLocalFullBackup(tag: string): { ok: boolean; dir?: string; error?: string } {
  try {
    const root = getLocalBackupRoot()
    fs.mkdirSync(root, { recursive: true })
    const stamp = new Date().toISOString().split('.')[0].replace(/[-:]/g, '').replace('T', '_')
    const dir = path.join(root, `backup-${stamp}`)
    fs.mkdirSync(dir, { recursive: true })

    const dbDest = path.join(dir, 'tender-tracker.db')
    vacuumDatabaseCopyTo(dbDest)

    const appData = getAppDataPath()
    const internal = getDocumentsPath()
    const legacy = path.join(appData, LEGACY_DOCUMENT_ROOT)
    let files = 0
    files += copyTreeIncremental(internal, path.join(dir, 'internal-document-store')).filesCopied
    files += copyTreeIncremental(legacy, path.join(dir, 'documents')).filesCopied

    writeBackupReadme(dir, tag)
    rotateTimestampedBackups()

    const meta = { lastAt: new Date().toISOString(), lastDir: dir, tag }
    fs.writeFileSync(path.join(root, '.last-full-backup.json'), JSON.stringify(meta, null, 2), 'utf8')

    log.info(`[local-backup] Volledige back-up klaar: ${dir} (${files} documentbestand(en) bijgewerkt/toegevoegd)`)
    return { ok: true, dir }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    log.error('[local-backup] Volledige back-up mislukt:', e)
    return { ok: false, error: msg }
  }
}

function shouldRunStartupBackup(): boolean {
  const p = path.join(getLocalBackupRoot(), '.last-full-backup.json')
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { lastAt?: string }
    const t = raw.lastAt ? new Date(raw.lastAt).getTime() : 0
    if (!t) return true
    return Date.now() - t > STARTUP_BACKUP_MIN_INTERVAL_MS
  } catch {
    return true
  }
}

/** Niet-blokkerend: na opstart volledige back-up als de vorige ouder is dan het interval. */
export function scheduleStartupLocalBackupIfNeeded(): void {
  setImmediate(() => {
    try {
      if (!shouldRunStartupBackup()) {
        log.debug('[local-backup] Startup-back-up overgeslagen (recent genoeg)')
        return
      }
      void runLocalFullBackup('startup')
    } catch (e) {
      log.warn('[local-backup] Startup-planning mislukt', e)
    }
  })
}

/** Laatste sessie: alleen database (snel), overschrijft vaste map — handig bij crash net na wijzigingen. */
export function runLocalQuitDatabaseSnapshot(): void {
  try {
    const root = path.join(getLocalBackupRoot(), 'last-session')
    fs.mkdirSync(root, { recursive: true })
    const dbDest = path.join(root, 'tender-tracker.db')
    vacuumDatabaseCopyTo(dbDest)
    fs.writeFileSync(
      path.join(root, 'timestamp.txt'),
      `${new Date().toISOString()}\n`,
      'utf8',
    )
    log.info('[local-backup] Quit-snapshot database opgeslagen (last-session)')
  } catch (e) {
    log.warn('[local-backup] Quit-snapshot mislukt', e)
  }
}

let dailyLocalTask: cron.ScheduledTask | null = null

/** Dagelijks 02:00 + will-quit snapshot. */
export function initLocalDataBackupScheduler(): void {
  if (dailyLocalTask) {
    dailyLocalTask.stop()
    dailyLocalTask = null
  }

  if (!cron.validate('0 2 * * *')) {
    log.warn('[local-backup] Ongeldige cron')
    return
  }

  dailyLocalTask = cron.schedule('0 2 * * *', () => {
    log.info('[local-backup] Geplande dagelijkse volledige back-up')
    void runLocalFullBackup('scheduled-daily-02:00')
  })

  app.on('will-quit', () => {
    runLocalQuitDatabaseSnapshot()
  })

  log.info('[local-backup] Planner actief: dagelijks 02:00 + snapshot bij afsluiten (last-session/)')
}
