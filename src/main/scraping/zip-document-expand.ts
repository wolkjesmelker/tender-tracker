import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import { getDocumentsPath } from '../utils/paths'
import {
  extractZipBufferToTenderDir,
  fetchBufferFromUrl,
  findBestLocalStoredFileName,
  getSessionPartitionForBronUrl,
  isZipDocumentEntry,
  type DocumentInfo,
} from './document-fetcher'
import { resolveTenderDocumentFile } from '../utils/paths'

export type ZipExpandProgress = { step: string; percentage: number }

function bufferLooksLikeZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b
}

/**
 * Vervangt elke ZIP in de documentlijst door uitgepakte entries (localNaam).
 * Bij fout: originele ZIP-entry behouden zodat download later nog kan.
 */
export async function expandZipEntriesInDocumentList(
  tenderId: string,
  docs: DocumentInfo[],
  sessionPartition?: string,
  bronUrlHint?: string,
  options?: { onProgress?: (p: ZipExpandProgress) => void }
): Promise<DocumentInfo[]> {
  const out: DocumentInfo[] = []
  const tenderDir = path.join(getDocumentsPath(), tenderId)
  fs.mkdirSync(tenderDir, { recursive: true })
  const partition =
    sessionPartition?.trim() || getSessionPartitionForBronUrl(bronUrlHint) || undefined

  const zipTargets = docs.filter((d) => isZipDocumentEntry(d) && d.url?.trim())
  const zipTotal = zipTargets.length
  let zipIndex = 0

  for (const doc of docs) {
    if (!isZipDocumentEntry(doc) || !doc.url?.trim()) {
      out.push(doc)
      continue
    }

    zipIndex += 1
    options?.onProgress?.({
      step: `ZIP ${zipIndex}/${zipTotal}: ${(doc.naam || 'archief').slice(0, 56)} — download & uitpakken…`,
      percentage: 9 + Math.min(2, Math.round((zipIndex / Math.max(zipTotal, 1)) * 2)),
    })

    try {
      log.info(`ZIP expand: ${doc.naam}`)
      const zipHintName = doc.naam || 'archief.zip'
      let buffer: Buffer | null = null
      const tryNames: string[] = []
      if (doc.localNaam?.trim()) tryNames.push(doc.localNaam.trim())
      const picked = findBestLocalStoredFileName(tenderId, zipHintName, doc.localNaam)
      if (picked && !tryNames.includes(picked)) tryNames.push(picked)
      for (const naam of tryNames) {
        const res = resolveTenderDocumentFile(tenderId, naam)
        if (!res || res.size <= 100) continue
        const b = fs.readFileSync(res.fullPath)
        if (bufferLooksLikeZip(b)) {
          buffer = b
          log.info(`ZIP expand van lokale opslag (${naam}), geen download`)
          break
        }
      }

      if (!buffer) {
        const { buffer: netBuf } = await fetchBufferFromUrl(doc.url, partition)
        buffer = netBuf
      }

      const { fileEntries, combinedText } = await extractZipBufferToTenderDir(
        buffer,
        tenderDir,
        doc.naam || 'archief.zip'
      )
      if (fileEntries.length === 0) {
        log.warn(`ZIP expand geen bestanden, ZIP blijft in lijst: ${doc.naam}`)
        out.push(doc)
        continue
      }
      log.info(`ZIP expand: ${fileEntries.length} bestand(en) uit ${doc.naam} (tekst ${combinedText.length} chars)`)
      out.push(...fileEntries)
    } catch (e: unknown) {
      log.warn(`ZIP expand mislukt voor ${doc.url}:`, e)
      out.push(doc)
    }
  }

  return out
}
