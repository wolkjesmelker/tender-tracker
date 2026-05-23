import log from 'electron-log'
import { getDb } from '../db/connection'
import { aiService } from './ai-service'
import { fetchRisicoWetgevingsContext } from './risico-wetgevings-context'
import { parseAnalysisJsonResponse } from './parse-ai-json'
import {
  listAllFillStatesForTender,
  listAllChecklistItemsForTender,
  getFillSummaryForTender,
  saveFillValue,
  checkContradictionForField,
  persistContradiction,
} from './document-fill-engine'
import { searchWeb, addManualWebSearchToTender, listPinnedNotes } from './web-search'
import { enqueueIncrementalManualDocumentAnalysis } from '../ipc/analysis.ipc'
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
import { getTenderDateSnapshot, formatTenderDateSnapshotLine } from '../../shared/tender-date-snapshot'

// ---------------------------------------------------------------------------
// Systeemprompt: expert aanbestedingswetgeving, direct en zakelijk
// ---------------------------------------------------------------------------

const AGENT_BASE_PROMPT = `Je bent een senior aanbestedingsspecialist (Nederlandse + EU-aanbestedingsrecht) en
juridisch adviseur. Je kent Aanbestedingswet 2012, Gids Proportionaliteit, ARW 2016,
UAV 2012/UAV-GC 2005, AVG en de relevante EU-richtlijnen (2014/24/EU, 2014/25/EU).

REIKWIJDTE (verplicht)
- Je antwoordt op vragen over de aanbestedingen die in deze applicatie in de lijst staan (zie blok PORTFOLIO_OVERZICHT).
- Ook vragen waarin de gebruiker een andere tender uit die lijst noemt (titel, opdrachtgever, referentie) behoren tot jouw taken: gebruik het overzicht om de juiste aanbesteding te koppelen en wees expliciet welke tender je bedoelt (ID/titel).
- Als er géén actieve tender-context is (alleen portfolio): geef algemene antwoorden op basis van het overzicht en vraag zo nodig om op de detailpagina van een specifieke aanbesteding verder te gaan voor documentinhoud.
- Wanneer wél een actieve tender is meegegeven: die tender is de primaire focus, maar je mag die vergelijken met of afzetten tegen andere items uit het portfolio als de gebruiker dat vraagt.

DATUMS (verplicht kennen en correct gebruiken)
- Voor elke tender onderscheid je scherp:
  • Start inschrijving — meestal publicatiedatum / start aanmeldperiode.
  • Einde inschrijving — sluitingsdatum / uiterste datum indiening (ook wel “deadline”).
  • Start en einde uitvoering / contractperiode — uit AI-geëxtraheerde velden of procedure/tijdlijn, indien aanwezig.
- Gebruik de waarden uit de context (PORTFOLIO en/of DETAIL). Bij twijfel tussen bronnen: noem beide waarden en wat de voorkeursbron is (bijv. sluitingsdatum in DB vs. TNS-API).
- Datums in antwoorden als DD-MM-JJJJ waar mogelijk; anders exact zoals in de data staat.

GEDOWNLOADE DOCUMENTEN (verplicht)
- De documentenlijst per tender toont welke bestanden lokaal op schijf staan (gemarkeerd als “lokaal” / localNaam).
- Voor inhoud van zo’n bestand: gebruik read_document met de exacte bestandsnaam uit de lijst (naam of localNaam).
- Zonder lokale kopie kun je geen volledige tekst uitlezen: zeg dan dat het bestand nog niet is gedownload en verwijs naar de bron-URL of documentenlijst.
- search_documents helpt bij snelle treffers in beschrijving, ruwe tekst en samenvatting; voor diep antwoord op PDF/Word/ZIP-inhoud: read_document.

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
- read_document(document_naam: string) — Lees geëxtraheerde tekst van een lokaal gedownload document van de actieve tender (argument = naam zoals in de documentenlijst).
- web_search(query: string, count?: number) — Zoek op het internet; resultaten worden je getoond, de gebruiker beslist of ze worden toegevoegd aan het dossier.
- pin_search_result(url: string, summary: string, query?: string) — Voeg een gevonden internetresultaat toe aan het dossier (alleen na instemming gebruiker).
- get_fill_state(document_naam?: string) — Haal huidige invulstatus op van één of alle documenten (actieve tender).
- save_fill_value(document_naam, field_id, value) — Sla een veldwaarde op (alleen met instemming gebruiker).
- flag_contradiction(document_naam, field_id, severity, message) — Markeer veld als tegenstrijdig.
- search_documents(query: string) — Snel zoeken in beschrijving, ruwe tekst, samenvatting én documentnamen van de actieve tender.

INVUL- EN CHECKLIST-DATA (verplichte werkwijze)
- Het blok NOG TE VULLEN / VERZAMELEN PER DOCUMENT bevat alle openstaande
  verplichte velden en onafgevinkte checklist-items per document. Gebruik
  uitsluitend dit blok (plus read_document bij twijfel) om te zeggen wat
  er nog ontbreekt.
- Verzin GEEN extra verplichtingen, stukken of velden die niet in dit
  blok (of in de bron zelf via read_document) staan. Als iets niet in de
  data zit, zeg dat expliciet in plaats van het aan te vullen uit
  algemene kennis.

ANTWOORDDISCIPLINE
- Zonder tool: geef een bondig zakelijk antwoord (max. ~6 regels tenzij gebruiker om detail vraagt).
- Bij invullen: stel per veld één heldere vraag, of geef meerdere vragen per stap in een wizardstijl.
- Markeer onzekerheden met [?].
- Bedragen Nederlands genoteerd (€ 1.234.567,89). Datums als DD-MM-JJJJ.`

const PORTFOLIO_MAX_ROWS = 120

/** Compact overzicht van alle niet-gearchiveerde aanbestedingen (zelfde scope als de standaard lijst). */
function buildPortfolioOverviewBlock(): string {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, titel, opdrachtgever, referentienummer, status, document_urls, ai_extracted_fields, tender_procedure_context,
              publicatiedatum, sluitingsdatum
       FROM aanbestedingen
       WHERE status != 'gearchiveerd'
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
    )
    .all(PORTFOLIO_MAX_ROWS) as Aanbesteding[]

  if (!rows.length) {
    return 'PORTFOLIO_OVERZICHT:\n(geen actieve aanbestedingen in de lijst)'
  }
  const lines = rows.map((r) => {
    let nLocal = 0
    let nTot = 0
    try {
      if (r.document_urls) {
        const arr = JSON.parse(r.document_urls) as StoredDocumentEntry[]
        if (Array.isArray(arr)) {
          nTot = arr.length
          nLocal = arr.filter((d) => Boolean(d.localNaam?.trim())).length
        }
      }
    } catch {
      /* ignore */
    }
    const dateLine = formatTenderDateSnapshotLine(r)
    const titelShort = r.titel.length > 72 ? `${r.titel.slice(0, 69)}…` : r.titel
    return `- [${r.id}] ${titelShort} | OG: ${r.opdrachtgever || '-'} | ref: ${r.referentienummer || '-'} | ${dateLine} | documenten ${nLocal}/${nTot} lokaal`
  })
  return `PORTFOLIO_OVERZICHT (${rows.length} aanbesteding(en) in lijst; sluit gearchiveerde uit):\n${lines.join('\n')}`
}

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

  const snap = getTenderDateSnapshot(tender)
  const blocks: string[] = []
  blocks.push(
    `ACTIEVE_AANBESTEDING (detail — combineer met PORTFOLIO_OVERZICHT voor vergelijkingen):
- ID: ${tender.id}
- Titel: ${tender.titel}
- Opdrachtgever: ${extracted.opdrachtgever || tender.opdrachtgever || '-'}
- Referentienummer: ${extracted.referentienummer || tender.referentienummer || '-'}
DATUMS (start/einde inschrijving + uitvoering; opgebouwd uit publicatie/sluiting/API/AI-extractie):
- Start inschrijving / publicatie: ${snap.startInschrijvingRaw || tender.publicatiedatum || extracted.publicatiedatum || '-'}
- Einde inschrijving / sluiting: ${snap.endInschrijvingRaw || extracted.sluitingsdatum_inschrijving || tender.sluitingsdatum || '-'}
- Start uitvoering: ${snap.startUitvoeringRaw || extracted.datum_start_uitvoering || '-'}
- Einde uitvoering: ${snap.endUitvoeringRaw || extracted.datum_einde_uitvoering || '-'}
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
    const localCount = documents.filter((d) => Boolean(d.localNaam?.trim())).length
    const lines = documents
      .slice(0, 50)
      .map(
        (d) =>
          `- ${d.naam}${d.localNaam ? ' (lokaal — read_document mogelijk)' : ' (nog niet lokaal)'}${d.type ? ` [${d.type}]` : ''}`,
      )
    blocks.push(
      `DOCUMENTEN (${localCount} lokaal gedownload van ${documents.length} in catalogus; read_document alleen bij «lokaal»):\n${lines.join('\n')}`,
    )
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
    const lines = fillSummary.map((s) => {
      const fields = s.total_fields > 0
        ? `${s.required_filled}/${s.required_total || s.total_fields} verplicht ingevuld`
        : 'geen herkende formuliervelden'
      const checklist = s.checklist_total > 0
        ? `; checklist ${s.checklist_done}/${s.checklist_total}`
        : ''
      const started = s.user_started ? '' : ' (nog niet gestart door gebruiker)'
      const pct = s.user_started && s.total_fields > 0 ? ` — ${s.percentage}%` : ''
      const contra = s.contradictions > 0 ? ` · ${s.contradictions} tegenstrijdigheid(en)` : ''
      return `- ${s.document_naam}: ${fields}${checklist}${pct}${started}${contra}`
    })
    blocks.push(`INVULSTATUS:\n${lines.join('\n')}`)
  }

  // Per document: concrete openstaande verplichte velden (labels) + nog te
  // verzamelen checklist-items, zodat de agent direct kan antwoorden op
  // vragen als "wat ontbreekt er nog voor document X?".
  const allFillStates = listAllFillStatesForTender(tender.id)
  const allChecklist = listAllChecklistItemsForTender(tender.id)
  if (allFillStates.length || allChecklist.length) {
    const docs = new Map<
      string,
      { openRequired: string[]; pendingChecklist: string[] }
    >()
    const ensure = (doc: string) => {
      let e = docs.get(doc)
      if (!e) {
        e = { openRequired: [], pendingChecklist: [] }
        docs.set(doc, e)
      }
      return e
    }
    for (const st of allFillStates) {
      if (!st.field_required) continue
      const hasValue = !!(st.value_text && st.value_text.trim())
      const isConfirmed = st.status === 'filled' || st.status === 'approved' || st.user_touched === true
      if (hasValue && isConfirmed) continue
      ensure(st.document_naam).openRequired.push(st.field_label || st.field_id)
    }
    for (const it of allChecklist) {
      if (it.done) continue
      ensure(it.document_naam).pendingChecklist.push(it.label)
    }
    const sections: string[] = []
    // Stabiele, leesbare volgorde: alfabetisch per document.
    const docNames = Array.from(docs.keys()).sort((a, b) => a.localeCompare(b, 'nl'))
    for (const doc of docNames) {
      const entry = docs.get(doc)!
      const parts: string[] = []
      if (entry.openRequired.length) {
        parts.push(
          `  Openstaande verplichte velden: ${entry.openRequired.slice(0, 20).join(' · ')}${
            entry.openRequired.length > 20 ? ` (+${entry.openRequired.length - 20} meer)` : ''
          }`,
        )
      }
      if (entry.pendingChecklist.length) {
        parts.push(
          `  Nog te verzamelen: ${entry.pendingChecklist.slice(0, 20).join(' · ')}${
            entry.pendingChecklist.length > 20 ? ` (+${entry.pendingChecklist.length - 20} meer)` : ''
          }`,
        )
      }
      if (parts.length) sections.push(`- ${doc}\n${parts.join('\n')}`)
    }
    if (sections.length) {
      blocks.push(
        `NOG TE VULLEN / VERZAMELEN PER DOCUMENT (door de inschrijver):\n${sections.join('\n')}`,
      )
    }
  }
  const pinned = listPinnedNotes(tender.id)
  if (pinned.length) {
    const lines = pinned.slice(0, 8).map((p) => {
      const k = p.entry_kind === 'doc_ref' ? 'document' : 'aantekening'
      const manual = p.is_manual_search ? ' [handmatige opzoekactie]' : ''
      return `- [${k}]${manual} ${p.summary}${p.source_url ? ` (bron: ${p.source_url})` : ''}`
    })
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
        const query = typeof args.query === 'string' ? args.query : undefined
        const title = String(args.title || '').trim()
        const snippet = String(args.snippet || '').trim()
        const summary = String(args.summary || '')
        const useTitle = title || (summary ? summary.split(/\s+—\s+/)[0]?.trim() : '') || summary.slice(0, 200)
        const useSnippet = snippet || (summary.includes('—') ? summary.split(/\s+—\s+/).slice(1).join(' — ') : summary)
        if (!useTitle && !useSnippet && !url) return 'Geen gegevens om vast te pinnen.'
        const res = addManualWebSearchToTender({
          tenderId: ctx.tenderId,
          title: useTitle || url || 'Zoekresultaat',
          url,
          snippet: useSnippet,
          searchQuery: query,
          kind: 'auto',
        })
        if (!res.ok) return res.error
        enqueueIncrementalManualDocumentAnalysis(ctx.tenderId, [res.textFileName])
        return 'Toegevoegd als handmatige opzoekactie (inclusief tekstexport).'
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
        let catalog: StoredDocumentEntry[] = []
        try {
          catalog = JSON.parse(ctx.tender.document_urls || '[]') as StoredDocumentEntry[]
          if (!Array.isArray(catalog)) catalog = []
        } catch {
          catalog = []
        }
        for (const d of catalog) {
          const naam = (d.naam || '').toLowerCase()
          const loc = (d.localNaam || '').toLowerCase()
          if (naam.includes(q) || loc.includes(q)) {
            hits.push({
              doc: `bestand:${d.naam}`,
              snippet: d.localNaam
                ? 'Naam match — lokaal; gebruik read_document voor inhoud.'
                : 'Naam match — nog niet lokaal; inhoud niet via read_document.',
            })
          }
        }
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
        return JSON.stringify(hits.slice(0, 14))
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
  parts.push(buildPortfolioOverviewBlock())
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
