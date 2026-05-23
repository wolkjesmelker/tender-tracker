import AdmZip from 'adm-zip'
import fs from 'fs'
import log from 'electron-log'
import { getDb } from '../db/connection'
import { resolveTenderDocumentFile } from '../utils/paths'
import type { AgentFillState, StoredDocumentEntry } from '../../shared/types'
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib'

function parseDocumentUrls(raw: string | undefined): StoredDocumentEntry[] {
  try {
    const arr = JSON.parse(raw || '[]')
    return Array.isArray(arr) ? (arr as StoredDocumentEntry[]) : []
  } catch {
    return []
  }
}

function normName(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function extFromFileName(name: string): 'pdf' | 'docx' | 'other' {
  const m = name.split('?')[0].split('#')[0].match(/\.([a-z0-9]+)$/i)
  const e = (m?.[1] || '').toLowerCase()
  if (e === 'pdf') return 'pdf'
  if (e === 'docx') return 'docx'
  return 'other'
}

function findCatalogEntry(docs: StoredDocumentEntry[], documentNaam: string): StoredDocumentEntry | undefined {
  const target = normName(documentNaam)
  return (
    docs.find((d) => normName(d.naam || '') === target) ||
    docs.find((d) => normName(d.localNaam || '') === target) ||
    docs.find(
      (d) =>
        target &&
        (normName(d.naam || '').includes(target) || target.includes(normName(d.naam || ''))),
    )
  )
}

function pdfSiblingOf(docs: StoredDocumentEntry[], stem: string): StoredDocumentEntry | undefined {
  return docs.find((d) => {
    if (!d.localNaam?.trim()) return false
    const dStem = (d.naam || d.localNaam).replace(/\.[^.\\/]+$/i, '')
    const isPdf = extFromFileName(d.naam || d.localNaam) === 'pdf'
    return isPdf && normName(dStem) === normName(stem)
  })
}

/**
 * Zoekt het lokale brondocument voor export. Bij PDF-export wordt eerst het PDF-bestand
 * gekozen (catalogus-PDF of PDF met dezelfde basisnaam als een Word-sjabloon).
 */
export function resolveOriginalDocumentForExport(
  tenderId: string,
  documentNaam: string,
  exportFormat: 'pdf' | 'docx',
): { fullPath: string; bronExt: 'pdf' | 'docx'; usedLocalNaam: string } | null {
  const row = getDb()
    .prepare('SELECT document_urls FROM aanbestedingen WHERE id = ?')
    .get(tenderId) as { document_urls?: string } | undefined
  const docs = parseDocumentUrls(row?.document_urls)
  const entry = findCatalogEntry(docs, documentNaam)
  if (!entry?.localNaam?.trim()) return null

  const stem = (entry.naam || entry.localNaam).replace(/\.[^.\\/]+$/i, '')

  const pick = (localNaam: string, logicalName: string): { fullPath: string; bronExt: 'pdf' | 'docx' } | null => {
    const hit = resolveTenderDocumentFile(tenderId, localNaam.trim())
    if (!hit) return null
    const ext = extFromFileName(logicalName || localNaam)
    if (ext === 'other') return null
    return { fullPath: hit.fullPath, bronExt: ext }
  }

  if (exportFormat === 'pdf') {
    if (extFromFileName(entry.naam || entry.localNaam) === 'pdf') {
      const p = pick(entry.localNaam, entry.naam || entry.localNaam)
      if (p) return { ...p, usedLocalNaam: entry.localNaam.trim() }
    }
    if (stem) {
      const sib = pdfSiblingOf(docs, stem)
      if (sib?.localNaam) {
        const p = pick(sib.localNaam, sib.naam || sib.localNaam)
        if (p?.bronExt === 'pdf') return { ...p, usedLocalNaam: sib.localNaam.trim() }
      }
    }
    return null
  }

  // Word-export: alleen het echte .docx-bestand
  if (extFromFileName(entry.naam || entry.localNaam) === 'docx') {
    const p = pick(entry.localNaam, entry.naam || entry.localNaam)
    if (p?.bronExt === 'docx') return { ...p, usedLocalNaam: entry.localNaam.trim() }
  }
  return null
}

function normKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(normKey(a).split(' ').filter((w) => w.length > 1))
  const tb = new Set(normKey(b).split(' ').filter((w) => w.length > 1))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const x of ta) if (tb.has(x)) inter += 1
  return inter / (ta.size + tb.size - inter)
}

function scorePdfFieldToState(pdfFieldName: string, st: AgentFillState): number {
  const pn = normKey(pdfFieldName)
  const parts = [st.field_id, st.field_label, st.source_quote || '']
  let best = 0
  for (const p of parts) {
    const c = normKey(p)
    if (!c) continue
    if (pn === c) best = Math.max(best, 1)
    else if (pn.includes(c) || c.includes(pn)) best = Math.max(best, 0.88)
    else best = Math.max(best, tokenJaccard(pn, c) * 0.95)
  }
  return best
}

function truthyCheckboxValue(v: string): boolean {
  const t = normKey(v)
  return /^(1|true|yes|ja|j|y|x|aan|akkoord|checked|selected)$/.test(t.replace(/\s+/g, ''))
}

function sanitizeOneLine(s: string, maxLen: number): string {
  return String(s || '')
    .replace(/\0/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

/**
 * Vult AcroForm-velden op het **bestaande** PDF-bestand op basis van wizard-velden.
 */
export async function fillPdfBufferWithMatchedAcroForm(input: {
  pdfBytes: Uint8Array
  states: AgentFillState[]
}): Promise<{ buffer: Buffer; warnings: string[]; matched: number; pdfFieldCount: number }> {
  const warnings: string[] = []
  const pdfDoc = await PDFDocument.load(input.pdfBytes, { ignoreEncryption: true }).catch((e) => {
    throw new Error(`PDF openen mislukt: ${e instanceof Error ? e.message : String(e)}`)
  })

  const form = pdfDoc.getForm()
  const fields = form.getFields()
  const names = fields.map((f) => f.getName())

  if (names.length === 0) {
    throw new Error(
      'Dit PDF bevat geen interactieve formuliervelden (AcroForm). Je kunt het bestand niet automatisch laten invullen; gebruik een PDF met formulier­velden van de aanbestedende dienst.',
    )
  }

  const filled = input.states.filter((s) => s.value_text && s.value_text.trim())
  const scored: { pdfName: string; state: AgentFillState; score: number }[] = []
  for (const pdfName of names) {
    for (const st of filled) {
      scored.push({ pdfName, state: st, score: scorePdfFieldToState(pdfName, st) })
    }
  }
  scored.sort((a, b) => b.score - a.score)

  const usedPdf = new Set<string>()
  const usedStateIds = new Set<string>()
  const minScore = 0.34
  const assignments = new Map<string, AgentFillState>()
  for (const row of scored) {
    if (row.score < minScore) continue
    if (usedPdf.has(row.pdfName) || usedStateIds.has(row.state.field_id)) continue
    usedPdf.add(row.pdfName)
    usedStateIds.add(row.state.field_id)
    assignments.set(row.pdfName, row.state)
  }

  const setFieldValue = (field: PDFField, st: AgentFillState) => {
    const raw = st.value_text?.trim() || ''
    if (field instanceof PDFTextField) {
      field.setText(sanitizeOneLine(raw, 8000))
      return true
    }
    if (field instanceof PDFCheckBox) {
      if (truthyCheckboxValue(raw)) field.check()
      else field.uncheck()
      return true
    }
    if (field instanceof PDFDropdown) {
      const opts = field.getOptions()
      const exact = opts.find((o) => normName(o) === normName(raw))
      if (exact) {
        field.select(exact)
        return true
      }
      const partial = opts.find((o) => normName(o).includes(normName(raw)) || normName(raw).includes(normName(o)))
      if (partial) {
        field.select(partial)
        return true
      }
      warnings.push(`Dropdown "${field.getName()}": waarde "${raw}" komt niet voor in de lijst.`)
      return false
    }
    if (field instanceof PDFRadioGroup) {
      try {
        field.select(raw)
        return true
      } catch {
        warnings.push(`Keuzerondje "${field.getName()}": waarde "${raw}" paste niet.`)
        return false
      }
    }
    warnings.push(`Veld "${field.getName()}" (${field.constructor.name}) wordt niet automatisch geschreven.`)
    return false
  }

  let matched = 0
  for (const [pdfName, st] of assignments) {
    let field: PDFField
    try {
      field = form.getField(pdfName)
    } catch {
      continue
    }
    try {
      if (setFieldValue(field, st)) matched += 1
    } catch (e) {
      warnings.push(
        `Schrijven mislukt voor PDF-veld "${pdfName}" (${st.field_label}): ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  const unfilledStates = filled.filter((s) => !usedStateIds.has(s.field_id))
  if (unfilledStates.length > 0) {
    warnings.push(
      `${unfilledStates.length} ingevulde wizard-veld(en) hadden geen duidelijke match met een PDF-formulierveld (namen: ${unfilledStates
        .slice(0, 6)
        .map((s) => `"${s.field_label}"`)
        .join(', ')}${unfilledStates.length > 6 ? ', …' : ''}).`,
    )
  }

  try {
    form.flatten()
  } catch (e) {
    warnings.push(`PDF afronden (flatten): ${e instanceof Error ? e.message : String(e)}`)
  }

  const out = await pdfDoc.save({ useObjectStreams: false })
  return { buffer: Buffer.from(out), warnings, matched, pdfFieldCount: names.length }
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Vervangt letterlijke `source_quote`-fragmenten in Word-OOXML door de ingevulde waarde.
 * Werkt alleen als de quote exact zo in één XML-bestand voorkomt (geen gesplitste runs).
 */
export function fillDocxBufferBySourceQuoteReplace(input: {
  docxBytes: Buffer
  states: AgentFillState[]
}): { buffer: Buffer; warnings: string[]; replacements: number } {
  const warnings: string[] = []
  const zip = new AdmZip(input.docxBytes)
  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  const targets = entries.filter((e) =>
    /^word\/(document|header\d+|footer\d+)\.xml$/i.test(e.entryName),
  )

  let replacements = 0
  const sorted = [...input.states]
    .filter((s) => s.value_text?.trim() && s.source_quote && s.source_quote.trim().length >= 2)
    .sort((a, b) => (b.source_quote?.length || 0) - (a.source_quote?.length || 0))

  for (const ent of targets) {
    let xml = ent.getData().toString('utf8')
    let changed = false
    for (const st of sorted) {
      const q = st.source_quote!
      if (!q || !xml.includes(q)) continue
      const val = escapeXml(sanitizeOneLine(st.value_text!.trim(), 12000))
      const count = xml.split(q).length - 1
      if (count !== 1) {
        warnings.push(`"${st.field_label}": broncitaat komt ${count}× voor in ${ent.entryName} — overgeslagen.`)
        continue
      }
      xml = xml.replace(q, val)
      replacements += 1
      changed = true
    }
    if (changed) zip.updateFile(ent.entryName, Buffer.from(xml, 'utf8'))
  }

  if (replacements === 0) {
    warnings.push(
      'Geen enkele broncitaat gevonden in de Word-XML (tekst staat vaak gesplitst over meerdere stukjes). Probeer het PDF-formulier van de aanbesteding te exporteren.',
    )
  }

  return { buffer: zip.toBuffer(), warnings, replacements }
}

export async function buildFilledOriginalExportBuffer(input: {
  tenderId: string
  documentNaam: string
  states: AgentFillState[]
  format: 'pdf' | 'docx'
}): Promise<{ buffer: Buffer; warnings: string[]; meta: { bronExt: string; matched?: number; pdfFieldCount?: number; replacements?: number } }> {
  const resolved = resolveOriginalDocumentForExport(input.tenderId, input.documentNaam, input.format)
  if (!resolved) {
    const hint =
      input.format === 'pdf'
        ? ' Download het PDF-formulier (eventueel naast het Word-sjabloon) zodat het lokaal beschikbaar is.'
        : ' Download het Word-sjabloon (.docx) zodat het lokaal beschikbaar is.'
    throw new Error(`Brondocument niet gevonden in de app-opslag.${hint}`)
  }

  if (input.format === 'pdf') {
    if (resolved.bronExt !== 'pdf') {
      throw new Error('Kon geen lokaal PDF-formulier vinden voor deze export.')
    }
    const pdfBytes = new Uint8Array(fs.readFileSync(resolved.fullPath))
    const r = await fillPdfBufferWithMatchedAcroForm({ pdfBytes, states: input.states })
    log.info(
      `[fill-export] PDF AcroForm: matched ${r.matched}/${r.pdfFieldCount} velden voor "${input.documentNaam}"`,
    )
    return {
      buffer: r.buffer,
      warnings: r.warnings,
      meta: { bronExt: 'pdf', matched: r.matched, pdfFieldCount: r.pdfFieldCount },
    }
  }

  if (resolved.bronExt !== 'docx') {
    throw new Error('Voor Word-export is een lokaal .docx-sjabloon nodig.')
  }
  const docxBytes = fs.readFileSync(resolved.fullPath)
  const r = fillDocxBufferBySourceQuoteReplace({ docxBytes, states: input.states })
  log.info(`[fill-export] DOCX replace: ${r.replacements} vervanging(en) voor "${input.documentNaam}"`)
  if (r.replacements === 0) {
    throw new Error(
      r.warnings.join(' ') ||
        'Kon geen enkele waarde in het Word-sjabloon plaatsen (tekst staat vaak gesplitst in Word-XML). Gebruik waar mogelijk het PDF-formulier.',
    )
  }
  return {
    buffer: r.buffer,
    warnings: r.warnings,
    meta: { bronExt: 'docx', replacements: r.replacements },
  }
}
