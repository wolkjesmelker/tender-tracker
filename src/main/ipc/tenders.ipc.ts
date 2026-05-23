import { ipcMain, dialog, shell, app } from 'electron'
import log from 'electron-log'
import fs from 'fs'
import path from 'path'
import { getDb } from '../db/connection'
import { requestDebouncedCloudPush } from '../db/supabase-sync'
import { IPC } from '../../shared/constants'
import type {
  Aanbesteding,
  BronNavigatieLink,
  DashboardStats,
  StoredDocumentEntry,
  TenderProcedureContext,
} from '../../shared/types'
import {
  assertSafeDocumentFileName,
  getTenderDocumentsDir,
  listTenderDocumentFiles,
  removeTenderDocumentsFolders,
  resolveTenderDocumentFile,
  uniqueFileNameInDir,
} from '../utils/paths'
import { discoverDocumentsFromBronWithAi } from '../ai/document-discovery'
import { enqueueIncrementalManualDocumentAnalysis } from './analysis.ipc'
import { resolveTenderGeocodes, geocodeAddressString } from '../geocoding/tender-geocoder'
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
import {
  bronFileLinkStableKey,
  catalogDocumentStableKey,
  parseCatalogSelectedKeys,
} from '../../shared/catalog-document-key'

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
        addedByUser: Boolean(x.addedByUser),
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

  ipcMain.handle(IPC.TENDERS_ADD_MANUAL_DOCUMENTS, async (_event, tenderId: string) => {
    const id = String(tenderId || '').trim()
    if (!id) return { success: false as const, error: 'Geen aanbesteding geselecteerd.' }
    const db = getDb()
    const row = db.prepare('SELECT id, document_urls FROM aanbestedingen WHERE id = ?').get(id) as
      | { id: string; document_urls: string | null }
      | undefined
    if (!row) return { success: false as const, error: 'Aanbesteding niet gevonden.' }

    const win = getMainWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
      title: 'Documenten toevoegen aan deze aanbesteding',
      buttonLabel: 'Toevoegen',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Documenten',
          extensions: [
            'pdf',
            'doc',
            'docx',
            'xls',
            'xlsx',
            'ppt',
            'pptx',
            'zip',
            'txt',
            'csv',
            'xml',
            'rtf',
            'odt',
            'ods',
          ],
        },
        { name: 'Alle bestanden', extensions: ['*'] },
      ],
    })
    if (canceled || !filePaths?.length) {
      return { success: false as const, cancelled: true as const }
    }

    const destDir = getTenderDocumentsDir(id)
    fs.mkdirSync(destDir, { recursive: true })

    let docs: StoredDocumentEntry[] = []
    try {
      if (row.document_urls?.trim()) {
        const arr = JSON.parse(row.document_urls)
        if (Array.isArray(arr)) docs = arr as StoredDocumentEntry[]
      }
    } catch {
      docs = []
    }

    const addedNames: string[] = []
    for (const srcPath of filePaths) {
      const base = path.basename(srcPath)
      const unique = uniqueFileNameInDir(destDir, base)
      if (!unique) {
        log.warn(`[tenders] add-manual-documents: onveilige bestandsnaam overgeslagen: ${base}`)
        continue
      }
      const destPath = path.join(destDir, unique)
      try {
        fs.copyFileSync(srcPath, destPath)
      } catch (e) {
        log.warn('[tenders] add-manual-documents copy failed', e)
        continue
      }
      const ext = path.extname(unique).replace(/^\./, '').toUpperCase() || 'FILE'
      docs.push({
        naam: unique,
        localNaam: unique,
        type: ext,
        addedByUser: true,
      })
      addedNames.push(unique)
    }

    if (!addedNames.length) {
      return {
        success: false as const,
        error: 'Geen bestanden toegevoegd (kopiëren mislukt of ongeldige namen).',
      }
    }

    db.prepare(`UPDATE aanbestedingen SET document_urls = ?, updated_at = datetime('now') WHERE id = ?`).run(
      JSON.stringify(docs),
      id,
    )
    log.info(`[tenders] add-manual-documents: ${addedNames.length} bestand(en) voor ${id}`)
    enqueueIncrementalManualDocumentAnalysis(id, addedNames)
    requestDebouncedCloudPush()
    return { success: true as const, added: addedNames }
  })

  ipcMain.handle(
    IPC.TENDERS_REMOVE_CATALOG_ENTRIES,
    (_event, tenderId: string, rawKeys: unknown) => {
      const id = String(tenderId || '').trim()
      const keys = Array.isArray(rawKeys)
        ? rawKeys.filter((k): k is string => typeof k === 'string' && k.length > 0)
        : []
      if (!id) {
        return { success: false as const, error: 'Geen aanbesteding.' }
      }
      if (keys.length === 0) {
        return { success: true as const, removedDocs: 0, removedBron: 0 }
      }
      const toRemove = new Set(keys)
      const db = getDb()
      const row = db
        .prepare(
          `SELECT id, document_urls, bron_navigatie_links, document_catalog_selected_keys FROM aanbestedingen WHERE id = ?`,
        )
        .get(id) as
        | {
            id: string
            document_urls: string | null
            bron_navigatie_links: string | null
            document_catalog_selected_keys: string | null
          }
        | undefined
      if (!row) {
        return { success: false as const, error: 'Aanbesteding niet gevonden.' }
      }

      let docs: StoredDocumentEntry[] = []
      try {
        if (row.document_urls?.trim()) {
          const arr = JSON.parse(row.document_urls) as unknown
          if (Array.isArray(arr)) {
            docs = arr
              .map((x: Record<string, unknown>) => ({
                url: x.url ? String(x.url) : undefined,
                localNaam: x.localNaam ? String(x.localNaam) : undefined,
                naam: String(x.naam || 'Document'),
                type: String(x.type || ''),
                bronZipLabel: x.bronZipLabel ? String(x.bronZipLabel) : undefined,
                addedByUser: Boolean(x.addedByUser),
              }))
              .filter((d: StoredDocumentEntry) => Boolean(d.url?.trim() || d.localNaam?.trim()))
          }
        }
      } catch {
        docs = []
      }

      const dir = getTenderDocumentsDir(id)
      const removedEntries = docs.filter((d) => toRemove.has(catalogDocumentStableKey(d)))
      for (const d of removedEntries) {
        const ln = d.localNaam?.trim()
        if (!ln) continue
        const safe = assertSafeDocumentFileName(ln)
        if (!safe) continue
        const fp = path.join(dir, safe)
        try {
          const resolved = path.resolve(fp)
          const base = path.resolve(dir)
          if (!resolved.startsWith(base + path.sep) && resolved !== base) continue
          if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            fs.unlinkSync(resolved)
          }
        } catch (e) {
          log.warn(`[tenders] remove-catalog: unlink ${ln} mislukt`, e)
        }
      }

      const newDocs = docs.filter((d) => !toRemove.has(catalogDocumentStableKey(d)))
      let bronLinks: BronNavigatieLink[] = parseBronNavForProc(row.bron_navigatie_links)
      const beforeBron = bronLinks.length
      bronLinks = bronLinks.filter((l) => !toRemove.has(bronFileLinkStableKey(l.url)))
      const removedBron = beforeBron - bronLinks.length

      const sel = parseCatalogSelectedKeys(
        typeof row.document_catalog_selected_keys === 'string'
          ? row.document_catalog_selected_keys
          : undefined,
      )
      for (const k of keys) {
        sel.delete(k)
      }

      db.prepare(
        `UPDATE aanbestedingen SET document_urls = ?, bron_navigatie_links = ?, document_catalog_selected_keys = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(
        JSON.stringify(newDocs),
        JSON.stringify(bronLinks),
        JSON.stringify([...sel]),
        id,
      )

      requestDebouncedCloudPush()
      return {
        success: true as const,
        removedDocs: removedEntries.length,
        removedBron,
      }
    },
  )

  ipcMain.handle(IPC.TENDERS_UPDATE, (_event, id: string, data: Partial<Aanbesteding>) => {
    const db = getDb()
    const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'created_at')
    if (fields.length === 0) return

    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => (data as Record<string, unknown>)[f])

    db.prepare(`UPDATE aanbestedingen SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
      .run(...values, id)

    requestDebouncedCloudPush()
    return db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(id)
  })

  ipcMain.handle(IPC.TENDERS_DELETE, (_event, id: string) => {
    const db = getDb()
    // Sla bron_url op in blocklist zodat de aanbesteding na verwijdering niet meer terugkomt
    const row = db.prepare('SELECT bron_url, bron_website_id FROM aanbestedingen WHERE id = ?').get(id) as
      | { bron_url: string | null; bron_website_id: string | null }
      | undefined
    if (row?.bron_url?.trim()) {
      db.prepare(
        'INSERT OR REPLACE INTO verwijderde_bron_urls (bron_url, bron_website_id) VALUES (?, ?)'
      ).run(row.bron_url, row.bron_website_id ?? null)
    }
    removeTenderDocumentsFolders(id)
    db.prepare('DELETE FROM aanbestedingen WHERE id = ?').run(id)
    requestDebouncedCloudPush()
    return { success: true }
  })

  ipcMain.handle(IPC.TENDERS_DELETE_MANY, (_event, ids: string[]) => {
    const db = getDb()
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: true, deleted: 0 }
    }
    // Sla alle bron_urls op in blocklist vóór verwijdering
    const placeholders = ids.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT bron_url, bron_website_id FROM aanbestedingen WHERE id IN (${placeholders})`
    ).all(...ids) as { bron_url: string | null; bron_website_id: string | null }[]
    const insertBlocklist = db.prepare(
      'INSERT OR REPLACE INTO verwijderde_bron_urls (bron_url, bron_website_id) VALUES (?, ?)'
    )
    const insertMany = db.transaction(() => {
      for (const row of rows) {
        if (row.bron_url?.trim()) {
          insertBlocklist.run(row.bron_url, row.bron_website_id ?? null)
        }
      }
    })
    insertMany()
    for (const id of ids) {
      removeTenderDocumentsFolders(id)
    }
    const info = db.prepare(`DELETE FROM aanbestedingen WHERE id IN (${placeholders})`).run(...ids)
    requestDebouncedCloudPush()
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
    requestDebouncedCloudPush()
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

  ipcMain.handle(IPC.TENDERS_RESOLVE_MAP_GEOCODES, async (_event, ids: string[]) => {
    const list = Array.isArray(ids) ? ids.map((s) => String(s || '').trim()).filter(Boolean) : []
    if (list.length === 0) return { resolved: [] }
    const mainWindow = getMainWindow()
    const resolved = await resolveTenderGeocodes(list, (p) => {
      mainWindow?.webContents.send(IPC.TENDERS_RESOLVE_MAP_GEOCODES_PROGRESS, p)
    })
    return { resolved }
  })

  ipcMain.handle(
    IPC.GEOCODE_ADDRESS,
    async (
      _event,
      adres: string | undefined,
      postcode: string | undefined,
      stad: string | undefined,
      land: string | undefined,
    ) => {
      return geocodeAddressString(adres, postcode, stad, land)
    },
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
