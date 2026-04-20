import { ipcMain, BrowserWindow, dialog } from 'electron'
import log from 'electron-log'
import { IPC } from '../../shared/constants'
import { getDb } from '../db/connection'
import { aiService } from '../ai/ai-service'
import {
  sendAgentMessage,
  loadHistory,
  clearHistory,
  registerUserCorrection,
} from '../ai/agent-service'
import {
  analyzeDocumentForFields,
  generateFillProposals,
  persistFieldDefinitions,
  applyProposalsIfEmpty,
  listFillStatesForDocument,
  listAllFillStatesForTender,
  getFillSummaryForTender,
  saveFillValue,
  markPartialIfIncomplete,
  checkContradictionForField,
  persistContradiction,
  buildWizardSteps,
} from '../ai/document-fill-engine'
import { searchWeb, pinSearchResultToTender, listPinnedNotes } from '../ai/web-search'
import { getAppDataPath } from '../utils/paths'
import path from 'path'
import fs from 'fs'
import type {
  Aanbesteding,
  AgentFieldDefinition,
  AgentStreamChunk,
  StoredDocumentEntry,
} from '../../shared/types'

function broadcastChunk(chunk: AgentStreamChunk): void {
  const wins = BrowserWindow.getAllWindows()
  for (const w of wins) {
    if (!w.webContents.isDestroyed()) {
      w.webContents.send(IPC.AGENT_STREAM_CHUNK, chunk)
    }
  }
}

async function ensureAiConfigured(): Promise<void> {
  const rows = getDb().prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  try {
    aiService.configure(map)
  } catch (e) {
    throw e
  }
}

export function registerAgentHandlers(): void {
  ipcMain.handle(
    IPC.AGENT_SEND_MESSAGE,
    async (_e, payload: { tenderId?: string; message: string }) => {
      if (!payload || typeof payload.message !== 'string' || !payload.message.trim()) {
        return { ok: false, error: 'Lege boodschap.' }
      }
      try {
        await ensureAiConfigured()
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      try {
        const result = await sendAgentMessage({
          tenderId: payload.tenderId,
          message: payload.message,
          onChunk: (c) => {
            broadcastChunk({
              id: c.id,
              tender_id: payload.tenderId,
              delta: c.delta,
              done: c.done,
              error: c.error,
              tool_call: c.tool
                ? { name: c.tool.name, args: c.tool.args, result: c.tool.result }
                : undefined,
            })
          },
        })
        return { ok: true, assistantMessageId: result.assistantMessageId, text: result.text }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        log.error('[agent.ipc] send-message error:', err)
        return { ok: false, error: err }
      }
    },
  )

  ipcMain.handle(IPC.AGENT_GET_HISTORY, (_e, payload: { tenderId?: string }) => {
    return loadHistory(payload?.tenderId)
  })

  ipcMain.handle(IPC.AGENT_CLEAR_HISTORY, (_e, payload: { tenderId?: string }) => {
    clearHistory(payload?.tenderId)
    return { ok: true }
  })

  ipcMain.handle(
    IPC.AGENT_START_FILL,
    async (_e, payload: { tenderId: string; documentNaam: string; reanalyze?: boolean }) => {
      if (!payload?.tenderId || !payload?.documentNaam) return { ok: false, error: 'tenderId en documentNaam verplicht' }
      try {
        await ensureAiConfigured()
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      const tender = getDb()
        .prepare('SELECT * FROM aanbestedingen WHERE id = ?')
        .get(payload.tenderId) as Aanbesteding | undefined
      if (!tender) return { ok: false, error: 'Tender niet gevonden' }

      let documents: StoredDocumentEntry[] = []
      try {
        documents = JSON.parse(tender.document_urls || '[]') as StoredDocumentEntry[]
      } catch {
        documents = []
      }
      const match =
        documents.find((d) => d.naam === payload.documentNaam) ||
        documents.find((d) => d.localNaam === payload.documentNaam) ||
        documents.find((d) => d.naam.toLowerCase().includes(payload.documentNaam.toLowerCase()))
      if (!match) return { ok: false, error: 'Document niet gevonden in tender.' }

      const existing = listFillStatesForDocument(payload.tenderId, payload.documentNaam)
      const needReanalyze = payload.reanalyze || existing.length === 0

      let fields: AgentFieldDefinition[] = existing.map((s) => ({
        id: s.field_id,
        label: s.field_label,
        type: s.field_type,
        required: s.field_required,
        description: s.field_description,
        options: s.field_options,
        group: s.field_group,
        order: s.field_order,
      }))

      if (needReanalyze) {
        try {
          const analysis = await analyzeDocumentForFields({
            tenderId: payload.tenderId,
            document: match,
            useClaudeSonnet45: true,
          })
          fields = analysis.fields
          persistFieldDefinitions({
            tenderId: payload.tenderId,
            documentNaam: payload.documentNaam,
            fields,
          })
          const proposals = generateFillProposals({ tender, documentNaam: payload.documentNaam, fields })
          applyProposalsIfEmpty({
            tenderId: payload.tenderId,
            documentNaam: payload.documentNaam,
            proposals,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          log.error('[agent.ipc] start-fill analyse fout:', msg)
          return { ok: false, error: `Kon document niet analyseren: ${msg}` }
        }
      }

      const states = listFillStatesForDocument(payload.tenderId, payload.documentNaam)
      const steps = buildWizardSteps(fields)
      return { ok: true, fields, steps, states }
    },
  )

  ipcMain.handle(
    IPC.AGENT_GET_FILL_STATE,
    (_e, payload: { tenderId: string; documentNaam?: string }) => {
      if (!payload?.tenderId) return []
      if (payload.documentNaam) return listFillStatesForDocument(payload.tenderId, payload.documentNaam)
      return listAllFillStatesForTender(payload.tenderId)
    },
  )

  ipcMain.handle(IPC.AGENT_GET_FILL_SUMMARY, (_e, payload: { tenderId: string }) => {
    if (!payload?.tenderId) return []
    return getFillSummaryForTender(payload.tenderId)
  })

  ipcMain.handle(
    IPC.AGENT_SAVE_FILL_FIELD,
    (
      _e,
      payload: {
        tenderId: string
        documentNaam: string
        fieldId: string
        value: string
        source?: 'ai' | 'user' | 'learning'
        approve?: boolean
        learn?: boolean
        fieldLabel?: string
      },
    ) => {
      if (!payload?.tenderId || !payload?.documentNaam || !payload?.fieldId) {
        return { ok: false, error: 'tenderId, documentNaam, fieldId verplicht' }
      }
      const source = payload.source || 'user'
      const state = saveFillValue({
        tenderId: payload.tenderId,
        documentNaam: payload.documentNaam,
        fieldId: payload.fieldId,
        value: payload.value ?? '',
        source,
        markApproved: payload.approve,
      })
      if (!state) return { ok: false, error: 'Kon veld niet opslaan' }

      const tender = getDb()
        .prepare('SELECT * FROM aanbestedingen WHERE id = ?')
        .get(payload.tenderId) as Aanbesteding | undefined
      let contradiction = null
      if (tender && payload.value && payload.value.trim()) {
        contradiction = checkContradictionForField({
          tender,
          field: { id: state.field_id, label: state.field_label, type: state.field_type },
          value: payload.value,
        })
      }
      persistContradiction({
        tenderId: payload.tenderId,
        documentNaam: payload.documentNaam,
        fieldId: payload.fieldId,
        warning: contradiction,
      })
      markPartialIfIncomplete(payload.tenderId, payload.documentNaam)

      if (payload.learn !== false && source === 'user' && payload.value && payload.value.trim()) {
        registerUserCorrection({
          tenderId: payload.tenderId,
          documentNaam: payload.documentNaam,
          fieldId: payload.fieldId,
          fieldLabel: payload.fieldLabel || state.field_label,
          newValue: payload.value,
        })
      }

      return { ok: true, state, contradiction }
    },
  )

  ipcMain.handle(
    IPC.AGENT_LEARN_CORRECTION,
    (
      _e,
      payload: {
        tenderId?: string
        documentNaam: string
        fieldId: string
        fieldLabel?: string
        value: string
      },
    ) => {
      if (!payload?.documentNaam || !payload?.fieldId || !payload?.value) {
        return { ok: false, error: 'documentNaam, fieldId en value verplicht' }
      }
      registerUserCorrection({
        tenderId: payload.tenderId,
        documentNaam: payload.documentNaam,
        fieldId: payload.fieldId,
        fieldLabel: payload.fieldLabel,
        newValue: payload.value,
      })
      return { ok: true }
    },
  )

  ipcMain.handle(
    IPC.AGENT_WEB_SEARCH,
    async (_e, payload: { query: string; count?: number }) => {
      if (!payload?.query) return { ok: false, error: 'Query verplicht' }
      try {
        const results = await searchWeb(payload.query, payload.count ?? 5)
        return { ok: true, results }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  ipcMain.handle(
    IPC.AGENT_PIN_SEARCH_RESULT,
    (_e, payload: { tenderId: string; url?: string; summary: string; query?: string }) => {
      if (!payload?.tenderId || !payload?.summary) {
        return { ok: false, error: 'tenderId en summary verplicht' }
      }
      const res = pinSearchResultToTender({
        tenderId: payload.tenderId,
        url: payload.url,
        summary: payload.summary,
        query: payload.query,
      })
      return { ok: true, id: res.id }
    },
  )

  ipcMain.handle(
    IPC.AGENT_EXPORT_FILL,
    (_e, payload: { tenderId: string; documentNaam: string }) => {
      if (!payload?.tenderId || !payload?.documentNaam) return { ok: false, error: 'params verplicht' }
      const states = listFillStatesForDocument(payload.tenderId, payload.documentNaam)
      const lines: string[] = []
      lines.push(`# Ingevulde velden: ${payload.documentNaam}`)
      lines.push(`Geëxporteerd: ${new Date().toISOString()}`)
      lines.push('')
      const byGroup = new Map<string, typeof states>()
      for (const s of states) {
        const g = s.field_group || 'Algemeen'
        if (!byGroup.has(g)) byGroup.set(g, [])
        byGroup.get(g)!.push(s)
      }
      for (const [group, arr] of byGroup) {
        lines.push(`## ${group}`)
        for (const s of arr) {
          lines.push(`- **${s.field_label}**${s.field_required ? ' *' : ''}: ${s.value_text || '_(leeg)_'}`)
          if (s.contradiction_flag && s.contradiction_detail) {
            lines.push(`  ⚠ ${s.contradiction_detail}`)
          }
        }
        lines.push('')
      }
      return { ok: true, markdown: lines.join('\n'), pinned: listPinnedNotes(payload.tenderId) }
    },
  )

  ipcMain.handle(
    IPC.AGENT_EXPORT_FILLED_DOCUMENT,
    async (_e, payload: { tenderId: string; documentNaam: string }) => {
      if (!payload?.tenderId || !payload?.documentNaam) {
        return { ok: false, error: 'tenderId en documentNaam verplicht' }
      }
      const states = listFillStatesForDocument(payload.tenderId, payload.documentNaam)
      const filledStates = states.filter((s) => s.value_text && s.value_text.trim())
      if (filledStates.length === 0) {
        return { ok: false, error: 'Geen ingevulde velden om te exporteren.' }
      }

      // Haal de tender op voor de naam in de header
      const tender = getDb()
        .prepare('SELECT titel FROM aanbestedingen WHERE id = ?')
        .get(payload.tenderId) as { titel?: string } | undefined

      // Groepeer velden
      const byGroup = new Map<string, typeof states>()
      for (const s of states) {
        const g = s.field_group || 'Algemeen'
        if (!byGroup.has(g)) byGroup.set(g, [])
        byGroup.get(g)!.push(s)
      }

      // Genereer PDF met pdfmake
      let PdfPrinter: any = null
      try {
        PdfPrinter = require('pdfmake')
      } catch {
        return { ok: false, error: 'pdfmake niet beschikbaar.' }
      }

      const fonts = {
        Helvetica: {
          normal: 'Helvetica',
          bold: 'Helvetica-Bold',
          italics: 'Helvetica-Oblique',
          bolditalics: 'Helvetica-BoldOblique',
        },
      }

      const content: any[] = [
        {
          text: 'Ingevuld aanbestedingsformulier',
          style: 'header',
          margin: [0, 0, 0, 4],
        },
        {
          text: tender?.titel || payload.tenderId,
          style: 'tenderTitle',
          margin: [0, 0, 0, 4],
        },
        {
          text: payload.documentNaam,
          style: 'docTitle',
          margin: [0, 0, 0, 2],
        },
        {
          text: `Gegenereerd op: ${new Date().toLocaleString('nl-NL', { dateStyle: 'long', timeStyle: 'short' })}`,
          style: 'meta',
          margin: [0, 0, 0, 16],
        },
        {
          text: `${filledStates.length} van ${states.length} veld${states.length !== 1 ? 'en' : ''} ingevuld`,
          style: 'meta',
          color: filledStates.length === states.length ? '#16a34a' : '#b45309',
          margin: [0, 0, 0, 20],
        },
      ]

      for (const [group, groupStates] of byGroup) {
        content.push({
          text: group,
          style: 'groupHeader',
          margin: [0, 12, 0, 6],
        })
        const tableBody: any[][] = [
          [
            { text: 'Veld', bold: true, fillColor: '#f1f5f9', fontSize: 9 },
            { text: 'Waarde', bold: true, fillColor: '#f1f5f9', fontSize: 9 },
          ],
        ]
        for (const s of groupStates) {
          const isContradiction = s.contradiction_flag && s.contradiction_detail
          const isEmpty = !s.value_text?.trim()
          tableBody.push([
            {
              text: `${s.field_label}${s.field_required ? ' *' : ''}`,
              fontSize: 9,
              color: '#374151',
            },
            {
              text: isEmpty ? '— (niet ingevuld)' : (s.value_text || ''),
              fontSize: 9,
              color: isEmpty ? '#9ca3af' : isContradiction ? '#dc2626' : '#111827',
              italics: isEmpty,
            },
          ])
          if (isContradiction && s.contradiction_detail) {
            tableBody.push([
              { text: '', fontSize: 8 },
              {
                text: `⚠ ${s.contradiction_detail}`,
                fontSize: 8,
                color: '#dc2626',
                italics: true,
              },
            ])
          }
        }
        content.push({
          table: {
            widths: [200, '*'],
            body: tableBody,
          },
          layout: {
            fillColor: (ri: number) => (ri === 0 ? '#f1f5f9' : ri % 2 === 0 ? '#f8fafc' : null),
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#e2e8f0',
            vLineColor: () => '#e2e8f0',
          },
          margin: [0, 0, 0, 8],
        })
      }

      // Voettekst
      content.push({
        text: '\n* = verplicht veld   ⚠ = tegenstrijdigheid met tendergegevens',
        style: 'footnote',
        margin: [0, 12, 0, 0],
      })

      const docDef = {
        content,
        defaultStyle: { font: 'Helvetica', fontSize: 10 },
        styles: {
          header: { fontSize: 16, bold: true, color: '#1e3a5f' },
          tenderTitle: { fontSize: 12, bold: true, color: '#1e3a5f' },
          docTitle: { fontSize: 10, color: '#4b5563' },
          meta: { fontSize: 9, color: '#6b7280' },
          groupHeader: { fontSize: 11, bold: true, color: '#1e40af' },
          footnote: { fontSize: 8, color: '#9ca3af', italics: true },
        },
        pageMargins: [40, 50, 40, 50] as [number, number, number, number],
      }

      let pdfBuffer: Buffer
      try {
        const printer = new PdfPrinter(fonts)
        const pdfDoc = printer.createPdfKitDocument(docDef)
        const chunks: Buffer[] = []
        pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
          pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk))
          pdfDoc.on('end', () => resolve(Buffer.concat(chunks)))
          pdfDoc.on('error', reject)
          pdfDoc.end()
        })
      } catch (e) {
        return { ok: false, error: `PDF genereren mislukt: ${e instanceof Error ? e.message : String(e)}` }
      }

      // Sla op in exports map (automatisch, zonder dialoog) + geef pad terug
      const safeName = payload.documentNaam.replace(/[^a-zA-Z0-9._\-]/g, '_')
      const baseName = `${safeName}_ingevuld_${Date.now()}.pdf`
      const exportsDir = path.join(getAppDataPath(), 'filled-documents', payload.tenderId)
      fs.mkdirSync(exportsDir, { recursive: true })
      const autoPath = path.join(exportsDir, baseName)
      fs.writeFileSync(autoPath, pdfBuffer)

      // Bied ook save-as dialoog aan via BrowserWindow
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const defaultFileName = `${safeName}_ingevuld.pdf`
      const saveResult = win
        ? await dialog.showSaveDialog(win, {
            title: 'Ingevuld document opslaan',
            defaultPath: defaultFileName,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
          })
        : { canceled: true, filePath: undefined }

      if (!saveResult.canceled && saveResult.filePath) {
        fs.copyFileSync(autoPath, saveResult.filePath)
        return { ok: true, filePath: saveResult.filePath, autoPath }
      }

      return { ok: true, filePath: autoPath, autoPath }
    },
  )
}
