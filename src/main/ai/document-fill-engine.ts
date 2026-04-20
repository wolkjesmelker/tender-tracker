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
  AgentContradictionWarning,
  AiExtractedTenderFields,
  RisicoAnalyseResult,
  StoredDocumentEntry,
} from '../../shared/types'
import { lookupLearnedAnswer } from './agent-learning'
import { isFillableDocumentName } from '../../shared/fillable-document'

export { isFillableDocumentName }

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
  const rows = getDb()
    .prepare(
      `SELECT document_naam,
              COUNT(*) AS total,
              SUM(CASE WHEN status IN ('filled','approved') THEN 1 ELSE 0 END) AS filled,
              SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partial,
              SUM(CASE WHEN contradiction_flag = 1 THEN 1 ELSE 0 END) AS contradictions
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
  }>

  return rows.map((r) => {
    const total = Number(r.total || 0)
    const filled = Number(r.filled || 0)
    const partial = Number(r.partial || 0)
    const contradictions = Number(r.contradictions || 0)
    const pct = total > 0 ? Math.round((filled / total) * 100) : 0
    let status: AgentDocumentFillSummary['status']
    if (contradictions > 0) status = 'contradiction'
    else if (filled === 0 && partial === 0) status = 'not_started'
    else if (filled >= total) status = 'complete'
    else status = 'partial'
    return {
      document_naam: r.document_naam,
      total_fields: total,
      filled_fields: filled,
      partial_fields: partial,
      contradictions,
      status,
      percentage: pct,
    }
  })
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

const DOCUMENT_FIELD_EXTRACTION_PROMPT = `Je bent een expert aanbestedingsjurist en invulassistent. Je analyseert een aanbestedingsdocument
en levert een gestructureerde, UITPUTTENDE lijst van VELDEN die een inschrijver moet invullen.
Denk aan: bedrijfsnaam, KvK, BTW, adres, contactpersoon, projectnaam, referentienummer,
inschrijfsom, prijscomponenten, uitvoeringstermijn, start-/einddatum, akkoordverklaringen,
garanties, certificaten, ondertekening (naam, functie, datum, plaats), etc.

BELANGRIJK:
- Splits elke invulregel in een aparte "field".
- Ken een zinnig veldtype toe: text | textarea | date | amount | number | choice | multichoice | boolean.
- Voor "choice"/"multichoice": vul "options" (value + label).
- "required": true als het document het veld verplicht stelt.
- "group": logische categorie (bv. "Bedrijfsgegevens", "Prijs", "Uitvoering", "Akkoord", "Ondertekening").
- Vermijd dubbele velden; vat samen als ze semantisch hetzelfde zijn.

Retourneer UITSLUITEND geldige JSON in dit schema:
{
  "document_type_hint": string,   // bv. "eigen-verklaring", "inschrijfformulier", "bestek-akkoord"
  "fields": [
    {
      "id": string,               // kort, stabiel, alleen a-z 0-9 en '-' ; bv. "bedrijfsnaam"
      "label": string,
      "type": "text"|"textarea"|"date"|"amount"|"number"|"choice"|"multichoice"|"boolean",
      "required": boolean,
      "description": string|null,
      "options": [{"value": string, "label": string}]|null,
      "group": string|null,
      "order": number
    }
  ]
}

Geen markdown, geen uitleg eromheen.`

export async function analyzeDocumentForFields(input: {
  tenderId: string
  document: StoredDocumentEntry
  /** Forceer Claude Sonnet 4.5 (standaard tijdens risico-analyse). Valt
   *  automatisch terug op `aiService` als geen Claude-sleutel beschikbaar is. */
  useClaudeSonnet45?: boolean
}): Promise<{ fields: AgentFieldDefinition[]; documentTypeHint: string }> {
  const { tenderId, document } = input
  const logicalName = document.naam

  let fullText = ''
  if (document.localNaam) {
    try {
      fullText = await readLocalDocumentAndExtractText(tenderId, document.localNaam, logicalName)
    } catch (e) {
      log.warn('[doc-fill-engine] kon document niet lezen:', e)
    }
  }
  if (!fullText || fullText.length < 40) {
    // Fallback: lege lijst met 1 generiek handmatig veld
    return {
      documentTypeHint: 'overig',
      fields: [],
    }
  }

  const truncated = fullText.length > 120_000 ? fullText.slice(0, 120_000) : fullText
  const userMsg = `Documentnaam: ${logicalName}\n\nDocumenttekst (maximaal ${truncated.length.toLocaleString()} tekens):\n${truncated}`

  let raw = ''
  const preferClaude = input.useClaudeSonnet45 ?? false
  if (preferClaude && loadClaudeApiKey()) {
    try {
      raw = await callClaudeSonnet45([
        { role: 'system', content: DOCUMENT_FIELD_EXTRACTION_PROMPT },
        { role: 'user', content: userMsg },
      ])
    } catch (e) {
      log.warn(
        `[doc-fill-engine] ${AGENT_FIELD_EXTRACTION_MODEL} mislukt, val terug op hoofd-AI:`,
        e instanceof Error ? e.message : String(e),
      )
    }
  }
  if (!raw) {
    raw = await aiService.chat(
      [
        { role: 'system', content: DOCUMENT_FIELD_EXTRACTION_PROMPT },
        { role: 'user', content: userMsg },
      ],
      { preferJsonOutput: true },
    )
  }

  const parsed = parseAnalysisJsonResponse(raw).parsed as
    | { document_type_hint?: string; fields?: unknown[] }
    | null
  if (!parsed || !Array.isArray(parsed.fields)) {
    log.warn('[doc-fill-engine] LLM gaf geen geldige velden-JSON.')
    return { documentTypeHint: 'overig', fields: [] }
  }

  const seen = new Set<string>()
  const fields: AgentFieldDefinition[] = []
  for (const raw of parsed.fields as Record<string, unknown>[]) {
    let id = String(raw.id ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!id) id = `veld-${safeRandomId()}`
    if (seen.has(id)) id = `${id}-${safeRandomId()}`
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
  }

  return {
    documentTypeHint: String(parsed.document_type_hint ?? 'overig'),
    fields,
  }
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
}): void {
  const db = getDb()
  const insert = db.prepare(
    `INSERT INTO agent_document_fills
       (tender_id, document_naam, field_id, field_label, field_type,
        field_options_json, field_required, field_description, field_order, field_group,
        value_text, status, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'empty', 'ai', datetime('now'))
     ON CONFLICT(tender_id, document_naam, field_id) DO UPDATE SET
       field_label = excluded.field_label,
       field_type = excluded.field_type,
       field_options_json = excluded.field_options_json,
       field_required = excluded.field_required,
       field_description = excluded.field_description,
       field_order = excluded.field_order,
       field_group = excluded.field_group,
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

  db.prepare(
    `UPDATE agent_document_fills
     SET value_text = ?, status = ?, source = ?, contradiction_flag = 0, contradiction_detail = NULL,
         updated_at = datetime('now')
     WHERE tender_id = ? AND document_naam = ? AND field_id = ?`,
  ).run(trimmed, status, input.source, input.tenderId, input.documentNaam, input.fieldId)

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

  const fillables = documents.filter(
    (d) => d.localNaam && isFillableDocumentName(d.naam || d.localNaam || '', d.type),
  )
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

    if (hasCachedFieldDefinitions(tender.id, docNaam)) {
      skipped.push({ documentNaam: docNaam, reason: 'velden staan al in de cache' })
      onProgress?.(`Agent pre-analyse: ${docNaam} al geanalyseerd — overgeslagen`, pct)
      continue
    }

    onProgress?.(
      `Agent pre-analyse: "${docNaam}" (${i + 1}/${fillables.length}) met ${AGENT_FIELD_EXTRACTION_MODEL}…`,
      pct,
    )

    try {
      const { fields } = await analyzeDocumentForFields({
        tenderId: tender.id,
        document: doc,
        useClaudeSonnet45: true,
      })
      if (fields.length === 0) {
        skipped.push({ documentNaam: docNaam, reason: 'geen invulvelden herkend' })
        continue
      }
      persistFieldDefinitions({
        tenderId: tender.id,
        documentNaam: docNaam,
        fields,
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
      analyzed.push({ documentNaam: docNaam, fieldCount: fields.length })
      log.info(
        `[doc-fill-engine] pre-analyse OK — ${docNaam}: ${fields.length} velden, ${proposals.length} voorstellen`,
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
