/**
 * Document storage helpers — anon-key variant (geen auth vereist).
 * Lokale bestanden blijven de primaire bron; cloud is optionele mirror.
 */

import path from 'path'
import fs from 'fs'
import log from 'electron-log'
import type { StoredDocumentEntry } from '../../shared/types'
import { getTenderDocumentsDir, assertSafeDocumentFileName, resolveTenderDocumentFile } from '../utils/paths'
import { getDb } from './connection'
import { getSupabaseClient } from './supabase-client'

const BUCKET = 'tender-documents'

export async function uploadDocumentToStorage(
  localPath: string,
  tenderId: string,
  filename: string
): Promise<string | null> {
  if (!fs.existsSync(localPath)) return null
  const storagePath = `${tenderId}/${filename}`
  const buffer = fs.readFileSync(localPath)
  const { error } = await getSupabaseClient().storage.from(BUCKET).upload(storagePath, buffer, { upsert: true })
  if (error) { log.warn(`[storage] upload ${filename}: ${error.message}`); return null }
  log.info(`[storage] Geüpload: ${storagePath}`)
  return storagePath
}

export async function downloadDocumentFromStorage(storagePath: string, localPath: string): Promise<boolean> {
  if (fs.existsSync(localPath)) return true
  const { data, error } = await getSupabaseClient().storage.from(BUCKET).download(storagePath)
  if (error || !data) { log.warn(`[storage] download ${storagePath}: ${error?.message ?? 'geen data'}`); return false }
  const dir = path.dirname(localPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(localPath, Buffer.from(await data.arrayBuffer()))
  log.info(`[storage] Gedownload: ${localPath}`)
  return true
}

export async function listRemoteDocuments(tenderId?: string): Promise<string[]> {
  const prefix = tenderId ?? ''
  const { data, error } = await getSupabaseClient().storage.from(BUCKET).list(prefix, { limit: 1000 })
  if (error || !data) return []
  return data.map((f) => `${prefix ? prefix + '/' : ''}${f.name}`)
}

function parseDocumentCatalog(raw: string | null): StoredDocumentEntry[] {
  if (!raw?.trim()) return []
  try {
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? (arr as StoredDocumentEntry[]) : []
  } catch { return [] }
}

function catalogLocalFileName(d: StoredDocumentEntry): string | null {
  const n = d.localNaam?.trim() || ''
  if (n) return assertSafeDocumentFileName(n)
  if (!d.url?.trim() && d.naam?.trim()) return assertSafeDocumentFileName(d.naam.trim())
  return null
}

type LocalDocUpload = { tenderId: string; fileName: string; fullPath: string; label: string }

function listLocalDocumentUploads(): LocalDocUpload[] {
  const rows = getDb().prepare('SELECT id, document_urls FROM aanbestedingen').all() as {
    id: string
    document_urls: string | null
  }[]
  const out: LocalDocUpload[] = []
  for (const row of rows) {
    for (const d of parseDocumentCatalog(row.document_urls)) {
      const safeName = catalogLocalFileName(d)
      if (!safeName) continue
      const resolved = resolveTenderDocumentFile(row.id, safeName)
      if (!resolved) continue
      out.push({
        tenderId: row.id,
        fileName: safeName,
        fullPath: resolved.fullPath,
        label: safeName,
      })
    }
  }
  return out
}

export function countLocalDocumentsToUpload(): number {
  return listLocalDocumentUploads().length
}

export async function pushAllLocalDocumentsToStorage(
  onFile?: (done: number, total: number, label: string) => void,
): Promise<{ ok: number; fail: number }> {
  const items = listLocalDocumentUploads()
  const total = items.length
  let ok = 0
  let fail = 0
  for (let i = 0; i < total; i++) {
    const it = items[i]
    onFile?.(i + 1, total, it.label)
    if (await uploadDocumentToStorage(it.fullPath, it.tenderId, it.fileName)) ok++
    else fail++
  }
  log.info(`[storage] Bulk-upload: ${ok} gelukt, ${fail} mislukt/overgeslagen`)
  return { ok, fail }
}

export async function downloadAllMissingDocumentsFromStorage(): Promise<{ ok: number; fail: number }> {
  const rows = getDb().prepare('SELECT id, document_urls FROM aanbestedingen').all() as { id: string; document_urls: string | null }[]
  let ok = 0; let fail = 0
  for (const row of rows) {
    for (const d of parseDocumentCatalog(row.document_urls)) {
      const safeName = catalogLocalFileName(d)
      if (!safeName) continue
      if (resolveTenderDocumentFile(row.id, safeName)) continue
      const localPath = path.join(getTenderDocumentsDir(row.id), safeName)
      if (await downloadDocumentFromStorage(`${row.id}/${safeName}`, localPath)) ok++; else fail++
    }
  }
  log.info(`[storage] Bulk-download: ${ok} gelukt, ${fail} mislukt/niet in cloud`)
  return { ok, fail }
}
