import log from 'electron-log'
import { getDb } from '../db/connection'
import { aiService } from './ai-service'
import { fetchRisicoWetgevingsContext } from './risico-wetgevings-context'
import { parseAnalysisJsonResponse } from './parse-ai-json'
import {
  listAllFillStatesForTender,
  getFillSummaryForTender,
  saveFillValue,
  checkContradictionForField,
  persistContradiction,
} from './document-fill-engine'
import { searchWeb, pinSearchResultToTender, listPinnedNotes } from './web-search'
import { recordCorrection, inferDocumentTypeHint } from './agent-learning'
import type {
  Aanbesteding,
  AgentFieldType,
  AgentMessage,
  StoredDocumentEntry,
  AiExtractedTenderFields,
  RisicoAnalyseResult,
  ProcedureTimelineStep,
} from '../../shared/types'
import { readLocalDocumentAndExtractText } from '../scraping/document-fetcher'

// ---------------------------------------------------------------------------
// Systeemprompt: expert aanbestedingswetgeving, direct en zakelijk
// ---------------------------------------------------------------------------

const AGENT_BASE_PROMPT = `Je bent een senior aanbestedingsspecialist (Nederlandse + EU-aanbestedingsrecht) en
juridisch adviseur. Je kent Aanbestedingswet 2012, Gids Proportionaliteit, ARW 2016,
UAV 2012/UAV-GC 2005, AVG en de relevante EU-richtlijnen (2014/24/EU, 2014/25/EU).

STIJL
- Nederlands.
- Vriendelijk maar zeer to the point. Geen sugarcoating, geen vulsels.
- Zakelijk, feitelijk, juridisch scherp. Geef concrete, toetsbare stappen.
- Benoem expliciet wat risicovol is of wat conflicteert met de tendervoorwaarden.
- Als je iets niet zeker weet of niet in de documenten kunt vinden: zeg dat expliciet.

GEREEDSCHAPPEN
Je kunt tools gebruiken door in je antwoord UITSLUITEND een JSON-blok als dit op te nemen:
<<TOOL>>{"name":"<tool>","args":{...}}<<END>>
Gebruik één tool-call per beurt. Na een tool-result krijg je de kans opnieuw te antwoorden.

Beschikbare tools:
- read_document(document_naam: string) — Lees volledige tekst van een lokaal document in deze tender.
- web_search(query: string, count?: number) — Zoek op het internet; resultaten worden je getoond, de gebruiker beslist of ze worden toegevoegd aan het dossier.
- pin_search_result(url: string, summary: string, query?: string) — Voeg een gevonden internetresultaat toe aan het dossier (alleen na instemming gebruiker).
- get_fill_state(document_naam?: string) — Haal huidige invulstatus op van één of alle documenten.
- save_fill_value(document_naam, field_id, value) — Sla een veldwaarde op (alleen met instemming gebruiker).
- flag_contradiction(document_naam, field_id, severity, message) — Markeer veld als tegenstrijdig.
- search_documents(query: string) — Zoek binnen de bestaande documenten / ruwe tekst van deze aanbesteding.

ANTWOORDDISCIPLINE
- Zonder tool: geef een bondig zakelijk antwoord (max. ~6 regels tenzij gebruiker om detail vraagt).
- Bij invullen: stel per veld één heldere vraag, of geef meerdere vragen per stap in een wizardstijl.
- Markeer onzekerheden met [?].
- Bedragen Nederlands genoteerd (€ 1.234.567,89). Datums als DD-MM-JJJJ.`

function buildTenderContextBlock(
  tender: Aanbesteding,
  options: { includeLegal: boolean },
): string {
  let extracted: AiExtractedTenderFields = {}
  try {
    if (tender.ai_extracted_fields) extracted = JSON.parse(tender.ai_extracted_fields) as AiExtractedTenderFields
  } catch {
    /* ignore */
  }
  let risk: RisicoAnalyseResult | null = null
  try {
    if (tender.risico_analyse) risk = JSON.parse(tender.risico_analyse) as RisicoAnalyseResult
  } catch {
    /* ignore */
  }
  let timeline: ProcedureTimelineStep[] = []
  try {
    if (tender.tender_procedure_context) {
      const ctx = JSON.parse(tender.tender_procedure_context) as { timeline?: ProcedureTimelineStep[] }
      timeline = Array.isArray(ctx.timeline) ? ctx.timeline : []
    }
  } catch {
    /* ignore */
  }
  let documents: StoredDocumentEntry[] = []
  try {
    if (tender.document_urls) documents = JSON.parse(tender.document_urls) as StoredDocumentEntry[]
  } catch {
    /* ignore */
  }

  const blocks: string[] = []
  blocks.push(
    `AANBESTEDING:
- ID: ${tender.id}
- Titel: ${tender.titel}
- Opdrachtgever: ${extracted.opdrachtgever || tender.opdrachtgever || '-'}
- Referentienummer: ${extracted.referentienummer || tender.referentienummer || '-'}
- Publicatiedatum: ${extracted.publicatiedatum || tender.publicatiedatum || '-'}
- Sluitingsdatum inschrijving: ${extracted.sluitingsdatum_inschrijving || tender.sluitingsdatum || '-'}
- Start uitvoering: ${extracted.datum_start_uitvoering || '-'}
- Einde uitvoering: ${extracted.datum_einde_uitvoering || '-'}
- Procedure: ${extracted.procedure_type || '-'}
- Type opdracht: ${extracted.type_opdracht || tender.type_opdracht || '-'}
- Regio: ${extracted.locatie_of_regio || tender.regio || '-'}
- Geraamde waarde: ${extracted.geraamde_waarde || tender.geraamde_waarde || '-'}
- CPV / werkzaamheden: ${extracted.cpv_of_werkzaamheden || '-'}
- Beoordelingscriteria (kort): ${extracted.beoordelingscriteria_kort || '-'}`,
  )
  if (tender.ai_samenvatting) {
    blocks.push(`SAMENVATTING (AI):\n${tender.ai_samenvatting.slice(0, 2000)}`)
  }
  if (timeline.length) {
    const lines = timeline.slice(0, 12).map((s) => `- ${s.label}${s.date ? `: ${s.date}` : ''}${s.detail ? ` — ${s.detail}` : ''}`)
    blocks.push(`PROCEDURE-TIJDLIJN:\n${lines.join('\n')}`)
  }
  if (documents.length) {
    const lines = documents
      .slice(0, 50)
      .map((d) => `- ${d.naam}${d.localNaam ? ' (lokaal)' : ''}${d.type ? ` [${d.type}]` : ''}`)
    blocks.push(`DOCUMENTEN (${documents.length}):\n${lines.join('\n')}`)
  }
  if (risk) {
    const topRisks = (risk.top5_risicos || []).slice(0, 5).map((r, i) => `${i + 1}. ${r}`).join('\n')
    blocks.push(
      `RISICO-ANALYSE:
- Overall score: ${risk.overall_score}
- Advies: ${risk.inschrijfadvies}
- Managementsamenvatting: ${(risk.management_samenvatting || '').slice(0, 1500)}
- Top 5 risico's:\n${topRisks}
- Tegenstrijdigheden: ${(risk.tegenstrijdigheden || []).slice(0, 10).join(' | ') || '-'}
- No-go factoren: ${(risk.no_go_factoren || []).join(' | ') || '-'}`,
    )
  }
  const fillSummary = getFillSummaryForTender(tender.id)
  if (fillSummary.length) {
    const lines = fillSummary.map(
      (s) =>
        `- ${s.document_naam}: ${s.filled_fields}/${s.total_fields} ingevuld (${s.percentage}%)${
          s.contradictions > 0 ? ` · ${s.contradictions} tegenstrijdigheid(en)` : ''
        }`,
    )
    blocks.push(`INVULSTATUS:\n${lines.join('\n')}`)
  }
  const pinned = listPinnedNotes(tender.id)
  if (pinned.length) {
    const lines = pinned.slice(0, 8).map((p) => `- ${p.summary}${p.source_url ? ` (bron: ${p.source_url})` : ''}`)
    blocks.push(`EERDER TOEGEVOEGDE INTERNET-NOTITIES:\n${lines.join('\n')}`)
  }

  if (options.includeLegal) {
    blocks.push(`WETGEVINGSCONTEXT (samenvatting; raadpleeg bron voor volledige tekst):\nZie Aanbestedingswet 2012, Gids Proportionaliteit, ARW 2016, UAV 2012 / UAV-GC 2005.`)
  }

  return blocks.join('\n\n')
}

// ---------------------------------------------------------------------------
// Conversatiegeschiedenis
// ---------------------------------------------------------------------------

const MAX_HISTORY_MESSAGES = 30

export function loadHistory(tenderId?: string): AgentMessage[] {
  const db = getDb()
  const rows = tenderId
    ? (db
        .prepare(
          `SELECT id, tender_id, role, content, metadata_json, created_at
           FROM agent_conversations
           WHERE tender_id = ?
           ORDER BY created_at ASC
           LIMIT 500`,
        )
        .all(tenderId) as AgentMessage[])
    : (db
        .prepare(
          `SELECT id, tender_id, role, content, metadata_json, created_at
           FROM agent_conversations
           WHERE tender_id IS NULL
           ORDER BY created_at ASC
           LIMIT 500`,
        )
        .all() as AgentMessage[])
  return rows
}

export function clearHistory(tenderId?: string): void {
  const db = getDb()
  if (tenderId) {
    db.prepare('DELETE FROM agent_conversations WHERE tender_id = ?').run(tenderId)
  } else {
    db.prepare('DELETE FROM agent_conversations WHERE tender_id IS NULL').run()
  }
}

function appendMessage(input: {
  tenderId?: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  metadata?: Record<string, unknown>
}): string {
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
  getDb()
    .prepare(
      `INSERT INTO agent_conversations (id, tender_id, role, content, metadata_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, input.tenderId ?? null, input.role, input.content, input.metadata ? JSON.stringify(input.metadata) : null)
  return id
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

type ToolCall = { name: string; args: Record<string, unknown> }

function extractToolCall(text: string): { call: ToolCall | null; pre: string; post: string } {
  const startTag = '<<TOOL>>'
  const endTag = '<<END>>'
  const s = text.indexOf(startTag)
  if (s === -1) return { call: null, pre: text, post: '' }
  const e = text.indexOf(endTag, s)
  if (e === -1) return { call: null, pre: text, post: '' }
  const json = text.slice(s + startTag.length, e).trim()
  try {
    const parsed = JSON.parse(json) as { name?: string; args?: Record<string, unknown> }
    if (parsed && typeof parsed.name === 'string') {
      return {
        call: { name: parsed.name, args: (parsed.args as Record<string, unknown>) || {} },
        pre: text.slice(0, s).trim(),
        post: text.slice(e + endTag.length).trim(),
      }
    }
  } catch {
    /* geen geldige tool */
  }
  return { call: null, pre: text, post: '' }
}

async function runTool(
  call: ToolCall,
  ctx: { tenderId?: string; tender?: Aanbesteding | null },
): Promise<string> {
  const { name, args } = call
  try {
    switch (name) {
      case 'read_document': {
        if (!ctx.tender) return 'Geen tender-context.'
        const docNaam = String(args.document_naam || '')
        const docs = JSON.parse(ctx.tender.document_urls || '[]') as StoredDocumentEntry[]
        const match =
          docs.find((d) => d.naam === docNaam || d.localNaam === docNaam) ||
          docs.find((d) => d.naam.toLowerCase().includes(docNaam.toLowerCase()))
        if (!match || !match.localNaam) return `Document niet lokaal gevonden: ${docNaam}`
        const text = await readLocalDocumentAndExtractText(ctx.tender.id, match.localNaam, match.naam)
        return text.slice(0, 60_000)
      }
      case 'web_search': {
        const q = String(args.query || '')
        const count = typeof args.count === 'number' ? Math.min(10, args.count) : 5
        const results = await searchWeb(q, count)
        return JSON.stringify(results)
      }
      case 'pin_search_result': {
        if (!ctx.tenderId) return 'Geen tender.'
        const url = typeof args.url === 'string' ? args.url : undefined
        const summary = String(args.summary || '')
        const query = typeof args.query === 'string' ? args.query : undefined
        if (!summary) return 'Geen samenvatting geleverd.'
        pinSearchResultToTender({ tenderId: ctx.tenderId, url, summary, query })
        return 'Pinned.'
      }
      case 'get_fill_state': {
        if (!ctx.tenderId) return 'Geen tender.'
        const docName = typeof args.document_naam === 'string' ? args.document_naam : undefined
        const rows = listAllFillStatesForTender(ctx.tenderId)
        return JSON.stringify(docName ? rows.filter((r) => r.document_naam === docName) : rows)
      }
      case 'save_fill_value': {
        if (!ctx.tenderId) return 'Geen tender.'
        const document_naam = String(args.document_naam || '')
        const field_id = String(args.field_id || '')
        const value = String(args.value ?? '')
        if (!document_naam || !field_id) return 'document_naam en field_id verplicht.'
        const state = saveFillValue({
          tenderId: ctx.tenderId,
          documentNaam: document_naam,
          fieldId: field_id,
          value,
          source: 'ai',
        })
        if (state && ctx.tender) {
          const warning = checkContradictionForField({
            tender: ctx.tender,
            field: { id: state.field_id, label: state.field_label, type: state.field_type as AgentFieldType },
            value,
          })
          persistContradiction({
            tenderId: ctx.tenderId,
            documentNaam: document_naam,
            fieldId: field_id,
            warning,
          })
        }
        return 'Opgeslagen.'
      }
      case 'flag_contradiction': {
        if (!ctx.tenderId) return 'Geen tender.'
        const document_naam = String(args.document_naam || '')
        const field_id = String(args.field_id || '')
        const severity = (args.severity as 'info' | 'warn' | 'error') || 'warn'
        const message = String(args.message || '')
        persistContradiction({
          tenderId: ctx.tenderId,
          documentNaam: document_naam,
          fieldId: field_id,
          warning: message ? { field_id, field_label: '', severity, message } : null,
        })
        return 'Gemarkeerd.'
      }
      case 'search_documents': {
        if (!ctx.tender) return 'Geen tender-context.'
        const q = String(args.query || '').toLowerCase()
        if (!q) return '[]'
        const hits: Array<{ doc: string; snippet: string }> = []
        const hay = [
          { doc: 'beschrijving', text: ctx.tender.beschrijving || '' },
          { doc: 'ruwe_tekst', text: ctx.tender.ruwe_tekst || '' },
          { doc: 'samenvatting', text: ctx.tender.ai_samenvatting || '' },
        ]
        for (const h of hay) {
          const idx = h.text.toLowerCase().indexOf(q)
          if (idx >= 0) {
            const start = Math.max(0, idx - 120)
            hits.push({ doc: h.doc, snippet: h.text.slice(start, idx + 180) })
          }
        }
        return JSON.stringify(hits.slice(0, 10))
      }
      default:
        return `Onbekende tool: ${name}`
    }
  } catch (e) {
    log.warn('[agent-service] tool-fout:', e)
    return `Tool-fout: ${e instanceof Error ? e.message : String(e)}`
  }
}

// ---------------------------------------------------------------------------
// Publieke chat-functie
// ---------------------------------------------------------------------------

async function buildSystemPrompt(tenderId?: string): Promise<string> {
  const parts: string[] = [AGENT_BASE_PROMPT]
  if (tenderId) {
    const tender = getDb().prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(tenderId) as
      | Aanbesteding
      | undefined
    if (tender) {
      parts.push(buildTenderContextBlock(tender, { includeLegal: false }))
    }
  }
  try {
    const wet = await fetchRisicoWetgevingsContext()
    if (wet) parts.push(`WETGEVINGSCONTEXT (extract):\n${wet.slice(0, 6000)}`)
  } catch {
    /* optioneel */
  }
  return parts.join('\n\n')
}

export type AgentChunkHandler = (chunk: {
  id: string
  delta?: string
  tool?: { name: string; args: Record<string, unknown>; result?: string }
  done?: boolean
  error?: string
}) => void

export interface AgentSendOptions {
  tenderId?: string
  message: string
  onChunk?: AgentChunkHandler
  /** Maximaal aantal tool-loops. */
  maxIterations?: number
}

export async function sendAgentMessage(opts: AgentSendOptions): Promise<{
  assistantMessageId: string
  text: string
}> {
  const { tenderId, message, onChunk, maxIterations = 4 } = opts
  const streamId = Math.random().toString(36).slice(2) + Date.now().toString(36)

  const tender = tenderId
    ? (getDb().prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(tenderId) as Aanbesteding | undefined) || null
    : null

  const systemPrompt = await buildSystemPrompt(tenderId)

  const history = loadHistory(tenderId).slice(-MAX_HISTORY_MESSAGES)
  const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...history.map((h) => ({ role: h.role === 'tool' ? 'assistant' : (h.role as 'user' | 'assistant'), content: h.content })),
    { role: 'user', content: message },
  ]

  appendMessage({ tenderId, role: 'user', content: message })

  let assistantText = ''
  for (let iter = 0; iter < maxIterations; iter++) {
    let raw = ''
    try {
      raw = await aiService.chat(chatMessages, { preferJsonOutput: false })
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      onChunk?.({ id: streamId, error: err, done: true })
      const mid = appendMessage({
        tenderId,
        role: 'assistant',
        content: `Fout bij AI: ${err}`,
        metadata: { error: true },
      })
      return { assistantMessageId: mid, text: `Fout bij AI: ${err}` }
    }

    const { call, pre, post } = extractToolCall(raw)
    if (pre) {
      onChunk?.({ id: streamId, delta: pre })
      assistantText += pre
    }

    if (!call) {
      if (post) {
        onChunk?.({ id: streamId, delta: post })
        assistantText += post
      } else if (!pre) {
        onChunk?.({ id: streamId, delta: raw })
        assistantText += raw
      }
      onChunk?.({ id: streamId, done: true })
      const mid = appendMessage({ tenderId, role: 'assistant', content: assistantText })
      return { assistantMessageId: mid, text: assistantText }
    }

    const toolResult = await runTool(call, { tenderId, tender })
    onChunk?.({ id: streamId, tool: { name: call.name, args: call.args, result: toolResult.slice(0, 400) } })
    appendMessage({
      tenderId,
      role: 'assistant',
      content: pre,
      metadata: { tool_call: call },
    })
    appendMessage({
      tenderId,
      role: 'tool',
      content: toolResult,
      metadata: { tool: call.name },
    })

    chatMessages.push({ role: 'assistant', content: `${pre}\n<<TOOL>>${JSON.stringify(call)}<<END>>` })
    chatMessages.push({
      role: 'user',
      content: `TOOL_RESULT(${call.name}):\n${toolResult.slice(0, 40_000)}`,
    })
  }

  // Max iteraties bereikt.
  onChunk?.({ id: streamId, delta: '\n[Max tool-iteraties bereikt]', done: true })
  const mid = appendMessage({
    tenderId,
    role: 'assistant',
    content: assistantText || '(geen reactie)',
    metadata: { truncated: true },
  })
  return { assistantMessageId: mid, text: assistantText }
}

// ---------------------------------------------------------------------------
// Export helper voor correctieregistratie vanuit IPC
// ---------------------------------------------------------------------------

export function registerUserCorrection(input: {
  tenderId?: string
  documentNaam: string
  fieldId: string
  fieldLabel?: string
  newValue: string
}): void {
  recordCorrection({
    tenderId: input.tenderId,
    documentNaam: input.documentNaam,
    fieldId: input.fieldId,
    fieldLabel: input.fieldLabel,
    newValue: input.newValue,
  })
}

export function getDocumentTypeHintFor(documentNaam: string): string {
  return inferDocumentTypeHint(documentNaam)
}
