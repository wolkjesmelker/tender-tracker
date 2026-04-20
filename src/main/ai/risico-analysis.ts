import type { RisicoAnalyseResult } from '../../shared/types'
import { logTokenUsage, normalizeUsageFromApiBody } from './token-logger'
import log from 'electron-log'
import { getDb } from '../db/connection'
import { APP_SETTING_RISICO_PROMPT_EXTRACTIE, APP_SETTING_RISICO_PROMPT_HOOFD } from '../../shared/constants'
import {
  DEFAULT_RISICO_EXTRACTIE_PROMPT,
  DEFAULT_RISICO_HOOFD_PROMPT,
  DEFAULT_RISICO_MERGE_PROMPT,
} from './risico-prompt-defaults'
import { fetchRisicoWetgevingsContext } from './risico-wetgevings-context'
import { LLM_CHUNK_EXTRACTION_CONCURRENCY, runBatchedParallel } from '../utils/llm-chunk-concurrency'
import {
  fetchWithRetry,
  formatFetchFailure,
  readResponseJsonWithTimeout,
  type FetchWithRetryOptions,
} from '../utils/http-resilience'

// ---------------------------------------------------------------------------
// Configuratie
// ---------------------------------------------------------------------------

/** Max tekens per chunk in de extractiepas. ~280K tekens ≈ ~70K tokens. */
const CHUNK_CHARS = 280_000

/** Als de totale input hier onder zit, probeer eerst een directe single-pass. */
const SINGLE_PASS_MAX_CHARS = 340_000

const MOONSHOT_BASE = 'https://api.moonshot.cn/v1'
const RISICO_MODEL = 'kimi-k2.6'

/** Voortgang naar renderer (risico-IPC / activiteitenpaneel). */
export type RisicoProgressReporter = (step: string, percentage: number) => void

/** Tijdens een lang modelantwoord periodiek de staptekst verversen (seconden). */
function withRisicoModelWait(
  onProgress: RisicoProgressReporter | undefined,
  label: string,
  percentage: number,
  run: () => Promise<string>,
): Promise<string> {
  if (!onProgress) return run()
  const t0 = Date.now()
  const tick = () => {
    const sec = Math.floor((Date.now() - t0) / 1000)
    onProgress(`${label} — wacht op antwoord ${sec}s…`, percentage)
  }
  const first = setTimeout(tick, 8_000)
  const iv = setInterval(tick, 15_000)
  return run().finally(() => {
    clearTimeout(first)
    clearInterval(iv)
  })
}

// ---------------------------------------------------------------------------
// Kimi REST-provider (geen aiService dependency — los van hoofd-provider)
// ---------------------------------------------------------------------------

interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }

export type RisicoChatPhase = 'extract' | 'merge' | 'final' | 'single'

export type RisicoChatFn = (
  messages: ChatMsg[],
  meta?: { phase: RisicoChatPhase },
) => Promise<string>

function kimiFetchOptionsForPhase(phase: RisicoChatPhase): FetchWithRetryOptions {
  // Strak geconfigureerd (2026-04-19) zodat een trage/haperende Moonshot-call
  // snel richting hoofd-AI fallback gaat i.p.v. de hele run te blokkeren.
  if (phase === 'merge') {
    return { maxAttempts: 2, baseDelayMs: 1200, maxDelayMs: 6_000, timeoutPerAttemptMs: 90_000 }
  }
  if (phase === 'extract') {
    return { maxAttempts: 3, baseDelayMs: 1200, maxDelayMs: 8_000, timeoutPerAttemptMs: 120_000 }
  }
  // 'single' en 'final' delen hetzelfde budget: grote response mag wat langer.
  return { maxAttempts: 3, baseDelayMs: 1500, maxDelayMs: 10_000, timeoutPerAttemptMs: 240_000 }
}

async function kimiChat(
  apiKey: string,
  baseUrl: string,
  messages: ChatMsg[],
  fetchOpts: FetchWithRetryOptions,
): Promise<string> {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  const body = {
    model: RISICO_MODEL,
    messages,
    max_tokens: 16384,
    response_format: { type: 'json_object' },
  }
  const bodyTimeoutMs = fetchOpts.timeoutPerAttemptMs ?? 600_000
  const inputChars = messages.reduce(
    (n, m) => n + (typeof m.content === 'string' ? m.content.length : 0),
    0,
  )
  log.info(
    `[risico] Kimi POST chat/completions — ~${Math.round(inputChars / 1000)}k tekens in berichten, body-timeout ${Math.round(bodyTimeoutMs / 1000)}s`,
  )
  let response: Response
  try {
    response = await fetchWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      fetchOpts,
    )
  } catch (e) {
    throw formatFetchFailure(e, 'Kimi (Moonshot) API niet bereikbaar', endpoint)
  }
  if (!response.ok) {
    const errMs = Math.min(bodyTimeoutMs, 120_000)
    const errText = await Promise.race([
      response.text(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('timeout foutbody')), errMs),
      ),
    ]).catch(() => '(fouttekst niet leesbaar of timeout)')
    throw new Error(`Kimi API fout ${response.status}: ${String(errText).slice(0, 500)}`)
  }
  log.info('[risico] Kimi: HTTP OK — antwoord-body binnenhalen (kan lang duren bij grote dossiers)…')
  const data = (await readResponseJsonWithTimeout(
    response,
    bodyTimeoutMs,
    'Kimi (Moonshot) JSON-antwoord',
  )) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const { input, output } = normalizeUsageFromApiBody(data)
  logTokenUsage('Kimi (Moonshot)', RISICO_MODEL, input, output)
  const content = data.choices?.[0]?.message?.content ?? ''
  log.info(`[risico] Kimi: antwoord ontvangen (${content.length} tekens in message.content)`)
  return content
}

/** Fallback: gebruik de geconfigureerde hoofd-AI (importeer lazily om circular deps te vermijden). */
async function fallbackChat(messages: ChatMsg[]): Promise<string> {
  const { aiService } = await import('./ai-service')
  return aiService.chat(messages, { preferJsonOutput: true })
}

const MAIN_AI_RETRY_DELAYS_MS = [0, 3500, 14_000]

async function resilientMainAiChat(messages: ChatMsg[]): Promise<string> {
  let last: unknown
  for (let i = 0; i < MAIN_AI_RETRY_DELAYS_MS.length; i++) {
    const d = MAIN_AI_RETRY_DELAYS_MS[i]
    if (d > 0) await new Promise((r) => setTimeout(r, d))
    try {
      return await fallbackChat(messages)
    } catch (e) {
      last = e
      if (i < MAIN_AI_RETRY_DELAYS_MS.length - 1) {
        log.warn('[risico] Hoofd-AI-call tijdelijk mislukt, nieuwe poging…', e instanceof Error ? e.message : e)
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

/**
 * Kimi eerst (indien sleutel), met automatische fallback naar hoofd-AI bij netwerk-/API-fouten
 * zodat chunked extractie niet op `fetch failed` stukloopt.
 */
function buildRisicoChatFn(
  useKimi: boolean,
  moonshotApiKey: string | undefined,
  baseUrl: string,
): RisicoChatFn {
  return async (messages, meta) => {
    const phase = meta?.phase ?? 'final'
    const sysLen = messages[0]?.content?.length ?? 0
    const userLen = messages[messages.length - 1]?.content?.length ?? 0
    log.info(`[risico] LLM-call phase=${phase} systemChars=${sysLen} userChars=${userLen}`)
    if (useKimi && moonshotApiKey) {
      try {
        return await kimiChat(moonshotApiKey, baseUrl, messages, kimiFetchOptionsForPhase(phase))
      } catch (e) {
        log.warn(
          '[risico] Kimi (Moonshot) faalde na retries — zelfde prompt via hoofd-AI:',
          e instanceof Error ? e.message : e,
        )
        return resilientMainAiChat(messages)
      }
    }
    return resilientMainAiChat(messages)
  }
}

// ---------------------------------------------------------------------------
// Prompts (instelbaar via Instellingen → tab Prompts; fallback: defaults)
// ---------------------------------------------------------------------------

function loadRisicoHoofdPromptFromDb(): string {
  try {
    const row = getDb()
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(APP_SETTING_RISICO_PROMPT_HOOFD) as { value: string } | undefined
    if (row?.value != null && String(row.value).trim() !== '') return String(row.value)
  } catch {
    /* DB nog niet klaar */
  }
  return DEFAULT_RISICO_HOOFD_PROMPT
}

function loadRisicoExtractiePromptFromDb(): string {
  try {
    const row = getDb()
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(APP_SETTING_RISICO_PROMPT_EXTRACTIE) as { value: string } | undefined
    if (row?.value != null && String(row.value).trim() !== '') return String(row.value)
  } catch {
    /* DB nog niet klaar */
  }
  return DEFAULT_RISICO_EXTRACTIE_PROMPT
}

/** Synthesepas: zelfde JSON-einde als hoofdprompt (vanaf RETOURNEER…). */
function buildSyntheseSystemPrompt(mainHoofd: string): string {
  const header = `Je bent een gespecialiseerd aanbestedingsjurist. Je krijgt bevindingen uit meerdere documentdelen van dezelfde aanbesteding. Combineer en dedupliceer deze bevindingen en produceer de complete, definitieve risicoinventarisatie in één JSON-object.

Regels:
- Combineer dubbele risico's tot één (meest volledige versie behouden)
- Hef conflicterende informatie op tot tegenstrijdigheid
- Gebruik ALLEEN bevindingen uit de aangeleverde chunks — fantaseer niets
- Geef een algehele beoordeling (overall_score en inschrijfadvies) op basis van alle bevindingen samen

`
  const idx = mainHoofd.indexOf('RETOURNEER UITSLUITEND')
  if (idx !== -1) return header + mainHoofd.slice(idx)
  return header + mainHoofd
}

/** Referentiekader één keer in systeembedeelde; documenten blijven in user. */
function systemWithReferentiekader(baseSystem: string, referentiekader: string): string {
  const rk = referentiekader.trim()
  if (!rk) return baseSystem.trimEnd()
  return `${baseSystem.trimEnd()}\n\n---\n\n${rk}`
}

// ---------------------------------------------------------------------------
// JSON parser
// ---------------------------------------------------------------------------

export function parseRisicoJson(raw: string): RisicoAnalyseResult | null {
  let cleaned = raw.trim()
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/i)
  if (fence) cleaned = fence[1].trim()

  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first === -1 || last === -1) return null

  try {
    const obj = JSON.parse(cleaned.slice(first, last + 1))
    if (!obj.risicogebieden || !obj.overall_score) return null
    return obj as RisicoAnalyseResult
  } catch (e) {
    log.warn('[risico] JSON parse fout:', e)
    return null
  }
}

// ---------------------------------------------------------------------------
// Chunking helper
// ---------------------------------------------------------------------------

/** Parseert tussen-merge / extractie-JSON (niet het volledige eind-risico-schema). */
function parsePartialExtractJson(raw: string): string | null {
  let cleaned = raw.trim()
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/i)
  if (fence) cleaned = fence[1].trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first === -1 || last === -1) return null
  try {
    const obj = JSON.parse(cleaned.slice(first, last + 1)) as { bevindingen_per_gebied?: unknown }
    if (obj && typeof obj === 'object' && obj.bevindingen_per_gebied) {
      return JSON.stringify(obj)
    }
  } catch {
    return null
  }
  return null
}

async function mergePairExtractFindings(
  rawA: string,
  rawB: string,
  labelA: string,
  labelB: string,
  mergeSystemPrompt: string,
  chatFn: RisicoChatFn,
  report: RisicoProgressReporter | undefined,
  pct: number,
): Promise<string> {
  const userMsg = [
    'Juridische definitieve inventarisatie volgt in een latere stap. Gebruik uitsluitend feiten uit de twee JSON-blokken.',
    '',
    `=== ${labelA} ===`,
    rawA,
    '',
    `=== ${labelB} ===`,
    rawB,
  ].join('\n')
  const t0 = Date.now()
  const out = await withRisicoModelWait(
    report,
    `Synthese: samenvoegen ${labelA} + ${labelB}`,
    pct,
    () =>
      chatFn(
        [
          { role: 'system', content: mergeSystemPrompt },
          { role: 'user', content: userMsg },
        ],
        { phase: 'merge' },
      ),
  )
  log.info(`[risico] Merge-paar ${labelA}+${labelB} duurMs=${Date.now() - t0} outChars=${out.length}`)
  const normalized = parsePartialExtractJson(out)
  if (normalized) return normalized
  log.warn('[risico] Merge-paar geen geldige extractie-JSON; fallback langste invoer')
  return rawA.length >= rawB.length ? rawA : rawB
}

/** Hiërarchisch samenvoegen van extractie-JSON’s (pairwise, parallel per laag). */
async function hierarchicalMergeExtractFindings(
  findings: string[],
  mergeSystemPrompt: string,
  chatFn: RisicoChatFn,
  report: RisicoProgressReporter | undefined,
): Promise<string> {
  let layer = findings.filter((f) => f?.trim())
  if (layer.length === 0) return ''
  if (layer.length === 1) return layer[0]

  let level = 0
  const basePct = 66
  while (layer.length > 1) {
    const tasks: Promise<string>[] = []
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 >= layer.length) {
        tasks.push(Promise.resolve(layer[i]))
      } else {
        const labelA = `deel-${level}-${i + 1}`
        const labelB = `deel-${level}-${i + 2}`
        const pct = Math.min(74, basePct + level * 2)
        tasks.push(
          mergePairExtractFindings(
            layer[i],
            layer[i + 1],
            labelA,
            labelB,
            mergeSystemPrompt,
            chatFn,
            report,
            pct,
          ),
        )
      }
    }
    layer = await Promise.all(tasks)
    level += 1
    report?.(`Synthese: tussenmerge laag ${level} (${layer.length} blok)`, Math.min(74, basePct + level))
  }
  return layer[0] ?? ''
}

function splitIntoChunks(texts: string[], maxChars: number): string[] {
  const chunks: string[] = []
  let current = ''
  for (const t of texts) {
    if (current.length + t.length > maxChars && current.length > 0) {
      chunks.push(current)
      current = ''
    }
    if (t.length > maxChars) {
      // Enkele tekst is zelf al te lang: splits op alinea's
      const parts = t.match(/.{1,150000}(\n|$)/gs) ?? [t.slice(0, maxChars)]
      for (const part of parts) {
        if (current.length + part.length > maxChars && current.length > 0) {
          chunks.push(current)
          current = ''
        }
        current += part
      }
    } else {
      current += '\n\n' + t
    }
  }
  if (current.trim()) chunks.push(current)
  return chunks
}

// ---------------------------------------------------------------------------
// Hoofd-exportfunctie
// ---------------------------------------------------------------------------

export interface RisicoAnalysisConfig {
  /** Moonshot API key — als aanwezig, altijd Kimi k2.6 gebruiken. */
  moonshotApiKey?: string
  moonshotBaseUrl?: string
  /** Optioneel: elke deelstap voor UI (voortgang + activiteitenlog). */
  onProgress?: RisicoProgressReporter
}

export async function runRisicoAnalysisCore(
  tender: {
    titel: string
    opdrachtgever?: string
    referentienummer?: string
    sluitingsdatum?: string
    geraamde_waarde?: string
    type_opdracht?: string
  },
  documentTexts: string[],
  config: RisicoAnalysisConfig = {},
): Promise<RisicoAnalyseResult | null> {
  if (documentTexts.length === 0) {
    log.warn('[risico] Geen documentteksten — risico-analyse overgeslagen')
    return null
  }

  const useKimi = !!config.moonshotApiKey
  const baseUrl = config.moonshotBaseUrl || MOONSHOT_BASE

  const chatFn = buildRisicoChatFn(useKimi, config.moonshotApiKey, baseUrl)

  /** Minder gelijktijdige TLS-verbindingen naar Moonshot vermindert `fetch failed` in Electron. */
  const chunkConcurrency = useKimi
    ? Math.min(2, LLM_CHUNK_EXTRACTION_CONCURRENCY)
    : LLM_CHUNK_EXTRACTION_CONCURRENCY

  const tenderContext = [
    `Aanbesteding: ${tender.titel}`,
    tender.opdrachtgever ? `Opdrachtgever: ${tender.opdrachtgever}` : '',
    tender.referentienummer ? `Referentienummer: ${tender.referentienummer}` : '',
    tender.sluitingsdatum ? `Sluitingsdatum: ${tender.sluitingsdatum}` : '',
    tender.geraamde_waarde ? `Geraamde waarde: ${tender.geraamde_waarde}` : '',
    tender.type_opdracht ? `Type opdracht: ${tender.type_opdracht}` : '',
  ].filter(Boolean).join('\n')

  const totalChars = documentTexts.reduce((s, t) => s + t.length, 0)
  log.info(`[risico] Start analyse: ${documentTexts.length} blokken, ${Math.round(totalChars / 1000)}k tekens, provider=${useKimi ? 'Kimi k2.6' : 'hoofd-AI'}`)

  const report = config.onProgress

  const risicoHoofd = loadRisicoHoofdPromptFromDb()
  const risicoExtractie = loadRisicoExtractiePromptFromDb()
  const synthesePrompt = buildSyntheseSystemPrompt(risicoHoofd)

  let wetgevingsBlok = ''
  report?.('Wetgevingsreferentie ophalen…', 22)
  try {
    wetgevingsBlok = await fetchRisicoWetgevingsContext()
    log.info(`[risico] Wetgevingsreferentie geladen (${Math.round(wetgevingsBlok.length / 1000)}k tekens)`)
    report?.(`Wetgevingsreferentie geladen (${Math.round(wetgevingsBlok.length / 1000)}k tekens)`, 24)
  } catch (e) {
    log.warn('[risico] Wetgevingsreferentie ophalen mislukt:', e)
    wetgevingsBlok =
      '=== REFERENTIEKADER WETGEVING ===\nKon niet automatisch ophalen. Gebruik desgewijs: https://wetten.overheid.nl/BWBR0032203/ (Aanbestedingswet 2012), https://wetten.overheid.nl/BWBR0032919/ (Aanbestedingsbesluit), https://www.pianoo.nl/nl/regelgeving\n'
    report?.('Wetgevingsreferentie: fallback (vaste URL\'s in prompt)', 24)
  }

  // ── Single-pass als documenten klein genoeg zijn ──────────────────────────
  if (totalChars <= SINGLE_PASS_MAX_CHARS) {
    log.info('[risico] Single-pass analyse')
    report?.(`Single-pass: volledige inventarisatie in één aanroep (~${Math.round(totalChars / 1000)}k tekens)`, 26)
    const userMessage = [
      'Maak een volledige risicoinventarisatie van de volgende aanbesteding.',
      '',
      tenderContext,
      '',
      '=== AANBESTEDINGSDOCUMENTEN ===',
      documentTexts.join('\n\n---\n\n'),
    ].join('\n')

    const raw = await withRisicoModelWait(report, 'Single-pass: risicomodel', 28, () =>
      chatFn(
        [
          { role: 'system', content: systemWithReferentiekader(risicoHoofd, wetgevingsBlok) },
          { role: 'user', content: userMessage },
        ],
        { phase: 'single' },
      ),
    )
    report?.('Single-pass: antwoord ontvangen — JSON valideren…', 44)
    const result = parseRisicoJson(raw)
    if (result) {
      log.info(`[risico] Single-pass OK: overall=${result.overall_score}`)
      report?.('Single-pass: inventarisatie gevalideerd', 88)
      return result
    }
    log.warn('[risico] Single-pass JSON parse mislukt — val terug op chunked analyse')
    report?.('Single-pass: JSON ongeldig — overschakelen naar extractie per deel', 30)
  }

  // ── Chunked analyse voor grote dossiers ───────────────────────────────────
  const chunks = splitIntoChunks(documentTexts, CHUNK_CHARS)
  log.info(
    `[risico] Chunked analyse: ${chunks.length} chunk(s), elk max ${Math.round(CHUNK_CHARS / 1000)}k tekens, parallel max ${chunkConcurrency}`,
  )
  report?.(
    `Chunked: ${chunks.length} documentdeel(len), max ${chunkConcurrency} gelijktijdig — extractie`,
    32,
  )

  const extractPhaseStart = Date.now()
  let extractiesKlaar = 0

  const outcomes = await runBatchedParallel(
    chunks,
    chunkConcurrency,
    async (chunkText, i) => {
      log.info(`[risico] Chunk ${i + 1}/${chunks.length} extractie starten (${Math.round(chunkText.length / 1000)}k tekens)`)
      report?.(
        `Extractie: deel ${i + 1}/${chunks.length} start (~${Math.round(chunkText.length / 1000)}k tekens)`,
        34 + Math.floor((i / Math.max(chunks.length, 1)) * 4),
      )
      const userMsg = [
        `Documentdeel ${i + 1} van ${chunks.length} van de aanbesteding: ${tender.titel}`,
        tenderContext,
        '',
        '=== DOCUMENTEN (DEEL) ===',
        chunkText,
      ].join('\n')

      const t0 = Date.now()
      try {
        const raw = await withRisicoModelWait(
          report,
          `Extractie deel ${i + 1}/${chunks.length}`,
          38 + Math.floor((i / Math.max(chunks.length, 1)) * 8),
          () =>
            chatFn(
              [
                { role: 'system', content: systemWithReferentiekader(risicoExtractie, wetgevingsBlok) },
                { role: 'user', content: userMsg },
              ],
              { phase: 'extract' },
            ),
        )
        const wallMs = Date.now() - t0
        log.info(`[risico] Chunk ${i + 1} extractie klaar (${raw.length} tekens, ${wallMs}ms)`)
        extractiesKlaar++
        report?.(
          `Extractie afgerond: ${extractiesKlaar}/${chunks.length} deel(en)`,
          40 + Math.round((extractiesKlaar / chunks.length) * 26),
        )
        return { ok: true as const, raw, wallMs }
      } catch (e) {
        const wallMs = Date.now() - t0
        log.warn(`[risico] Chunk ${i + 1} extractie definitief mislukt (Kimi + hoofd-AI):`, e)
        extractiesKlaar++
        report?.(
          `Extractie mislukt voor deel ${i + 1}/${chunks.length} (${extractiesKlaar}/${chunks.length} verwerkt)`,
          40 + Math.round((extractiesKlaar / chunks.length) * 26),
        )
        return { ok: false as const, wallMs }
      }
    },
  )

  const extractPhaseMs = Date.now() - extractPhaseStart
  const sumChunkWallMs = outcomes.reduce((s, o) => s + o.wallMs, 0)
  const estSequentialMs = sumChunkWallMs
  const estSavingMs = Math.max(0, estSequentialMs - extractPhaseMs)
  const savingPct =
    estSequentialMs > 0 ? Math.round((estSavingMs / estSequentialMs) * 100) : 0
  log.info(
    `[risico] Extractie-fase: ${extractPhaseMs}ms muur (parallel, concurrency=${chunkConcurrency}); ` +
      `som chunk-wachttijden ~${estSequentialMs}ms (schatting strikt sequentieel); ` +
      `geschatte tijdswinst in deze fase ~${estSavingMs}ms (${savingPct}%)`,
  )

  const successfulRaw = outcomes.filter((o) => o.ok).map((o) => o.raw)
  const failedCount = outcomes.length - successfulRaw.length

  if (successfulRaw.length === 0) {
    log.warn('[risico] Geen geslaagde extracties — synthese overgeslagen')
    report?.('Geen geslaagde documentextracties — kan geen inventarisatie samenstellen', 88)
    return null
  }

  let mergedExtractJson: string
  if (successfulRaw.length === 1) {
    mergedExtractJson = successfulRaw[0]
  } else {
    log.info('[risico] Hiërarchische tussenmerges starten')
    report?.('Synthese: tussenmerges (kleinere context per stap)…', 68)
    mergedExtractJson = await hierarchicalMergeExtractFindings(
      successfulRaw,
      DEFAULT_RISICO_MERGE_PROMPT,
      chatFn,
      report,
    )
  }

  const synParts: string[] = [
    `Aanbesteding: ${tender.titel}`,
    tenderContext,
    '',
    'Produceer de definitieve risicoinventarisatie-JSON volgens het hoofdschema. Onderstaand blok is het gecombineerde tussenresultaat van de extractiefase (JSON).',
    '',
    '=== GECOMBINEERDE EXTRACTIE-JSON ===',
    mergedExtractJson,
  ]
  if (failedCount > 0) {
    synParts.push(
      '',
      `Let op: ${failedCount} documentdeel(len) had een extractiefout — werk uitsluitend met de beschikbare bevindingen hierboven.`,
    )
  }
  const syntheseUserMsg = synParts.join('\n')

  // ── Synthesepas: definitieve volledige inventarisatie-JSON ─────────────────
  log.info('[risico] Finale synthese starten')
  report?.('Synthese: definitieve risicoinventarisatie (volledig JSON-schema)…', 76)
  const syntheseRaw = await withRisicoModelWait(report, 'Synthese: risicomodel', 78, () =>
    chatFn(
      [
        { role: 'system', content: systemWithReferentiekader(synthesePrompt, wetgevingsBlok) },
        { role: 'user', content: syntheseUserMsg },
      ],
      { phase: 'final' },
    ),
  )

  report?.('Synthese: antwoord ontvangen — JSON valideren…', 86)
  const result = parseRisicoJson(syntheseRaw)
  if (!result) {
    log.warn('[risico] Synthese JSON parse mislukt, responselengte:', syntheseRaw.length)
    report?.('Synthese: JSON kon niet worden gelezen', 88)
  } else {
    log.info(`[risico] Chunked analyse OK: overall=${result.overall_score}, gebieden=${result.risicogebieden?.length ?? 0}`)
    report?.('Chunked analyse: inventarisatie gevalideerd', 88)
  }
  return result
}
