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
  listChecklistItems,
  setChecklistItemDone,
} from '../ai/document-fill-engine'
import {
  searchWeb,
  addManualWebSearchToTender,
  deleteAgentPinnedNote,
  listPinnedNotes,
} from '../ai/web-search'
import { enqueueIncrementalManualDocumentAnalysis } from './analysis.ipc'
import { buildFilledOriginalExportBuffer } from '../ai/fill-original-export-document'
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
      const checklist = listChecklistItems(payload.tenderId, payload.documentNaam)
      return { ok: true, fields, steps, states, checklist }
    },
  )

  ipcMain.handle(
    IPC.AGENT_GET_DOC_CHECKLIST,
    (_e, payload: { tenderId: string; documentNaam: string }) => {
      if (!payload?.tenderId || !payload?.documentNaam) return []
      return listChecklistItems(payload.tenderId, payload.documentNaam)
    },
  )

  ipcMain.handle(
    IPC.AGENT_TOGGLE_DOC_CHECKLIST_ITEM,
    (
      _e,
      payload: { tenderId: string; documentNaam: string; itemId: string; done: boolean },
    ) => {
      if (!payload?.tenderId || !payload?.documentNaam || !payload?.itemId) {
        return { ok: false, error: 'tenderId, documentNaam en itemId verplicht' }
      }
      const item = setChecklistItemDone({
        tenderId: payload.tenderId,
        documentNaam: payload.documentNaam,
        itemId: payload.itemId,
        done: Boolean(payload.done),
      })
      if (!item) return { ok: false, error: 'Item niet gevonden' }
      return { ok: true, item }
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
    (
      _e,
      payload: {
        tenderId: string
        url?: string
        title?: string
        snippet?: string
        /** @deprecated single summary-veld; alleen titel+snippet is verplicht */
        summary?: string
        query?: string
        kind?: 'auto' | 'doc_ref' | 'note'
      },
    ) => {
      if (!payload?.tenderId) {
        return { ok: false, error: 'tenderId verplicht' }
      }
      const kind = payload.kind ?? 'auto'
      let title = String(payload.title || '').trim()
      let snippet = String(payload.snippet || '').trim()
      if (payload.summary && !title && !snippet) {
        const s = String(payload.summary)
        const split = s.split(/\s+—\s+|\s+-\s+/)
        if (split.length > 1) {
          title = split[0].trim()
          snippet = split.slice(1).join(' — ').trim()
        } else {
          title = s.slice(0, 200)
          snippet = s.slice(200) || s
        }
      }
      const combined = [title, snippet].filter(Boolean).join(' — ')
      if (!combined) {
        return { ok: false, error: 'Titel of fragment ontbreekt' }
      }
      const res = addManualWebSearchToTender({
        tenderId: payload.tenderId,
        title: title || combined,
        url: payload.url,
        snippet: snippet || '',
        searchQuery: payload.query,
        kind,
      })
      if (!res.ok) return res
      enqueueIncrementalManualDocumentAnalysis(payload.tenderId, [res.textFileName])
      return { ok: true, id: res.id, resolvedKind: res.resolvedKind, textFileName: res.textFileName }
    },
  )

  ipcMain.handle(IPC.AGENT_DELETE_PINNED_NOTE, (_e, pinId: string) => {
    return deleteAgentPinnedNote(String(pinId || '').trim())
  })

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
    async (
      _e,
      payload: {
        tenderId: string
        documentNaam: string
        format?: 'pdf' | 'docx'
      },
    ) => {
      if (!payload?.tenderId || !payload?.documentNaam) {
        return { ok: false, error: 'tenderId en documentNaam verplicht' }
      }
      const format = payload.format === 'docx' ? 'docx' : 'pdf'
      const states = listFillStatesForDocument(payload.tenderId, payload.documentNaam)
      const filledStates = states.filter((s) => s.value_text && s.value_text.trim())
      if (filledStates.length === 0) {
        return { ok: false, error: 'Geen ingevulde velden om te exporteren.' }
      }

      const safeName = payload.documentNaam.replace(/[^a-zA-Z0-9._\-]/g, '_')
      const exportsDir = path.join(getAppDataPath(), 'filled-documents', payload.tenderId)
      fs.mkdirSync(exportsDir, { recursive: true })

      let outBuffer: Buffer
      let exportWarnings: string[] = []
      try {
        const built = await buildFilledOriginalExportBuffer({
          tenderId: payload.tenderId,
          documentNaam: payload.documentNaam,
          states,
          format,
        })
        outBuffer = built.buffer
        exportWarnings = built.warnings || []
        if (exportWarnings.length) {
          log.info(`[agent.ipc] export waarschuwingen (${payload.documentNaam}):`, exportWarnings.join(' | '))
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        log.warn('[agent.ipc] export brondocument:', msg)
        return { ok: false, error: msg }
      }

      const ext = format === 'docx' ? 'docx' : 'pdf'
      const baseName = `${safeName}_ingevuld_${Date.now()}.${ext}`
      const autoPath = path.join(exportsDir, baseName)
      fs.writeFileSync(autoPath, outBuffer)

      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const defaultFileName = `${safeName}_ingevuld.${ext}`
      const saveResult = win
        ? await dialog.showSaveDialog(win, {
            title:
              format === 'docx'
                ? 'Ingevuld brondocument opslaan (Word)'
                : 'Ingevuld brondocument opslaan (PDF)',
            defaultPath: defaultFileName,
            filters: [{ name: format === 'docx' ? 'Word' : 'PDF', extensions: [ext] }],
          })
        : { canceled: true, filePath: undefined }

      if (!saveResult.canceled && saveResult.filePath) {
        fs.copyFileSync(autoPath, saveResult.filePath)
        return { ok: true, filePath: saveResult.filePath, autoPath, warnings: exportWarnings }
      }

      return { ok: true, filePath: autoPath, autoPath, warnings: exportWarnings }
    },
  )
}
