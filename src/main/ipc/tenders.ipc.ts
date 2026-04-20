import { ipcMain, dialog, shell, app } from 'electron'
import log from 'electron-log'
import fs from 'fs'
import path from 'path'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'
import type { Aanbesteding, BronNavigatieLink, DashboardStats, TenderProcedureContext } from '../../shared/types'
import {
  listTenderDocumentFiles,
  removeTenderDocumentsFolders,
  resolveTenderDocumentFile,
} from '../utils/paths'
import { discoverDocumentsFromBronWithAi } from '../ai/document-discovery'
import { getMainWindow } from '../index'
import { acquireBusyWorkBlocker, releaseBusyWorkBlocker } from '../utils/busy-work-blocker'
import { IMAGE_PREVIEW_EXT, MAX_INLINE_PREVIEW_BYTES } from '../../shared/local-doc-preview'
import { buildDocumentPreviewFromBuffer } from '../utils/document-preview-from-buffer'
import {
  extractTenderNedPublicatieId,
  fetchBufferFromUrl,
  fetchTenderNedFromTnsApi,
  getSessionPartitionForBronUrl,
  isZipDocumentEntry,
  resolveCanonicalBronUrlForAnalysis,
  type DocumentInfo,
} from '../scraping/document-fetcher'
import { expandZipEntriesInDocumentList } from '../scraping/zip-document-expand'
import {
  attachLinksToTimeline,
  buildMinimalProcedureContext,
  mergeProcedurePortals,
} from '../scraping/procedure-context'
import { randomUUID } from 'crypto'
import os from 'os'

function parseStoredDocumentUrlsForNormalize(json: string | null | undefined): DocumentInfo[] {
  if (!json?.trim()) return []
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr
      .map((x: Record<string, unknown>) => ({
        url: String(x.url || ''),
        localNaam: x.localNaam ? String(x.localNaam) : undefined,
        naam: String(x.naam || 'Document'),
        type: String(x.type || ''),
        bronZipLabel: x.bronZipLabel ? String(x.bronZipLabel) : undefined,
      }))
      .filter((d: DocumentInfo) => Boolean(d.url?.trim() || d.localNaam?.trim()))
  } catch {
    return []
  }
}

function parseBronNavForProc(json: string | null | undefined): BronNavigatieLink[] {
  if (!json?.trim()) return []
  try {
    const raw = JSON.parse(json)
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (x: unknown) =>
        x &&
        typeof x === 'object' &&
        typeof (x as BronNavigatieLink).url === 'string' &&
        (x as BronNavigatieLink).url.length > 5
    ) as BronNavigatieLink[]
  } catch {
    return []
  }
}

function procedureNeedsBackfill(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return true
  try {
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object') return true
    if (!Array.isArray(o.timeline) || o.timeline.length === 0) return true
  } catch {
    return true
  }
  return false
}

function mimeForLargePlaceholder(ext: string): string {
  const e = ext.toLowerCase()
  if (e === '.pdf') return 'application/pdf'
  if (IMAGE_PREVIEW_EXT[e]) return IMAGE_PREVIEW_EXT[e]
  if (e === '.svg') return 'image/svg+xml'
  return 'application/octet-stream'
}

export function registerTenderHandlers(): void {
  ipcMain.handle(IPC.TENDERS_LIST, (_event, filters?: Record<string, unknown>) => {
    const db = getDb()
    let query = 'SELECT * FROM aanbestedingen'
    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.status) {
      conditions.push('status = ?')
      params.push(filters.status)
    } else {
      // Standaard: verberg gearchiveerde aanbestedingen (waaronder automatisch
      // gearchiveerde gunningsaankondigingen). Worden alleen getoond als de
      // gebruiker bewust status='gearchiveerd' kiest.
      conditions.push("status != 'gearchiveerd'")
    }
    if (filters?.bron_website_id) {
      conditions.push('bron_website_id = ?')
      params.push(filters.bron_website_id)
    }
    if (filters?.search) {
      conditions.push('(titel LIKE ? OR beschrijving LIKE ? OR opdrachtgever LIKE ?)')
      const searchTerm = `%${filters.search}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }
    if (filters?.minScore !== undefined) {
      conditions.push('totaal_score >= ?')
      params.push(filters.minScore)
    }
    if (filters?.createdToday) {
      conditions.push("DATE(created_at) = DATE('now')")
    }
    if (filters?.urgentOnly) {
      conditions.push("sluitingsdatum IS NOT NULL AND DATE(sluitingsdatum) BETWEEN DATE('now') AND DATE('now', '+7 days')")
    }

    // Hide expired tenders by default (unless explicitly requesting them)
    if (filters?.showVerlopen === true) {
      // Show ONLY expired
      conditions.push("sluitingsdatum IS NOT NULL AND DATE(sluitingsdatum) < DATE('now')")
    } else if (filters?.showVerlopen !== 'all') {
      // Default: verberg verlopen. Rijen zonder geldige datum blijven zichtbaar (BOSA e.a. leveren vaak DD/MM/JJJJ;
      // SQLite date() geeft dan NULL en zou ze anders onterecht uit "actief" filteren).
      conditions.push(
        "(sluitingsdatum IS NULL OR TRIM(COALESCE(sluitingsdatum,'')) = '' OR DATE(sluitingsdatum) IS NULL OR DATE(sluitingsdatum) >= DATE('now'))"
      )
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ' ORDER BY datetime(created_at) DESC, COALESCE(totaal_score, 0) DESC'

    if (filters?.limit) {
      query += ' LIMIT ?'
      params.push(filters.limit)
    }

    return db.prepare(query).all(...params)
  })

  ipcMain.handle(IPC.TENDERS_GET, (_event, id: string) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      ...row,
      local_document_files: listTenderDocumentFiles(id),
    }
  })

  ipcMain.handle(IPC.TENDERS_UPDATE, (_event, id: string, data: Partial<Aanbesteding>) => {
    const db = getDb()
    const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'created_at')
    if (fields.length === 0) return

    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => (data as Record<string, unknown>)[f])

    db.prepare(`UPDATE aanbestedingen SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
      .run(...values, id)

    return db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.TENDERS_DELETE, (_event, id: string) => {
    const db = getDb()
    removeTenderDocumentsFolders(id)
    db.prepare('DELETE FROM aanbestedingen WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle(IPC.TENDERS_DELETE_MANY, (_event, ids: string[]) => {
    const db = getDb()
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: true, deleted: 0 }
    }
    for (const id of ids) {
      removeTenderDocumentsFolders(id)
    }
    const placeholders = ids.map(() => '?').join(',')
    const info = db.prepare(`DELETE FROM aanbestedingen WHERE id IN (${placeholders})`).run(...ids)
    return { success: true, deleted: info.changes }
  })

  ipcMain.handle(IPC.TENDERS_STATS, () => {
    const db = getDb()
    const total = (db.prepare('SELECT COUNT(*) as c FROM aanbestedingen').get() as { c: number }).c
    const active = (db.prepare("SELECT COUNT(*) as c FROM aanbestedingen WHERE status IN ('gevonden','gekwalificeerd','in_aanbieding')").get() as { c: number }).c
    const today = (db.prepare("SELECT COUNT(*) as c FROM aanbestedingen WHERE DATE(created_at) = DATE('now')").get() as { c: number }).c
    const urgent = (db.prepare("SELECT COUNT(*) as c FROM aanbestedingen WHERE sluitingsdatum IS NOT NULL AND DATE(sluitingsdatum) BETWEEN DATE('now') AND DATE('now', '+7 days')").get() as { c: number }).c
    const avgScore = (db.prepare('SELECT AVG(totaal_score) as avg FROM aanbestedingen WHERE totaal_score IS NOT NULL').get() as { avg: number | null }).avg

    return {
      totaalAanbestedingen: total,
      actieveAanbestedingen: active,
      gevondenVandaag: today,
      urgentDeadlines: urgent,
      gemiddeldeScore: avgScore ?? 0,
    } satisfies DashboardStats
  })

  ipcMain.handle(IPC.TENDERS_DISCOVER_DOCUMENTS, async (_event, id: string) => {
    const db = getDb()
    const settingsRows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
    const settingsMap: Record<string, string> = {}
    settingsRows.forEach(r => {
      settingsMap[r.key] = r.value
    })

    const mainWindow = getMainWindow()
    acquireBusyWorkBlocker('document-discovery')
    try {
      const result = await discoverDocumentsFromBronWithAi(id, settingsMap, p => {
        mainWindow?.webContents.send(IPC.DOCUMENTS_DISCOVER_PROGRESS, { aanbestedingId: id, ...p })
      })
      if (!result.success) {
        return { success: false, error: result.error }
      }
      return { success: true, documentCount: result.documentCount }
    } catch (e: any) {
      log.error('TENDERS_DISCOVER_DOCUMENTS failed:', e)
      return { success: false, error: e?.message || 'Documenten zoeken mislukt' }
    } finally {
      releaseBusyWorkBlocker('document-discovery')
    }
  })

  /**
   * Bij openen detail: ZIP’s in document_urls uitpakken + procedure-context vullen (TNS/minimaal)
   * zodat de tijdlijn zichtbaar wordt zonder handmatig «Documenten zoeken».
   */
  ipcMain.handle(IPC.TENDERS_NORMALIZE_ON_OPEN, async (_event, id: string) => {
    const db = getDb()
    const row = db
      .prepare(
        `SELECT id, bron_url, document_urls, tender_procedure_context, bron_navigatie_links FROM aanbestedingen WHERE id = ?`
      )
      .get(id) as
        | {
            id: string
            bron_url: string | null
            document_urls: string | null
            tender_procedure_context: string | null
            bron_navigatie_links: string | null
          }
        | undefined
    if (!row) return { success: false as const, updated: false }

    const bron = String(row.bron_url || '').trim()
    const resolved = bron ? resolveCanonicalBronUrlForAnalysis(bron) : ''
    const partition = getSessionPartitionForBronUrl(bron) || undefined

    let docs = parseStoredDocumentUrlsForNormalize(row.document_urls)
    const docsBefore = JSON.stringify(docs)
    const hasExpandableZip = docs.some((d) => isZipDocumentEntry(d) && d.url?.trim())
    if (hasExpandableZip) {
      docs = await expandZipEntriesInDocumentList(id, docs, partition, resolved || undefined)
    }
    const docsChanged = JSON.stringify(docs) !== docsBefore

    let procOut: string | null = null
    const navLinks = parseBronNavForProc(row.bron_navigatie_links)
    if (resolved && procedureNeedsBackfill(row.tender_procedure_context)) {
      let procCtx: TenderProcedureContext | null = null
      const tnId = extractTenderNedPublicatieId(resolved)
      if (tnId) {
        try {
          const tns = await fetchTenderNedFromTnsApi(tnId)
          procCtx = (tns?.procedureContext as TenderProcedureContext) ?? null
        } catch (e: unknown) {
          log.warn('normalize-on-open: TenderNed TNS procedure ophalen mislukt', e)
        }
      }
      if (!procCtx) procCtx = buildMinimalProcedureContext(resolved)
      if (navLinks.length) {
        procCtx = mergeProcedurePortals(procCtx, navLinks)
        procCtx = attachLinksToTimeline(procCtx, navLinks)
      }
      procOut = JSON.stringify(procCtx)
    }

    if (!docsChanged && !procOut) {
      return { success: true as const, updated: false }
    }

    const sets: string[] = []
    const vals: unknown[] = []
    if (docsChanged) {
      sets.push('document_urls = ?')
      vals.push(JSON.stringify(docs))
    }
    if (procOut) {
      sets.push('tender_procedure_context = ?')
      vals.push(procOut)
    }
    db.prepare(`UPDATE aanbestedingen SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(
      ...vals,
      id
    )
    log.info(`TENDERS_NORMALIZE_ON_OPEN ${id}: docs=${docsChanged} procedure=${Boolean(procOut)}`)
    return { success: true as const, updated: true }
  })

  ipcMain.handle(
    IPC.TENDERS_LOCAL_DOC_READ,
    async (_event, payload: { tenderId: string; fileName: string }) => {
      const tenderId = String(payload?.tenderId || '')
      const fileName = String(payload?.fileName || '')
      const resolved = resolveTenderDocumentFile(tenderId, fileName)
      if (!resolved) {
        return { success: false as const, error: 'Bestand niet gevonden' }
      }
      const { fullPath, size } = resolved
      const ext = path.extname(fileName).toLowerCase()

      // For large non-PDF files: show placeholder (no content preview)
      if (size > MAX_INLINE_PREVIEW_BYTES && ext !== '.pdf') {
        return {
          success: true as const,
          kind: 'no_preview' as const,
          mime: mimeForLargePlaceholder(ext),
          size,
          reason: 'large' as const,
        }
      }

      // Always serve local PDFs via custom protocol — data: URIs fail silently in
      // Chromium's PDF viewer above ~1 MB (even though our threshold was 4 MB).
      if (ext === '.pdf') {
        const safeId = encodeURIComponent(tenderId)
        const safeName = encodeURIComponent(fileName)
        return {
          success: true as const,
          kind: 'file_url' as const,
          url: `tender-file://local/${safeId}/${safeName}`,
          mime: 'application/pdf',
          size,
        }
      }

      let buffer: Buffer
      try {
        buffer = fs.readFileSync(fullPath)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        log.warn('TENDERS_LOCAL_DOC_READ read failed:', msg)
        return { success: false as const, error: 'Kan bestand niet lezen' }
      }

      return buildDocumentPreviewFromBuffer(buffer, fileName)
    }
  )

  ipcMain.handle(
    IPC.TENDERS_BRON_DOC_PREVIEW,
    async (_event, payload: { url: string; fileName: string; tenderId: string }) => {
      const url = String(payload?.url || '').trim()
      const fileName = String(payload?.fileName || 'document')
      const tenderId = String(payload?.tenderId || '')
      if (!url || !/^https?:\/\//i.test(url)) {
        return { success: false as const, error: 'Ongeldige URL' }
      }
      let bronUrl = ''
      if (tenderId) {
        const row = getDb()
          .prepare('SELECT bron_url FROM aanbestedingen WHERE id = ?')
          .get(tenderId) as { bron_url?: string } | undefined
        bronUrl = row?.bron_url ? String(row.bron_url) : ''
      }
      const partition = getSessionPartitionForBronUrl(bronUrl)
      try {
        const { buffer, contentType } = await fetchBufferFromUrl(url, partition)
        const bronExt = path.extname(fileName).toLowerCase()
        const isPdfBron =
          bronExt === '.pdf' ||
          contentType?.toLowerCase().includes('pdf') ||
          buffer.slice(0, 5).toString('ascii') === '%PDF-'
        if (buffer.length > MAX_INLINE_PREVIEW_BYTES && !isPdfBron) {
          return {
            success: true as const,
            kind: 'no_preview' as const,
            mime: mimeForLargePlaceholder(bronExt),
            size: buffer.length,
            reason: 'large' as const,
          }
        }
        // For bron PDFs: write to temp file and serve via custom protocol.
        // Threshold lowered to 512 KB — Chromium's PDF viewer silently fails on
        // larger data: URIs, so we use the protocol for virtually all bron PDFs.
        const PDF_DIRECT_THRESHOLD = 512 * 1024
        if (isPdfBron && buffer.length > PDF_DIRECT_THRESHOLD) {
          try {
            const tmpDir = path.join(app.getPath('userData'), 'bron-preview-cache')
            fs.mkdirSync(tmpDir, { recursive: true })
            const tmpName = `${randomUUID()}.pdf`
            fs.writeFileSync(path.join(tmpDir, tmpName), buffer)
            return {
              success: true as const,
              kind: 'file_url' as const,
              url: `tender-file://bron-cache/${encodeURIComponent(tmpName)}`,
              mime: 'application/pdf',
              size: buffer.length,
            }
          } catch {
            /* fall through to base64 if temp write fails */
          }
        }
        return buildDocumentPreviewFromBuffer(buffer, fileName, { contentTypeHint: contentType })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        log.warn('TENDERS_BRON_DOC_PREVIEW:', msg)
        return { success: false as const, error: msg || 'Download mislukt' }
      }
    }
  )

  ipcMain.handle(IPC.TENDERS_BRON_EMBED_PARTITION, (_event, tenderId: string) => {
    const id = String(tenderId || '').trim()
    if (!id) return { partition: null as string | null }
    const row = getDb()
      .prepare('SELECT bron_url FROM aanbestedingen WHERE id = ?')
      .get(id) as { bron_url?: string } | undefined
    const bron = row?.bron_url ? String(row.bron_url) : ''
    const partition = getSessionPartitionForBronUrl(bron) ?? null
    return { partition }
  })

  ipcMain.handle(
    IPC.TENDERS_BRON_DOC_SAVE_AS,
    async (_event, payload: { url: string; fileName: string; tenderId: string }) => {
      const url = String(payload?.url || '').trim()
      const fileName = String(payload?.fileName || 'document')
      const tenderId = String(payload?.tenderId || '')
      if (!url || !/^https?:\/\//i.test(url)) {
        return { success: false as const, error: 'Ongeldige URL' }
      }
      let bronUrl = ''
      if (tenderId) {
        const row = getDb()
          .prepare('SELECT bron_url FROM aanbestedingen WHERE id = ?')
          .get(tenderId) as { bron_url?: string } | undefined
        bronUrl = row?.bron_url ? String(row.bron_url) : ''
      }
      const partition = getSessionPartitionForBronUrl(bronUrl)
      const win = getMainWindow()
      const defaultPath = path.join(app.getPath('downloads'), path.basename(fileName))
      const saveOpts = { defaultPath, title: 'Bijlage opslaan' as const }
      const result = win
        ? await dialog.showSaveDialog(win, saveOpts)
        : await dialog.showSaveDialog(saveOpts)
      if (result.canceled || !result.filePath) {
        return { success: false as const, error: 'Geannuleerd' }
      }
      try {
        const { buffer } = await fetchBufferFromUrl(url, partition)
        fs.writeFileSync(result.filePath, buffer)
        return { success: true as const, filePath: result.filePath }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        log.warn('TENDERS_BRON_DOC_SAVE_AS:', msg)
        return { success: false as const, error: msg }
      }
    }
  )

  ipcMain.handle(
    IPC.TENDERS_BRON_DOC_OPEN_EXTERNAL,
    async (_event, payload: { url: string; fileName: string; tenderId: string }) => {
      const url = String(payload?.url || '').trim()
      const fileName = String(payload?.fileName || 'document')
      const tenderId = String(payload?.tenderId || '')
      if (!url || !/^https?:\/\//i.test(url)) {
        return { success: false as const, error: 'Ongeldige URL' }
      }
      let bronUrl = ''
      if (tenderId) {
        const row = getDb()
          .prepare('SELECT bron_url FROM aanbestedingen WHERE id = ?')
          .get(tenderId) as { bron_url?: string } | undefined
        bronUrl = row?.bron_url ? String(row.bron_url) : ''
      }
      const partition = getSessionPartitionForBronUrl(bronUrl)
      try {
        const { buffer } = await fetchBufferFromUrl(url, partition)
        const ext = path.extname(fileName) || '.bin'
        const tmpPath = path.join(os.tmpdir(), `tender-doc-${randomUUID()}${ext}`)
        fs.writeFileSync(tmpPath, buffer)
        const errMsg = await shell.openPath(tmpPath)
        if (errMsg) {
          log.warn('TENDERS_BRON_DOC_OPEN_EXTERNAL openPath:', errMsg)
          return { success: false as const, error: errMsg }
        }
        return { success: true as const }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        log.warn('TENDERS_BRON_DOC_OPEN_EXTERNAL:', msg)
        return { success: false as const, error: msg }
      }
    }
  )

  ipcMain.handle(
    IPC.TENDERS_LOCAL_DOC_SAVE_AS,
    async (_event, payload: { tenderId: string; fileName: string }) => {
      const tenderId = String(payload?.tenderId || '')
      const fileName = String(payload?.fileName || '')
      const resolved = resolveTenderDocumentFile(tenderId, fileName)
      if (!resolved) {
        return { success: false as const, error: 'Bestand niet gevonden' }
      }
      const win = getMainWindow()
      const defaultPath = path.join(app.getPath('downloads'), path.basename(fileName))
      const saveOpts = { defaultPath, title: 'Bijlage opslaan' as const }
      const result = win
        ? await dialog.showSaveDialog(win, saveOpts)
        : await dialog.showSaveDialog(saveOpts)
      if (result.canceled || !result.filePath) {
        return { success: false as const, error: 'Geannuleerd' }
      }
      try {
        fs.copyFileSync(resolved.fullPath, result.filePath)
        return { success: true as const, filePath: result.filePath }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        log.warn('TENDERS_LOCAL_DOC_SAVE_AS failed:', msg)
        return { success: false as const, error: msg }
      }
    }
  )

  ipcMain.handle(
    IPC.TENDERS_LOCAL_DOC_OPEN_EXTERNAL,
    async (_event, payload: { tenderId: string; fileName: string }) => {
      const tenderId = String(payload?.tenderId || '')
      const fileName = String(payload?.fileName || '')
      const resolved = resolveTenderDocumentFile(tenderId, fileName)
      if (!resolved) {
        return { success: false as const, error: 'Bestand niet gevonden' }
      }
      const errMsg = await shell.openPath(resolved.fullPath)
      if (errMsg) {
        log.warn('openPath:', errMsg)
        return { success: false as const, error: errMsg }
      }
      return { success: true as const }
    }
  )
}
