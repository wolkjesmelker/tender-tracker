import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import log from 'electron-log'

const STABLE_LEAF = 'tender-tracker'
const ALT_LEAVES = ['TenderTracker', 'tender-tracker']

function safeCount(db: Database.Database, sql: string): number {
  try {
    return (db.prepare(sql).get() as { c: number }).c
  } catch {
    return 0
  }
}

/** Heuristiek: welke DB het meeste “werk” bevat (aanbestedingen + analyses). */
function scoreDatabaseFile(dbPath: string): number {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const tenders = safeCount(db, 'SELECT COUNT(*) AS c FROM aanbestedingen')
      const summ = safeCount(
        db,
        `SELECT COUNT(*) AS c FROM aanbestedingen WHERE ai_samenvatting IS NOT NULL AND TRIM(ai_samenvatting) != ''`,
      )
      const bijl = safeCount(
        db,
        `SELECT COUNT(*) AS c FROM aanbestedingen WHERE bijlage_analyses IS NOT NULL AND TRIM(bijlage_analyses) NOT IN ('','[]')`,
      )
      const extr = safeCount(
        db,
        `SELECT COUNT(*) AS c FROM aanbestedingen WHERE ai_extracted_fields IS NOT NULL AND TRIM(ai_extracted_fields) NOT IN ('','{}')`,
      )
      return tenders * 10 + summ * 100 + bijl * 50 + extr * 30
    } finally {
      db.close()
    }
  } catch {
    return -1
  }
}

function removeSqliteSidecars(dbPath: string): void {
  for (const ext of ['-wal', '-shm']) {
    const p = dbPath + ext
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true })
    } catch {
      /* ignore */
    }
  }
}

/** Kopieer nieuwere/ontbrekende bestanden van srcRoot naar destRoot (platte directory-boom). */
function mergeDirectoryTrees(srcRoot: string, destRoot: string): { files: number } {
  if (!fs.existsSync(srcRoot)) return { files: 0 }
  let files = 0

  function walk(rel: string): void {
    const srcDir = path.join(srcRoot, rel)
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
          files++
        }
      }
    }
  }

  fs.mkdirSync(destRoot, { recursive: true })
  walk('')
  return { files }
}

type DbCandidate = { dbPath: string; userDataDir: string; score: number }

function collectDbCandidates(appData: string, defaultUserData: string): DbCandidate[] {
  const seen = new Set<string>()
  const out: DbCandidate[] = []

  const tryPush = (userDataDir: string) => {
    const dbPath = path.join(userDataDir, 'tender-tracker.db')
    const key = path.resolve(dbPath)
    if (seen.has(key)) return
    seen.add(key)
    if (!fs.existsSync(dbPath)) return
    const score = scoreDatabaseFile(dbPath)
    if (score < 0) return
    out.push({ dbPath, userDataDir, score })
  }

  for (const leaf of ALT_LEAVES) {
    tryPush(path.join(appData, leaf))
  }
  tryPush(defaultUserData)

  return out
}

/**
 * Zorgt dat alle builds (dev, DMG met productName TenderTracker) dezelfde userData-map gebruiken
 * en dat bij installatie de “rijkste” bestaande SQLite-kopie wordt overgenomen (herstel analyses).
 * Moet vóór `app.whenReady()` en vóór `initDatabase()` worden aangeroepen.
 */
export function ensureUnifiedUserDataPath(): void {
  try {
    const appData = app.getPath('appData')
    const defaultUserData = app.getPath('userData')
    const stableDir = path.join(appData, STABLE_LEAF)
    const stableDb = path.join(stableDir, 'tender-tracker.db')

    const candidates = collectDbCandidates(appData, defaultUserData)
    if (candidates.length === 0) {
      fs.mkdirSync(stableDir, { recursive: true })
      app.setPath('userData', stableDir)
      log.info(`[userData] Geen bestaande database; userData = ${stableDir}`)
      return
    }

    const best = candidates.reduce((a, b) => (b.score > a.score ? b : a))

    if (path.resolve(best.dbPath) !== path.resolve(stableDb)) {
      fs.mkdirSync(stableDir, { recursive: true })
      if (fs.existsSync(stableDb)) {
        const bak = `${stableDb}.pre-unify-${Date.now()}.bak`
        fs.copyFileSync(stableDb, bak)
        log.warn(`[userData] Bestaande DB in ${STABLE_LEAF} geback-upt naar ${bak}`)
      }
      removeSqliteSidecars(stableDb)
      fs.copyFileSync(best.dbPath, stableDb)
      log.info(
        `[userData] Database gekopieerd van ${best.userDataDir} (score ${best.score}) naar ${stableDb}`,
      )

      for (const sub of ['internal-document-store', 'documents']) {
        const n = mergeDirectoryTrees(
          path.join(best.userDataDir, sub),
          path.join(stableDir, sub),
        ).files
        if (n > 0) log.info(`[userData] ${n} bestand(en) samengevoegd voor ${sub}`)
      }
    } else if (!fs.existsSync(stableDir)) {
      fs.mkdirSync(stableDir, { recursive: true })
    }

    app.setPath('userData', stableDir)
    log.info(`[userData] userData vastgezet op ${stableDir}`)
  } catch (e) {
    log.error('[userData] ensureUnifiedUserDataPath mislukt', e)
  }
}
