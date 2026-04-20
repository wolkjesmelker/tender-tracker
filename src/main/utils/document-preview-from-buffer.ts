import log from 'electron-log'
import path from 'path'
import {
  IMAGE_PREVIEW_EXT,
  TEXT_PREVIEW_EXT,
} from '../../shared/local-doc-preview'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import AdmZip from 'adm-zip'
import formatXml from 'xml-formatter'

const MAX_TEXT_PREVIEW_CHARS = 1_500_000
const MAX_HTML_PREVIEW_CHARS = 1_500_000
const MAX_SHEET_ROWS = 400
const MAX_SHEET_COLS = 40
const MAX_ZIP_LIST = 500

function mimeForLocalDoc(ext: string): string {
  const e = ext.toLowerCase()
  if (e === '.pdf') return 'application/pdf'
  if (IMAGE_PREVIEW_EXT[e]) return IMAGE_PREVIEW_EXT[e]
  if (e === '.svg') return 'image/svg+xml'
  return 'application/octet-stream'
}

function inferExtFromContentType(ct: string): string {
  const c = ct.toLowerCase()
  if (c.includes('pdf')) return '.pdf'
  if (c.includes('wordprocessingml')) return '.docx'
  if (c.includes('msword') && !c.includes('xml')) return '.doc'
  if (c.includes('spreadsheetml') || c.includes('ms-excel')) return '.xlsx'
  if (c.includes('zip')) return '.zip'
  if (c.includes('html')) return '.html'
  if (c.includes('xml')) return '.xml'
  if (c.includes('json')) return '.json'
  return ''
}

export type DocumentPreviewResult =
  | { success: true; kind: 'text'; text: string; truncated?: boolean; mime: string; size: number }
  | { success: true; kind: 'data_url'; base64: string; mime: string; size: number }
  | { success: true; kind: 'file_url'; url: string; mime: string; size: number }
  | { success: true; kind: 'html_preview'; html: string; truncated?: boolean; size: number }
  | {
      success: true
      kind: 'spreadsheet_preview'
      sheetName: string
      rows: string[][]
      truncated: boolean
      size: number
    }
  | {
      success: true
      kind: 'zip_preview'
      entries: { name: string; size: number; isDirectory: boolean }[]
      truncated: boolean
      size: number
    }
  | { success: true; kind: 'no_preview'; mime: string; size: number; reason: 'large' | 'binary' }

/**
 * Zelfde preview-payload als TENDERS_LOCAL_DOC_READ (PDF, HTML, DOCX, XML, …).
 */
export async function buildDocumentPreviewFromBuffer(
  buffer: Buffer,
  fileName: string,
  options?: { contentTypeHint?: string }
): Promise<DocumentPreviewResult> {
  const size = buffer.length
  let ext = path.extname(fileName).toLowerCase()
  if (!ext && options?.contentTypeHint) {
    ext = inferExtFromContentType(options.contentTypeHint)
  }
  if (!ext && buffer.slice(0, 5).toString('ascii') === '%PDF-') {
    ext = '.pdf'
  }
  if (!ext) {
    ext = '.bin'
  }

  if (ext === '.html' || ext === '.htm') {
    let html = buffer.toString('utf8')
    let truncated = false
    if (html.length > MAX_HTML_PREVIEW_CHARS) {
      html = `${html.slice(0, MAX_HTML_PREVIEW_CHARS)}\n<!-- … afgekapt -->`
      truncated = true
    }
    return {
      success: true as const,
      kind: 'html_preview' as const,
      html,
      truncated,
      size,
    }
  }

  if (ext === '.xml') {
    const asUtf8 = buffer.toString('utf8')
    const head = asUtf8.slice(0, 8000)
    const looksExcelXml =
      /spreadsheet|Workbook|worksheet|ss:Workbook|SpreadsheetMl/i.test(head) &&
      (head.includes('urn:schemas-microsoft-com:office:spreadsheet') ||
        head.includes('<ss:') ||
        head.includes('<Workbook') ||
        head.includes('<worksheet'))
    if (looksExcelXml) {
      try {
        const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
        const sheetName = wb.SheetNames[0]
        if (sheetName) {
          const sheet = wb.Sheets[sheetName]
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]
          const clipped = rows.map(r => {
            const row = Array.isArray(r) ? r.slice(0, MAX_SHEET_COLS) : []
            return row.map(c => (c == null ? '' : String(c)))
          })
          const slice = clipped.slice(0, MAX_SHEET_ROWS)
          if (slice.length > 0) {
            return {
              success: true as const,
              kind: 'spreadsheet_preview' as const,
              sheetName,
              rows: slice,
              truncated: clipped.length > MAX_SHEET_ROWS,
              size,
            }
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        log.warn('document-preview Excel-XML:', msg)
      }
    }

    const trimmed = asUtf8.trim()
    if (
      trimmed.startsWith('<svg') ||
      /^<\?xml[\s\S]{0,3000}<svg\b/i.test(asUtf8)
    ) {
      return {
        success: true as const,
        kind: 'data_url' as const,
        base64: buffer.toString('base64'),
        mime: 'image/svg+xml',
        size,
      }
    }

    let text = asUtf8
    let truncated = false
    if (text.length > MAX_TEXT_PREVIEW_CHARS) {
      text = text.slice(0, MAX_TEXT_PREVIEW_CHARS)
      truncated = true
    }
    try {
      text = formatXml(text, { collapseContent: true, indentation: '  ' })
    } catch {
      /* geen geldige XML */
    }
    return {
      success: true as const,
      kind: 'text' as const,
      text,
      truncated,
      mime: 'text/plain',
      size,
    }
  }

  if (TEXT_PREVIEW_EXT.has(ext)) {
    let text = buffer.toString('utf8')
    let truncated = false
    if (text.length > MAX_TEXT_PREVIEW_CHARS) {
      text = text.slice(0, MAX_TEXT_PREVIEW_CHARS)
      truncated = true
    }
    if (ext === '.json') {
      try {
        const parsed = JSON.parse(text) as unknown
        text = JSON.stringify(parsed, null, 2)
      } catch {
        /* geen JSON */
      }
    }
    return {
      success: true as const,
      kind: 'text' as const,
      text,
      truncated,
      mime: 'text/plain',
      size,
    }
  }

  if (ext === '.pdf' || IMAGE_PREVIEW_EXT[ext] || ext === '.svg') {
    return {
      success: true as const,
      kind: 'data_url' as const,
      base64: buffer.toString('base64'),
      mime: mimeForLocalDoc(ext),
      size,
    }
  }

  if (ext === '.docx') {
    try {
      const { value: rawHtml } = await mammoth.convertToHtml({ buffer })
      let html = rawHtml
      let truncated = false
      if (html.length > MAX_HTML_PREVIEW_CHARS) {
        html = `${html.slice(0, MAX_HTML_PREVIEW_CHARS)}<p>…</p>`
        truncated = true
      }
      return {
        success: true as const,
        kind: 'html_preview' as const,
        html,
        truncated,
        size,
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.warn('document-preview docx:', msg)
    }
  }

  if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') {
    try {
      const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
      const sheetName = wb.SheetNames[0]
      if (sheetName) {
        const sheet = wb.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]
        const clipped = rows.map(r => {
          const row = Array.isArray(r) ? r.slice(0, MAX_SHEET_COLS) : []
          return row.map(c => (c == null ? '' : String(c)))
        })
        const slice = clipped.slice(0, MAX_SHEET_ROWS)
        return {
          success: true as const,
          kind: 'spreadsheet_preview' as const,
          sheetName,
          rows: slice,
          truncated: clipped.length > MAX_SHEET_ROWS,
          size,
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.warn('document-preview spreadsheet:', msg)
    }
  }

  if (ext === '.zip') {
    try {
      const zip = new AdmZip(buffer)
      const entries = zip.getEntries()
      const list = entries.slice(0, MAX_ZIP_LIST).map(e => ({
        name: e.entryName,
        size: e.header.size,
        isDirectory: e.isDirectory,
      }))
      return {
        success: true as const,
        kind: 'zip_preview' as const,
        entries: list,
        truncated: entries.length > MAX_ZIP_LIST,
        size,
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.warn('document-preview zip:', msg)
    }
  }

  return {
    success: true as const,
    kind: 'no_preview' as const,
    mime: mimeForLocalDoc(ext),
    size,
    reason: 'binary' as const,
  }
}
