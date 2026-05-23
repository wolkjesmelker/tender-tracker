import log from 'electron-log'
import { getDb } from '../db/connection'
import { aiService } from './ai-service'
import { parseAnalysisJsonResponse } from './parse-ai-json'
import { readLocalDocumentAndExtractText } from '../scraping/document-fetcher'
import { logTokenUsage, normalizeUsageFromApiBody } from './token-logger'
import { fetchWithRetry, formatFetchFailure } from '../utils/http-resilience'
import type {
  Aanbesteding,
  AgentFieldDefinition,
  AgentFieldType,
  AgentFillState,
  AgentFillStatus,
  AgentDocumentFillSummary,
  AgentDocumentChecklistItem,
  AgentContradictionWarning,
  AiExtractedTenderFields,
  RisicoAnalyseResult,
  StoredDocumentEntry,
} from '../../shared/types'
import { lookupLearnedAnswer } from './agent-learning'
import {
  documentTextSuggestsFillableFields,
  isFillableCatalogEntry,
  isWordProcessorExtension,
} from '../../shared/fillable-document'
import { APP_SETTING_DOC_FILL_PROMPT } from '../../shared/constants'
import {
  DEFAULT_DOCUMENT_FILL_PROMPT,
  FIELD_EXTRACTION_JSON_SCHEMA_HINT,
  CHECKLIST_EXTRACTION_JSON_SCHEMA_HINT,
} from './document-fill-prompt-defaults'

export { isFillableDocumentName, isFillableCatalogEntry } from '../../shared/fillable-document'

/**
 * Heeft dit document al veld-definities in de DB? Dan overslaan we de pre-analyse
 * (idempotent — herstart risicoanalyse doet geen duplicate werk).
 */
export function hasCachedFieldDefinitions(tenderId: string, documentNaam: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM agent_document_fills WHERE tender_id = ? AND document_naam = ?`,
    )
    .get(tenderId, documentNaam) as { n: number } | undefined
  return !!row && Number(row.n || 0) > 0
}

/** Staat er al een (door de LLM opgestelde) checklist voor dit document in de DB? */
export function hasCachedChecklist(tenderId: string, documentNaam: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM agent_document_checklists WHERE tender_id = ? AND document_naam = ?`,
    )
    .get(tenderId, documentNaam) as { n: number } | undefined
  return !!row && Number(row.n || 0) > 0
}

/**
 * Laad de actieve document-invul-prompt uit app_settings; valt terug op de
 * ingebouwde default. Lege waarden in app_settings gedragen zich als "niet
 * ingesteld" zodat de default niet per ongeluk wordt overschreven.
 */
export function loadDocumentFillSystemPrompt(): string {
  try {
    const row = getDb()
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(APP_SETTING_DOC_FILL_PROMPT) as { value: string } | undefined
    const trimmed = (row?.value || '').trim()
    if (trimmed.length > 40) return trimmed
  } catch {
    /* ignore */
  }
  return DEFAULT_DOCUMENT_FILL_PROMPT
}

/** Normaliseer whitespace zonder de substring-relatie te breken. */
function normalizeForSubstringCheck(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Controleer of `quote` een geldige substring van `haystack` is. We accepteren
 * zowel exacte matches als matches na whitespace-collapsering; dat voorkomt dat
 * harde regeleindes in de bron ten onrechte items verwerpen.
 */
function isSubstringQuote(haystack: string, quote: string): boolean {
  if (!quote || quote.trim().length < 8) return false
  if (haystack.includes(quote)) return true
  const nH = normalizeForSubstringCheck(haystack)
  const nQ = normalizeForSubstringCheck(quote)
  if (nQ.length < 8) return false
  return nH.includes(nQ)
}

// ---------------------------------------------------------------------------
// Directe Claude Sonnet 4.5 aanroep (voor veldextractie tijdens risicoanalyse)
// ---------------------------------------------------------------------------

/** Model-identifier zoals gespecificeerd door de gebruiker. */
export const AGENT_FIELD_EXTRACTION_MODEL = 'claude-sonnet-4-5'

/**
 * Retourneert de Anthropic-API-key uit app_settings. Als de actieve provider
 * Claude is, staat de sleutel in `ai_api_key`. Anders kan optioneel een
 * specifieke `claude_api_key` worden geconfigureerd.
 */
function loadClaudeApiKey(): string | null {
  try {
    const rows = getDb().prepare('SELECT key, value FROM app_settings').all() as Array<{
      key: string
      value: string
    }>
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value
    const provider = (map.ai_provider || '').trim().toLowerCase()
    const dedicated = (map.claude_api_key || '').trim()
    if (dedicated) return dedicated
    if (provider === 'claude' && (map.ai_api_key || '').trim()) {
      return map.ai_api_key.trim()
    }
    return null
  } catch {
    return null
  }
}

async function callClaudeSonnet45(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<string> {
  const apiKey = loadClaudeApiKey()
  if (!apiKey) {
    throw new Error(
      'Geen Anthropic API-sleutel beschikbaar voor ' +
        `${AGENT_FIELD_EXTRACTION_MODEL}. Zet je Claude-sleutel in Instellingen (provider = Claude) ` +
        'of vul "claude_api_key" in app_settings.',
    )
  }
  const systemMessage = messages.find((m) => m.role === 'system')?.content || ''
  const userMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }))

  const endpoint = 'https://api.anthropic.com/v1/messages'
  let response: Response
  try {
    response = await fetchWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: AGENT_FIELD_EXTRACTION_MODEL,
          max_tokens: 16000,
          system: systemMessage,
          messages: userMessages,
        }),
      },
      { maxAttempts: 3, baseDelayMs: 1200, maxDelayMs: 8_000, timeoutPerAttemptMs: 180_000 },
    )
  } catch (e) {
    throw formatFetchFailure(e, `Claude API niet bereikbaar (${AGENT_FIELD_EXTRACTION_MODEL})`, endpoint)
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Claude API error ${response.status}: ${errText.slice(0, 500)}`)
  }
  const data = (await response.json()) as { content?: Array<{ text?: string }> }
  const usage = normalizeUsageFromApiBody(data)
  logTokenUsage('Claude', AGENT_FIELD_EXTRACTION_MODEL, usage.input, usage.output)
  return data.content?.[0]?.text || ''
}

// ---------------------------------------------------------------------------
// Publiek: velden laden/bewaren/samenvatten
// ---------------------------------------------------------------------------

function rowToFillState(r: Record<string, unknown>): AgentFillState {
  let opts: { value: string; label: string }[] | undefined
  const optsJson = r.field_options_json as string | null | undefined
  if (optsJson) {
    try {
      opts = JSON.parse(optsJson) as { value: string; label: string }[]
    } catch {
      opts = undefined
    }
  }
  return {
    tender_id: String(r.tender_id),
    document_naam: String(r.document_naam),
    field_id: String(r.field_id),
    field_label: String(r.field_label ?? r.field_id),
    field_type: (String(r.field_type ?? 'text') as AgentFieldType) || 'text',
    field_required: Number(r.field_required) === 1,
    field_description: (r.field_description as string) ?? undefined,
    field_options: opts,
    field_group: (r.field_group as string) ?? undefined,
    field_order: Number(r.field_order ?? 0),
    value_text: (r.value_text as string) ?? undefined,
    status: (r.status as AgentFillStatus) ?? 'empty',
    source: (r.source as AgentFillState['source']) ?? 'ai',
    confidence: typeof r.confidence === 'number' ? (r.confidence as number) : undefined,
    contradiction_flag: Number(r.contradiction_flag) === 1,
    contradiction_detail: (r.contradiction_detail as string) ?? undefined,
    source_quote: (r.source_quote as string) ?? undefined,
    user_touched: Number(r.user_touched ?? 0) === 1,
    updated_at: String(r.updated_at ?? ''),
  }
}

export function listFillStatesForDocument(
  tenderId: string,
  documentNaam: string,
): AgentFillState[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM agent_document_fills WHERE tender_id = ? AND document_naam = ?
       ORDER BY field_order ASC, field_id ASC`,
    )
    .all(tenderId, documentNaam) as Record<string, unknown>[]
  return rows.map(rowToFillState)
}

export function listAllFillStatesForTender(tenderId: string): AgentFillState[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM agent_document_fills WHERE tender_id = ?
       ORDER BY document_naam ASC, field_order ASC, field_id ASC`,
    )
    .all(tenderId) as Record<string, unknown>[]
  return rows.map(rowToFillState)
}

export function getFillSummaryForTender(tenderId: string): AgentDocumentFillSummary[] {
  const db = getDb()

  const fillRows = db
    .prepare(
      `SELECT document_naam,
              COUNT(*) AS total,
              SUM(CASE WHEN status IN ('filled','approved') THEN 1 ELSE 0 END) AS filled,
              SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partial,
              SUM(CASE WHEN contradiction_flag = 1 THEN 1 ELSE 0 END) AS contradictions,
              SUM(CASE WHEN user_touched = 1 AND TRIM(COALESCE(value_text,'')) <> '' THEN 1 ELSE 0 END) AS user_filled,
              SUM(CASE WHEN field_required = 1 THEN 1 ELSE 0 END) AS required_total,
              SUM(CASE WHEN field_required = 1
                        AND (status IN ('filled','approved')
                             OR (user_touched = 1 AND TRIM(COALESCE(value_text,'')) <> ''))
                      THEN 1 ELSE 0 END) AS required_filled
       FROM agent_document_fills
       WHERE tender_id = ?
       GROUP BY document_naam`,
    )
    .all(tenderId) as Array<{
    document_naam: string
    total: number
    filled: number
    partial: number
    contradictions: number
    user_filled: number
    required_total: number
    required_filled: number
  }>

  const checklistRows = db
    .prepare(
      `SELECT document_naam,
              COUNT(*) AS total,
              SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) AS done
       FROM agent_document_checklists
       WHERE tender_id = ?
       GROUP BY document_naam`,
    )
    .all(tenderId) as Array<{ document_naam: string; total: number; done: number }>

  const checklistByDoc = new Map<string, { total: number; done: number }>()
  for (const c of checklistRows) {
    checklistByDoc.set(c.document_naam, { total: Number(c.total || 0), done: Number(c.done || 0) })
  }

  const byDoc = new Map<string, AgentDocumentFillSummary>()

  for (const r of fillRows) {
    const total = Number(r.total || 0)
    const filled = Number(r.filled || 0)
    const partial = Number(r.partial || 0)
    const contradictions = Number(r.contradictions || 0)
    const userFilled = Number(r.user_filled || 0)
    const requiredTotal = Number(r.required_total || 0)
    const requiredFilled = Number(r.required_filled || 0)

    // Basis voor % is de verplichte velden (valt terug op totaal als er geen
    // verplichte velden zijn gemarkeerd). Zo klimt de voortgang ook als de
    // gebruiker de verplichte regels volmaakt zonder de optionele aan te raken.
    const pctBasisTotal = requiredTotal > 0 ? requiredTotal : total
    const pctBasisFilled = requiredTotal > 0 ? requiredFilled : filled
    const pct = pctBasisTotal > 0 ? Math.round((pctBasisFilled / pctBasisTotal) * 100) : 0

    const userStarted = userFilled > 0
    const checklist = checklistByDoc.get(r.document_naam) || { total: 0, done: 0 }

    // Combineer statuskeuze met zowel velden als checklist — alleen "complete" als
    // beide kanten volledig zijn (0/0 telt als compleet).
    const fieldsComplete = pctBasisTotal === 0 ? true : pctBasisFilled >= pctBasisTotal
    const checklistComplete = checklist.total === 0 ? true : checklist.done >= checklist.total

    let status: AgentDocumentFillSummary['status']
    if (contradictions > 0) status = 'contradiction'
    else if (!userStarted && filled === 0 && partial === 0 && checklist.done === 0) status = 'not_started'
    else if (fieldsComplete && checklistComplete) status = 'complete'
    else status = 'partial'

    byDoc.set(r.document_naam, {
      document_naam: r.document_naam,
      total_fields: total,
      filled_fields: filled,
      partial_fields: partial,
      contradictions,
      status,
      percentage: pct,
      user_started: userStarted,
      required_total: requiredTotal,
      required_filled: requiredFilled,
      checklist_total: checklist.total,
      checklist_done: checklist.done,
    })
  }

  // Documenten die alleen een checklist hebben (geen veldextractie) — ook tonen.
  for (const [doc, c] of checklistByDoc) {
    if (byDoc.has(doc)) continue
    const checklistComplete = c.total === 0 ? true : c.done >= c.total
    byDoc.set(doc, {
      document_naam: doc,
      total_fields: 0,
      filled_fields: 0,
      partial_fields: 0,
      contradictions: 0,
      status: c.done === 0 ? 'not_started' : checklistComplete ? 'complete' : 'partial',
      percentage: 0,
      user_started: c.done > 0,
      required_total: 0,
      required_filled: 0,
      checklist_total: c.total,
      checklist_done: c.done,
    })
  }

  return Array.from(byDoc.values())
}

// ---------------------------------------------------------------------------
// Velden extraheren uit documenttekst (LLM)
// ---------------------------------------------------------------------------

function safeRandomId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function sanitizeFieldType(v: unknown): AgentFieldType {
  const s = String(v || '').toLowerCase()
  const allowed: AgentFieldType[] = ['text', 'textarea', 'date', 'amount', 'number', 'choice', 'multichoice', 'boolean']
  return (allowed as string[]).includes(s) ? (s as AgentFieldType) : 'text'
}

/**
 * Haal (en cache binnen de call) de volledige tekst van een lokaal document.
 * Gebruikt door zowel veld- als checklist-extractie tijdens de pre-analyse.
 */
async function readDocumentFullText(
  tenderId: string,
  document: StoredDocumentEntry,
): Promise<string> {
  if (!document.localNaam) return ''
  try {
    return await readLocalDocumentAndExtractText(
      tenderId,
      document.localNaam,
      document.naam,
    )
  } catch (e) {
    log.warn('[doc-fill-engine] kon document niet lezen:', e)
    return ''
  }
}

type VeldenExtractieResultaat = {
  fields: AgentFieldDefinition[]
  fieldQuotes: Record<string, string>
  documentTypeHint: string
}

async function runLlmForDocFill(
  systemPrompt: string,
  userMsg: string,
  preferClaude: boolean,
): Promise<string> {
  if (preferClaude && loadClaudeApiKey()) {
    try {
      return await callClaudeSonnet45([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ])
    } catch (e) {
      log.warn(
        `[doc-fill-engine] ${AGENT_FIELD_EXTRACTION_MODEL} mislukt, val terug op hoofd-AI:`,
        e instanceof Error ? e.message : String(e),
      )
    }
  }
  return aiService.chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ],
    { preferJsonOutput: true },
  )
}

export async function analyzeDocumentForFields(input: {
  tenderId: string
  document: StoredDocumentEntry
  /** Forceer Claude Sonnet 4.5 (standaard tijdens risico-analyse). Valt
   *  automatisch terug op `aiService` als geen Claude-sleutel beschikbaar is. */
  useClaudeSonnet45?: boolean
  /** Optioneel: al eerder opgehaalde documenttekst (voorkomt dubbel lezen). */
  fullText?: string
}): Promise<VeldenExtractieResultaat> {
  const { tenderId, document } = input
  const logicalName = document.naam

  const fullText = input.fullText ?? (await readDocumentFullText(tenderId, document))
  if (!fullText || fullText.length < 40) {
    return { documentTypeHint: 'overig', fields: [], fieldQuotes: {} }
  }

  const truncated = fullText.length > 120_000 ? fullText.slice(0, 120_000) : fullText
  const systemPrompt = loadDocumentFillSystemPrompt()
  const userMsg =
    `Documentnaam: ${logicalName}\n\n` +
    `TAAK: Invulvelden identificeren (onderdeel A van je systeeminstructie).\n\n` +
    `${FIELD_EXTRACTION_JSON_SCHEMA_HINT}\n\n` +
    `Documenttekst (maximaal ${truncated.length.toLocaleString()} tekens):\n${truncated}`

  const raw = await runLlmForDocFill(systemPrompt, userMsg, input.useClaudeSonnet45 ?? false)

  const parsed = parseAnalysisJsonResponse(raw).parsed as
    | { document_type_hint?: string; fields?: unknown[] }
    | null
  if (!parsed || !Array.isArray(parsed.fields)) {
    log.warn('[doc-fill-engine] LLM gaf geen geldige velden-JSON.')
    return { documentTypeHint: 'overig', fields: [], fieldQuotes: {} }
  }

  const seen = new Set<string>()
  const fields: AgentFieldDefinition[] = []
  const fieldQuotes: Record<string, string> = {}
  let rejectedNoQuote = 0
  for (const raw of parsed.fields as Record<string, unknown>[]) {
    let id = String(raw.id ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!id) id = `veld-${safeRandomId()}`
    if (seen.has(id)) id = `${id}-${safeRandomId()}`
    const quote = typeof raw.source_quote === 'string' ? raw.source_quote : ''
    if (!isSubstringQuote(fullText, quote)) {
      // Veldnaam niet te onderbouwen met letterlijke substring → weglaten.
      rejectedNoQuote += 1
      continue
    }
    seen.add(id)
    const label = String(raw.label ?? id)
    const type = sanitizeFieldType(raw.type)
    const required = Boolean(raw.required)
    const description = typeof raw.description === 'string' ? raw.description : undefined
    let options: { value: string; label: string }[] | undefined
    if (Array.isArray(raw.options)) {
      options = (raw.options as Array<Record<string, unknown>>)
        .filter((o) => o && (o.value != null || o.label != null))
        .map((o) => ({
          value: String(o.value ?? o.label ?? ''),
          label: String(o.label ?? o.value ?? ''),
        }))
    }
    const group = typeof raw.group === 'string' ? raw.group : undefined
    const order = typeof raw.order === 'number' ? raw.order : fields.length
    fields.push({ id, label, type, required, description, options, group, order })
    fieldQuotes[id] = quote
  }

  if (rejectedNoQuote > 0) {
    log.info(
      `[doc-fill-engine] ${rejectedNoQuote} veld(en) genegeerd zonder geldige substring-quote (${logicalName}).`,
    )
  }

  return {
    documentTypeHint: String(parsed.document_type_hint ?? 'overig'),
    fields,
    fieldQuotes,
  }
}

/**
 * Vraagt de LLM om een checklist "te verzamelen informatie door de inschrijver"
 * bij één document. Elk item moet een letterlijke substring-quote uit de
 * documenttekst meegeven; items zonder geldige quote worden verworpen.
 */
export async function analyzeDocumentForInfoChecklist(input: {
  tenderId: string
  document: StoredDocumentEntry
  useClaudeSonnet45?: boolean
  fullText?: string
}): Promise<
  Array<{ id: string; label: string; hint?: string; order: number; sourceQuote: string }>
> {
  const { tenderId, document } = input
  const logicalName = document.naam

  const fullText = input.fullText ?? (await readDocumentFullText(tenderId, document))
  if (!fullText || fullText.length < 40) return []

  const truncated = fullText.length > 120_000 ? fullText.slice(0, 120_000) : fullText
  const systemPrompt = loadDocumentFillSystemPrompt()
  const userMsg =
    `Documentnaam: ${logicalName}\n\n` +
    `TAAK: Checklist "te verzamelen informatie door de inschrijver" (onderdeel B van je systeeminstructie).\n\n` +
    `${CHECKLIST_EXTRACTION_JSON_SCHEMA_HINT}\n\n` +
    `Documenttekst (maximaal ${truncated.length.toLocaleString()} tekens):\n${truncated}`

  let raw = ''
  try {
    raw = await runLlmForDocFill(systemPrompt, userMsg, input.useClaudeSonnet45 ?? false)
  } catch (e) {
    log.warn(
      `[doc-fill-engine] checklist-extractie mislukt voor ${logicalName}:`,
      e instanceof Error ? e.message : String(e),
    )
    return []
  }

  const parsed = parseAnalysisJsonResponse(raw).parsed as
    | { items?: unknown[] }
    | null
  if (!parsed || !Array.isArray(parsed.items)) {
    log.warn('[doc-fill-engine] LLM gaf geen geldige checklist-JSON.')
    return []
  }

  const out: Array<{ id: string; label: string; hint?: string; order: number; sourceQuote: string }> = []
  const seen = new Set<string>()
  let rejectedNoQuote = 0
  for (const row of parsed.items as Record<string, unknown>[]) {
    const quote = typeof row.source_quote === 'string' ? row.source_quote : ''
    if (!isSubstringQuote(fullText, quote)) {
      rejectedNoQuote += 1
      continue
    }
    let id = String(row.id ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!id) id = `item-${safeRandomId()}`
    if (seen.has(id)) id = `${id}-${safeRandomId()}`
    seen.add(id)
    const label = String(row.label ?? '').trim() || quote.slice(0, 80)
    const hint = typeof row.hint === 'string' && row.hint.trim() ? row.hint.trim() : undefined
    const order = typeof row.order === 'number' ? row.order : out.length
    out.push({ id, label, hint, order, sourceQuote: quote })
  }
  if (rejectedNoQuote > 0) {
    log.info(
      `[doc-fill-engine] ${rejectedNoQuote} checklist-item(s) genegeerd zonder geldige substring-quote (${logicalName}).`,
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// Voorstelwaarden op basis van tender + leergeheugen
// ---------------------------------------------------------------------------

function pickTenderDerivedValue(field: AgentFieldDefinition, tender: Aanbesteding): string | null {
  let extracted: AiExtractedTenderFields = {}
  try {
    if (tender.ai_extracted_fields) {
      extracted = JSON.parse(tender.ai_extracted_fields) as AiExtractedTenderFields
    }
  } catch {
    /* ignore */
  }

  const label = field.label.toLowerCase()
  const id = field.id.toLowerCase()
  const match = (...tokens: string[]) => tokens.some((t) => id.includes(t) || label.includes(t))

  if (field.type === 'date') {
    if (match('publicat')) return extracted.publicatiedatum || null
    if (match('sluit', 'inschrijf')) return extracted.sluitingsdatum_inschrijving || tender.sluitingsdatum || null
    if (match('start', 'aanvang')) return extracted.datum_start_uitvoering || null
    if (match('eind', 'oplever', 'voltooi')) return extracted.datum_einde_uitvoering || null
  }

  if (match('opdrachtgev', 'aanbestede')) return extracted.opdrachtgever || tender.opdrachtgever || null
  if (match('referentie', 'kenmerk', 'dossiernr')) return extracted.referentienummer || tender.referentienummer || null
  if (match('procedure')) return extracted.procedure_type || null
  if (match('projectnaam', 'opdrachtnaam', 'werknaam')) return tender.titel
  if (match('regio', 'locatie')) return extracted.locatie_of_regio || tender.regio || null
  if (match('cpv', 'werkzaamheden')) return extracted.cpv_of_werkzaamheden || null
  if (field.type === 'amount' && match('raming', 'waarde', 'budget'))
    return extracted.geraamde_waarde || tender.geraamde_waarde || null

  return null
}

/** Stelt waarden voor per veld; combineert tender-afleiding en leergeheugen. */
export function generateFillProposals(input: {
  tender: Aanbesteding
  documentNaam: string
  fields: AgentFieldDefinition[]
}): Array<{ field_id: string; value: string; source: 'ai' | 'learning'; confidence: number }> {
  const out: Array<{ field_id: string; value: string; source: 'ai' | 'learning'; confidence: number }> = []
  for (const f of input.fields) {
    const learned = lookupLearnedAnswer({
      documentNaam: input.documentNaam,
      fieldId: f.id,
      fieldLabel: f.label,
    })
    const derived = pickTenderDerivedValue(f, input.tender)

    if (derived && derived.trim()) {
      out.push({ field_id: f.id, value: derived, source: 'ai', confidence: 0.7 })
      continue
    }
    if (learned && learned.preferred_answer) {
      const conf = Math.min(0.95, 0.55 + (learned.use_count - 1) * 0.05)
      out.push({ field_id: f.id, value: learned.preferred_answer, source: 'learning', confidence: conf })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Bewaren van velden + tegenstrijdigheidscheck
// ---------------------------------------------------------------------------

export function persistFieldDefinitions(input: {
  tenderId: string
  documentNaam: string
  fields: AgentFieldDefinition[]
  /** Map `field_id` → letterlijke substring uit documenttekst (optioneel). */
  fieldQuotes?: Record<string, string>
}): void {
  const db = getDb()
  const quotes = input.fieldQuotes || {}
  const insert = db.prepare(
    `INSERT INTO agent_document_fills
       (tender_id, document_naam, field_id, field_label, field_type,
        field_options_json, field_required, field_description, field_order, field_group,
        source_quote, value_text, status, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'empty', 'ai', datetime('now'))
     ON CONFLICT(tender_id, document_naam, field_id) DO UPDATE SET
       field_label = excluded.field_label,
       field_type = excluded.field_type,
       field_options_json = excluded.field_options_json,
       field_required = excluded.field_required,
       field_description = excluded.field_description,
       field_order = excluded.field_order,
       field_group = excluded.field_group,
       source_quote = COALESCE(excluded.source_quote, agent_document_fills.source_quote),
       updated_at = datetime('now')`,
  )
  const tx = db.transaction((rows: AgentFieldDefinition[]) => {
    for (const [idx, f] of rows.entries()) {
      insert.run(
        input.tenderId,
        input.documentNaam,
        f.id,
        f.label,
        f.type,
        f.options ? JSON.stringify(f.options) : null,
        f.required ? 1 : 0,
        f.description ?? null,
        f.order ?? idx,
        f.group ?? null,
        quotes[f.id] ?? null,
      )
    }
  })
  tx(input.fields)
}

export function applyProposalsIfEmpty(input: {
  tenderId: string
  documentNaam: string
  proposals: Array<{ field_id: string; value: string; source: 'ai' | 'learning'; confidence: number }>
}): void {
  const db = getDb()
  const upd = db.prepare(
    `UPDATE agent_document_fills
     SET value_text = ?, status = 'proposed', source = ?, confidence = ?, updated_at = datetime('now')
     WHERE tender_id = ? AND document_naam = ? AND field_id = ?
       AND (value_text IS NULL OR TRIM(COALESCE(value_text,'')) = '')
       AND status IN ('empty','proposed')`,
  )
  const tx = db.transaction((rows: typeof input.proposals) => {
    for (const p of rows) {
      upd.run(p.value, p.source, p.confidence, input.tenderId, input.documentNaam, p.field_id)
    }
  })
  tx(input.proposals)
}

export function saveFillValue(input: {
  tenderId: string
  documentNaam: string
  fieldId: string
  value: string
  source: 'ai' | 'user' | 'learning'
  markApproved?: boolean
}): AgentFillState | null {
  const db = getDb()
  const trimmed = String(input.value ?? '')
  const status: AgentFillStatus = trimmed.trim()
    ? input.markApproved
      ? 'approved'
      : input.source === 'user'
        ? 'filled'
        : 'proposed'
    : 'empty'

  // user_touched wordt "sticky": zodra een gebruiker dit veld echt heeft ingevuld
  // of goedgekeurd, blijft de vlag staan — ook als de gebruiker de waarde later
  // weer leegmaakt. Zo blijft de voortgang (user_started) consistent en kan de
  // wizard velden correct markeren als "door jou aangeraakt".
  const markUserTouched =
    (input.source === 'user' || input.markApproved === true) && trimmed.trim().length > 0

  db.prepare(
    `UPDATE agent_document_fills
     SET value_text = ?,
         status = ?,
         source = ?,
         contradiction_flag = 0,
         contradiction_detail = NULL,
         user_touched = CASE WHEN ? = 1 THEN 1 ELSE user_touched END,
         updated_at = datetime('now')
     WHERE tender_id = ? AND document_naam = ? AND field_id = ?`,
  ).run(
    trimmed,
    status,
    input.source,
    markUserTouched ? 1 : 0,
    input.tenderId,
    input.documentNaam,
    input.fieldId,
  )

  const row = db
    .prepare(
      `SELECT * FROM agent_document_fills WHERE tender_id = ? AND document_naam = ? AND field_id = ?`,
    )
    .get(input.tenderId, input.documentNaam, input.fieldId) as Record<string, unknown> | undefined
  return row ? rowToFillState(row) : null
}

export function markPartialIfIncomplete(tenderId: string, documentNaam: string): void {
  const db = getDb()
  db.prepare(
    `UPDATE agent_document_fills
     SET status = CASE
       WHEN TRIM(COALESCE(value_text,'')) <> '' AND status = 'empty' THEN 'partial'
       ELSE status
     END
     WHERE tender_id = ? AND document_naam = ?`,
  ).run(tenderId, documentNaam)
}

// ---------------------------------------------------------------------------
// Tegenstrijdigheidscheck
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function dateFromFieldValue(v: string): Date | null {
  const s = v.trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`)
  const nl = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  if (nl) return new Date(`${nl[3]}-${nl[2].padStart(2, '0')}-${nl[1].padStart(2, '0')}T00:00:00Z`)
  return null
}

function parseAmount(v: string): number | null {
  const s = v.replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function checkContradictionForField(input: {
  tender: Aanbesteding
  field: { id: string; label: string; type: AgentFieldType }
  value: string
}): AgentContradictionWarning | null {
  const { tender, field, value } = input
  if (!value || !value.trim()) return null

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

  const idLabel = `${field.id} ${field.label}`.toLowerCase()

  // Datumcheck: inschrijfdatum mag niet na sluitingsdatum liggen
  if (field.type === 'date' && /(inschrij|aanbied|offerte)/.test(idLabel)) {
    const userDate = dateFromFieldValue(value)
    const deadline = extracted.sluitingsdatum_inschrijving || tender.sluitingsdatum
    const dDate = deadline ? dateFromFieldValue(deadline) : null
    if (userDate && dDate && userDate.getTime() > dDate.getTime()) {
      return {
        field_id: field.id,
        field_label: field.label,
        severity: 'error',
        message: `Datum ligt na de sluitingsdatum inschrijving (${deadline}). Dat maakt de inschrijving ongeldig.`,
        conflict_source: 'sluitingsdatum inschrijving',
      }
    }
  }

  // Bedrag-check: inschrijfsom boven geraamde waarde
  if (field.type === 'amount' && /(inschrijfsom|prijs|totaalprijs|aanbiedingsprijs)/.test(idLabel)) {
    const n = parseAmount(value)
    const raming = extracted.geraamde_waarde || tender.geraamde_waarde
    const r = raming ? parseAmount(String(raming)) : null
    if (n && r && r > 0 && n > r * 1.25) {
      return {
        field_id: field.id,
        field_label: field.label,
        severity: 'warn',
        message: `Bedrag (${value}) is >25% boven de geraamde waarde (${raming}). Mogelijk buiten marktprijs.`,
        conflict_source: 'geraamde waarde',
      }
    }
  }

  // Risico-tegenstrijdigheden: labelmatig zoeken
  if (risk?.tegenstrijdigheden?.length) {
    const needle = normalize(value).slice(0, 60)
    for (const t of risk.tegenstrijdigheden) {
      const nt = normalize(t)
      if (needle && nt.includes(needle) && needle.length > 10) {
        return {
          field_id: field.id,
          field_label: field.label,
          severity: 'warn',
          message: `Let op: dit komt overeen met een bekende tegenstrijdigheid uit de risico-analyse: "${t}"`,
          conflict_source: 'risico_analyse.tegenstrijdigheden',
        }
      }
    }
  }

  return null
}

export function persistContradiction(input: {
  tenderId: string
  documentNaam: string
  fieldId: string
  warning: AgentContradictionWarning | null
}): void {
  getDb()
    .prepare(
      `UPDATE agent_document_fills
       SET contradiction_flag = ?, contradiction_detail = ?, updated_at = datetime('now')
       WHERE tender_id = ? AND document_naam = ? AND field_id = ?`,
    )
    .run(
      input.warning ? 1 : 0,
      input.warning ? `${input.warning.severity.toUpperCase()}: ${input.warning.message}` : null,
      input.tenderId,
      input.documentNaam,
      input.fieldId,
    )
}

// ---------------------------------------------------------------------------
// Informatie-checklist (per document) — persistentie + CRUD
// ---------------------------------------------------------------------------

function rowToChecklistItem(r: Record<string, unknown>): AgentDocumentChecklistItem {
  return {
    tender_id: String(r.tender_id),
    document_naam: String(r.document_naam),
    item_id: String(r.item_id),
    label: String(r.label ?? ''),
    hint: typeof r.hint === 'string' && r.hint ? r.hint : undefined,
    source_quote: typeof r.source_quote === 'string' && r.source_quote ? r.source_quote : undefined,
    order: Number(r.item_order ?? 0),
    done: Number(r.done ?? 0) === 1,
    done_at: typeof r.done_at === 'string' && r.done_at ? r.done_at : undefined,
    updated_at: String(r.updated_at ?? ''),
  }
}

/** Alle checklist-items voor één document, gesorteerd op volgorde. */
export function listChecklistItems(
  tenderId: string,
  documentNaam: string,
): AgentDocumentChecklistItem[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM agent_document_checklists
       WHERE tender_id = ? AND document_naam = ?
       ORDER BY item_order ASC, item_id ASC`,
    )
    .all(tenderId, documentNaam) as Record<string, unknown>[]
  return rows.map(rowToChecklistItem)
}

/** Alle checklist-items van een tender (over alle documenten heen). */
export function listAllChecklistItemsForTender(tenderId: string): AgentDocumentChecklistItem[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM agent_document_checklists
       WHERE tender_id = ?
       ORDER BY document_naam ASC, item_order ASC, item_id ASC`,
    )
    .all(tenderId) as Record<string, unknown>[]
  return rows.map(rowToChecklistItem)
}

/**
 * Bewaar de LLM-opgehaalde checklist idempotent. Bestaande items met dezelfde
 * (tender, document, item_id) behouden hun `done`/`done_at`; nieuwe velden
 * worden toegevoegd. Metadata-velden (label, hint, quote, order) worden
 * bijgewerkt zodat latere prompt-verbeteringen automatisch doorwerken.
 */
export function persistChecklistItems(input: {
  tenderId: string
  documentNaam: string
  items: Array<{ id: string; label: string; hint?: string; order: number; sourceQuote: string }>
}): void {
  if (!input.items.length) return
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO agent_document_checklists
       (tender_id, document_naam, item_id, label, hint, source_quote, item_order, done, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
     ON CONFLICT(tender_id, document_naam, item_id) DO UPDATE SET
       label = excluded.label,
       hint = excluded.hint,
       source_quote = excluded.source_quote,
       item_order = excluded.item_order,
       updated_at = datetime('now')`,
  )
  const tx = db.transaction((rows: typeof input.items) => {
    for (const it of rows) {
      stmt.run(
        input.tenderId,
        input.documentNaam,
        it.id,
        it.label,
        it.hint ?? null,
        it.sourceQuote,
        it.order,
      )
    }
  })
  tx(input.items)
}

/** Vink een item af (of juist uit). Retourneert het bijgewerkte item. */
export function setChecklistItemDone(input: {
  tenderId: string
  documentNaam: string
  itemId: string
  done: boolean
}): AgentDocumentChecklistItem | null {
  const db = getDb()
  db.prepare(
    `UPDATE agent_document_checklists
     SET done = ?,
         done_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
         updated_at = datetime('now')
     WHERE tender_id = ? AND document_naam = ? AND item_id = ?`,
  ).run(
    input.done ? 1 : 0,
    input.done ? 1 : 0,
    input.tenderId,
    input.documentNaam,
    input.itemId,
  )
  const row = db
    .prepare(
      `SELECT * FROM agent_document_checklists
       WHERE tender_id = ? AND document_naam = ? AND item_id = ?`,
    )
    .get(input.tenderId, input.documentNaam, input.itemId) as Record<string, unknown> | undefined
  return row ? rowToChecklistItem(row) : null
}

// ---------------------------------------------------------------------------
// Wizardstappen
// ---------------------------------------------------------------------------

const MAX_FIELDS_PER_STEP = 6

export interface WizardStep {
  title: string
  fields: AgentFieldDefinition[]
}

/**
 * Pre-analyseert alle waarschijnlijk invulbare documenten van een aanbesteding.
 * Wordt aangeroepen direct ná de risico-analyse zodat de agent-wizard kan
 * openen zonder dat de gebruiker hoeft te wachten op veldextractie.
 *
 * - Gebruikt Claude Sonnet 4.5 (valt terug op hoofd-AI als er geen sleutel is).
 * - Slaat velden + initiële voorstellen op in `agent_document_fills`.
 * - Is idempotent: documenten waarvoor al velden in de DB staan worden overgeslagen.
 */
export async function preAnalyzeFillableDocuments(input: {
  tender: Aanbesteding
  onProgress?: (step: string, pct: number) => void
  /** Optioneel: minimaal percentage waar we vanaf starten (na risicoanalyse). */
  startPct?: number
  /** Optioneel: maximum percentage dat we bereiken tijdens deze fase. */
  endPct?: number
}): Promise<{
  analyzed: Array<{ documentNaam: string; fieldCount: number }>
  skipped: Array<{ documentNaam: string; reason: string }>
  failed: Array<{ documentNaam: string; error: string }>
}> {
  const { tender, onProgress } = input
  const startPct = input.startPct ?? 92
  const endPct = input.endPct ?? 99

  const analyzed: Array<{ documentNaam: string; fieldCount: number }> = []
  const skipped: Array<{ documentNaam: string; reason: string }> = []
  const failed: Array<{ documentNaam: string; error: string }> = []

  let documents: StoredDocumentEntry[] = []
  try {
    documents = JSON.parse(tender.document_urls || '[]') as StoredDocumentEntry[]
  } catch {
    log.warn('[doc-fill-engine] pre-analyse: document_urls niet parseerbaar')
    return { analyzed, skipped, failed }
  }

  const withLocal = documents.filter((d) => Boolean(d.localNaam?.trim()))
  const fillables: StoredDocumentEntry[] = []
  for (const d of withLocal) {
    const naam = d.naam || d.localNaam || ''
    if (isFillableCatalogEntry(naam, d.type)) {
      fillables.push(d)
      continue
    }
    if (
      isWordProcessorExtension(naam, d.type) &&
      documentTextSuggestsFillableFields(await readDocumentFullText(tender.id, d))
    ) {
      fillables.push(d)
    }
  }
  if (fillables.length === 0) {
    log.info('[doc-fill-engine] pre-analyse: geen invulbare documenten gevonden')
    onProgress?.('Geen invulbare documenten aangetroffen — pre-analyse overgeslagen', endPct)
    return { analyzed, skipped, failed }
  }

  log.info(
    `[doc-fill-engine] pre-analyse: ${fillables.length} invulbare document(en) gevonden voor tender ${tender.id}`,
  )
  onProgress?.(
    `Agent pre-analyse: ${fillables.length} invulbaar(e) document(en) met ${AGENT_FIELD_EXTRACTION_MODEL}…`,
    startPct,
  )

  const span = Math.max(1, endPct - startPct)
  for (let i = 0; i < fillables.length; i++) {
    const doc = fillables[i]
    const docNaam = doc.naam || doc.localNaam || `document-${i + 1}`
    const pct = startPct + Math.round(((i + 1) / fillables.length) * span)

    if (
      hasCachedFieldDefinitions(tender.id, docNaam) &&
      hasCachedChecklist(tender.id, docNaam)
    ) {
      skipped.push({ documentNaam: docNaam, reason: 'velden en checklist staan al in de cache' })
      onProgress?.(`Agent pre-analyse: ${docNaam} al geanalyseerd — overgeslagen`, pct)
      continue
    }

    onProgress?.(
      `Agent pre-analyse: "${docNaam}" (${i + 1}/${fillables.length}) met ${AGENT_FIELD_EXTRACTION_MODEL}…`,
      pct,
    )

    try {
      // Documenttekst één keer inlezen en delen met beide LLM-stappen.
      const fullText = await readDocumentFullText(tender.id, doc)

      let fieldCount = 0
      if (!hasCachedFieldDefinitions(tender.id, docNaam)) {
        const { fields, fieldQuotes } = await analyzeDocumentForFields({
          tenderId: tender.id,
          document: doc,
          useClaudeSonnet45: true,
          fullText,
        })
        if (fields.length > 0) {
          persistFieldDefinitions({
            tenderId: tender.id,
            documentNaam: docNaam,
            fields,
            fieldQuotes,
          })
          const proposals = generateFillProposals({
            tender,
            documentNaam: docNaam,
            fields,
          })
          applyProposalsIfEmpty({
            tenderId: tender.id,
            documentNaam: docNaam,
            proposals,
          })
          fieldCount = fields.length
        }
      }

      // Checklist (te verzamelen informatie) — idempotent via hasCachedChecklist.
      let checklistCount = 0
      if (!hasCachedChecklist(tender.id, docNaam)) {
        const items = await analyzeDocumentForInfoChecklist({
          tenderId: tender.id,
          document: doc,
          useClaudeSonnet45: true,
          fullText,
        })
        if (items.length > 0) {
          persistChecklistItems({
            tenderId: tender.id,
            documentNaam: docNaam,
            items,
          })
          checklistCount = items.length
        }
      }

      if (fieldCount === 0 && checklistCount === 0) {
        skipped.push({ documentNaam: docNaam, reason: 'geen invulvelden of checklist-items herkend' })
        continue
      }

      analyzed.push({ documentNaam: docNaam, fieldCount })
      log.info(
        `[doc-fill-engine] pre-analyse OK — ${docNaam}: ${fieldCount} velden, ${checklistCount} checklist-items`,
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.warn(`[doc-fill-engine] pre-analyse mislukt voor ${docNaam}: ${msg}`)
      failed.push({ documentNaam: docNaam, error: msg })
    }
  }

  onProgress?.(
    `Agent pre-analyse klaar: ${analyzed.length} geanalyseerd, ${skipped.length} overgeslagen, ${failed.length} mislukt`,
    endPct,
  )
  return { analyzed, skipped, failed }
}

/**
 * Idempotente wrapper rond `preAnalyzeFillableDocuments` die vanuit de hoofd-
 * AI-analyse en de risico-pipeline wordt aangeroepen. Faalt stil en logt bij
 * problemen, zodat de hoofd-analyse niet wordt geblokkeerd als de pre-analyse
 * (bv. AI-key niet meer geldig) misgaat.
 */
export async function ensurePreAnalyzeFillableDocuments(
  tenderId: string,
  opts?: { onProgress?: (step: string, pct: number) => void; startPct?: number; endPct?: number },
): Promise<void> {
  try {
    const tender = getDb()
      .prepare('SELECT * FROM aanbestedingen WHERE id = ?')
      .get(tenderId) as Aanbesteding | undefined
    if (!tender) return
    await preAnalyzeFillableDocuments({
      tender,
      onProgress: opts?.onProgress,
      startPct: opts?.startPct,
      endPct: opts?.endPct,
    })
  } catch (e) {
    log.warn(
      `[doc-fill-engine] ensurePreAnalyzeFillableDocuments (${tenderId}) mislukt:`,
      e instanceof Error ? e.message : String(e),
    )
  }
}

export function buildWizardSteps(fields: AgentFieldDefinition[]): WizardStep[] {
  const groups = new Map<string, AgentFieldDefinition[]>()
  for (const f of fields) {
    const g = f.group || 'Algemeen'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(f)
  }
  const steps: WizardStep[] = []
  for (const [title, list] of groups) {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    for (let i = 0; i < list.length; i += MAX_FIELDS_PER_STEP) {
      const chunk = list.slice(i, i + MAX_FIELDS_PER_STEP)
      steps.push({
        title:
          list.length > MAX_FIELDS_PER_STEP
            ? `${title} (${Math.floor(i / MAX_FIELDS_PER_STEP) + 1})`
            : title,
        fields: chunk,
      })
    }
  }
  return steps
}
