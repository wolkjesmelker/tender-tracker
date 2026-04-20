import { app } from 'electron'
import path from 'path'
import fs from 'fs'

/** Interne opslag: onder userData, niet bedoeld als gebruikersmap in Finder (geen export- of open-knop). */
const INTERNAL_DOCUMENT_ROOT = 'internal-document-store'
/** Oude map (migratie / opruimen bij verwijderen) */
const LEGACY_DOCUMENT_ROOT = 'documents'

export function getAppDataPath(): string {
  return app.getPath('userData')
}

export function getExportPath(): string {
  const exportDir = path.join(getAppDataPath(), 'exports')
  fs.mkdirSync(exportDir, { recursive: true })
  return exportDir
}

export function getDocumentsPath(): string {
  const docsDir = path.join(getAppDataPath(), INTERNAL_DOCUMENT_ROOT)
  fs.mkdirSync(docsDir, { recursive: true })
  return docsDir
}

export function getTenderDocumentsDir(tenderId: string): string {
  return path.join(getDocumentsPath(), tenderId)
}

export type LocalDocumentFileInfo = { naam: string; size: number }

/** Alleen bestandsnaam zonder pad (voorkomt path traversal). */
export function assertSafeDocumentFileName(name: string): string | null {
  const t = String(name || '').trim()
  if (!t || t.includes('..') || t.includes('/') || t.includes('\\') || t.includes('\0')) return null
  return t
}

/** Volledig pad naar een lokaal opgeslagen bijlage, of null. */
export function resolveTenderDocumentFile(
  tenderId: string,
  fileName: string
): { fullPath: string; size: number } | null {
  const safeName = assertSafeDocumentFileName(fileName)
  if (!safeName || !tenderId?.trim()) return null
  const roots = [getDocumentsPath(), path.join(getAppDataPath(), LEGACY_DOCUMENT_ROOT)]

  for (const root of roots) {
    const dir = path.join(root, tenderId)
    const fullPath = path.join(dir, safeName)
    try {
      if (path.resolve(fullPath) !== path.resolve(dir, safeName)) continue
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const st = fs.statSync(fullPath)
        return { fullPath, size: st.size }
      }
    } catch {
      /* skip */
    }
  }
  return null
}

/** Bestanden die bij analyse voor deze aanbesteding zijn opgeslagen (intern). */
export function listTenderDocumentFiles(tenderId: string): LocalDocumentFileInfo[] {
  const byName = new Map<string, LocalDocumentFileInfo>()
  const roots = [getDocumentsPath(), path.join(getAppDataPath(), LEGACY_DOCUMENT_ROOT)]

  for (const root of roots) {
    const dir = path.join(root, tenderId)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue
    for (const naam of fs.readdirSync(dir)) {
      const p = path.join(dir, naam)
      try {
        const st = fs.statSync(p)
        if (!st.isFile()) continue
        const prev = byName.get(naam)
        if (!prev || st.size >= prev.size) byName.set(naam, { naam, size: st.size })
      } catch {
        /* skip */
      }
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.naam.localeCompare(b.naam))
}

/** Verwijdert alle lokaal opgeslagen bijlagen voor deze aanbesteding (nieuwe + legacy map). */
export function removeTenderDocumentsFolders(tenderId: string): void {
  const bases = [
    path.join(getAppDataPath(), INTERNAL_DOCUMENT_ROOT),
    path.join(getAppDataPath(), LEGACY_DOCUMENT_ROOT),
  ]
  for (const base of bases) {
    const dir = path.join(base, tenderId)
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    } catch {
      /* ignore */
    }
  }
}

export function getCookiesPath(): string {
  const cookiesDir = path.join(getAppDataPath(), 'cookies')
  try {
    if (fs.existsSync(cookiesDir)) {
      const st = fs.statSync(cookiesDir)
      if (st.isFile()) {
        const bak = `${cookiesDir}.was-file.${Date.now()}.bak`
        fs.renameSync(cookiesDir, bak)
      }
    }
  } catch (e) {
    /* laat mkdir hieronder falen met duidelijke fout */
  }
  fs.mkdirSync(cookiesDir, { recursive: true })
  return cookiesDir
}
