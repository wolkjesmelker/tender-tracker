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

/** OpenAI reasoning-modellen: geen temperature, max_completion_tokens, developer-rol. */
const OPENAI_REASONING_MODELS = new Set(['o3', 'o4-mini', 'o3-mini', 'o1', 'o1-mini', 'o1-preview'])

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
  // Strak geconfigureerd zodat een trage/haperende Moonshot-call
  // snel richting hoofd-AI fallback gaat i.p.v. de hele run te blokkeren.
  if (phase === 'merge') {
    return { maxAttempts: 2, baseDelayMs: 1200, maxDelayMs: 6_000, timeoutPerAttemptMs: 90_000 }
  }
  if (phase === 'extract') {
    return { maxAttempts: 2, baseDelayMs: 1200, maxDelayMs: 8_000, timeoutPerAttemptMs: 120_000 }
  }
  // 'single' en 'final': maximaal 1 retry zodat fallback snel plaatsvindt bij grote calls.
  return { maxAttempts: 2, baseDelayMs: 2000, maxDelayMs: 5_000, timeoutPerAttemptMs: 150_000 }
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

// ---------------------------------------------------------------------------
// OpenAI direct provider (voor top-tier model override)
// ---------------------------------------------------------------------------

function openaiTimeoutForModel(model: string): number {
  if (model === 'o3') return 600_000
  if (model.startsWith('o')) return 360_000
  return 200_000
}

async function openaiRisicoChat(
  apiKey: string,
  model: string,
  messages: ChatMsg[],
): Promise<string> {
  const isReasoning = OPENAI_REASONING_MODELS.has(model)
  const endpoint = 'https://api.openai.com/v1/chat/completions'

  // Reasoning models use 'developer' role instead of 'system'
  const apiMessages = isReasoning
    ? messages.map((m) => ({ role: m.role === 'system' ? ('developer' as const) : m.role, content: m.content }))
    : messages

  const body: Record<string, unknown> = {
    model,
    messages: apiMessages,
    response_format: { type: 'json_object' },
  }
  if (isReasoning) {
    body.max_completion_tokens = 16000
    // No temperature for reasoning models
  } else {
    body.max_tokens = 16384
    body.temperature = 0.3
  }

  const timeoutMs = openaiTimeoutForModel(model)
  const inputChars = messages.reduce((n, m) => n + m.content.length, 0)
  log.info(
    `[risico] OpenAI ${model} POST — ~${Math.round(inputChars / 1000)}k tekens, timeout ${Math.round(timeoutMs / 1000)}s, isReasoning=${isReasoning}`,
  )

  let response: Response
  try {
    response = await fetchWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      },
      { maxAttempts: 2, baseDelayMs: 3000, maxDelayMs: 15_000, timeoutPerAttemptMs: timeoutMs },
    )
  } catch (e) {
    throw formatFetchFailure(e, `OpenAI ${model} niet bereikbaar`, endpoint)
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '(fouttekst niet leesbaar)')
    throw new Error(`OpenAI ${model} fout ${response.status}: ${String(errText).slice(0, 500)}`)
  }

  log.info(`[risico] OpenAI ${model}: HTTP OK — antwoord binnenhalen…`)
  const data = (await readResponseJsonWithTimeout(
    response,
    timeoutMs,
    `OpenAI ${model} JSON-antwoord`,
  )) as { choices?: Array<{ message?: { content?: string } }> }
  const { input, output } = normalizeUsageFromApiBody(data)
  logTokenUsage(`OpenAI (risico)`, model, input, output)
  const content = data.choices?.[0]?.message?.content ?? ''
  log.info(`[risico] OpenAI ${model}: antwoord ontvangen (${content.length} tekens)`)
  return content
}

/** Fallback: gebruik de geconfigureerde hoofd-AI (importeer lazily om circular deps te vermijden). */
async function fallbackChat(messages: ChatMsg[]): Promise<string> {
  const { aiService } = await import('./ai-service')
  return aiService.chat(messages, { preferJsonOutput: true })
}

// ---------------------------------------------------------------------------
// Claude (Anthropic) direct provider (voor top-tier model override)
// ---------------------------------------------------------------------------

async function claudeRisicoChat(
  apiKey: string,
  model: string,
  messages: ChatMsg[],
): Promise<string> {
  const endpoint = 'https://api.anthropic.com/v1/messages'
  const systemMessage = messages.find((m) => m.role === 'system')?.content ?? ''
  const userMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }))

  const isOpus = model.includes('opus')
  const timeoutMs = isOpus ? 360_000 : 240_000
  const inputChars = messages.reduce((n, m) => n + m.content.length, 0)
  log.info(
    `[risico] Claude ${model} POST — ~${Math.round(inputChars / 1000)}k tekens, timeout ${Math.round(timeoutMs / 1000)}s`,
  )

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
          model,
          max_tokens: 16000,
          system: systemMessage,
          messages: userMessages,
        }),
      },
      { maxAttempts: 2, baseDelayMs: 3000, maxDelayMs: 15_000, timeoutPerAttemptMs: timeoutMs },
    )
  } catch (e) {
    throw formatFetchFailure(e, `Claude ${model} niet bereikbaar`, endpoint)
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '(fouttekst niet leesbaar)')
    throw new Error(`Claude ${model} fout ${response.status}: ${String(errText).slice(0, 500)}`)
  }

  log.info(`[risico] Claude ${model}: HTTP OK — antwoord binnenhalen…`)
  const data = (await readResponseJsonWithTimeout(
    response,
    timeoutMs,
    `Claude ${model} JSON-antwoord`,
  )) as { content?: Array<{ text?: string }> }
  const { input, output } = normalizeUsageFromApiBody(data)
  logTokenUsage(`Claude (risico)`, model, input, output)
  const content = data.content?.[0]?.text ?? ''
  log.info(`[risico] Claude ${model}: antwoord ontvangen (${content.length} tekens)`)
  return content
}

/**
 * Google Gemini 2.5 Flash voor risico-inventarisatie.
 * Gebruikt de native generateContent API; system-instructie apart.
 * `responseMimeType: 'application/json'` geeft directe JSON-output.
 */
async function geminiRisicoChat(
  apiKey: string,
  model: string,
  messages: ChatMsg[],
): Promise<string> {
  const systemMsg = messages.find((m) => m.role === 'system')?.content ?? ''
  const conversationMsgs = messages.filter((m) => m.role !== 'system')

  const contents = conversationMsgs.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
    },
  }
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg }] }
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const inputChars = messages.reduce((n, m) => n + m.content.length, 0)
  log.info(`[risico] Gemini ${model} POST — ~${Math.round(inputChars / 1000)}k tekens`)

  let response: Response
  try {
    response = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, { maxAttempts: 3, retryDelaysMs: [0, 8_000, 20_000], timeoutPerAttemptMs: 300_000 })
  } catch (e) {
    throw formatFetchFailure(e, 'Google Gemini API niet bereikbaar', endpoint)
  }

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Google Gemini API error: ${response.status} - ${errText.slice(0, 500)}`)
  }

  const data = (await readResponseJsonWithTimeout(response, 300_000, `Gemini ${model} JSON`)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  const inputTokens = data.usageMetadata?.promptTokenCount ?? 0
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0
  logTokenUsage('Google Gemini (risico)', model, inputTokens, outputTokens)
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
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
 * Kimi eerst (indien sleutel), daarna Gemini, dan hoofd-AI fallback.
 * Als `openaiModel`/`openaiApiKey` of `claudeModel`/`claudeApiKey` zijn opgegeven worden die gebruikt.
 */
function buildRisicoChatFn(
  useKimi: boolean,
  moonshotApiKey: string | undefined,
  baseUrl: string,
  openaiModel?: string,
  openaiApiKey?: string,
  claudeModel?: string,
  claudeApiKey?: string,
  geminiApiKey?: string,
  geminiModel?: string,
): RisicoChatFn {
  return async (messages, meta) => {
    const phase = meta?.phase ?? 'final'
    const sysLen = messages[0]?.content?.length ?? 0
    const userLen = messages[messages.length - 1]?.content?.length ?? 0
    log.info(`[risico] LLM-call phase=${phase} systemChars=${sysLen} userChars=${userLen}`)

    // Claude top-tier model override
    if (claudeModel && claudeApiKey) {
      return claudeRisicoChat(claudeApiKey, claudeModel, messages)
    }

    // OpenAI top-tier model override
    if (openaiModel && openaiApiKey) {
      return openaiRisicoChat(openaiApiKey, openaiModel, messages)
    }

    // Google Gemini — 1M context, directe voorkeur boven Kimi voor risico-analyse
    // (Kimi max 262K tokens; grote dossiers passen er niet in)
    if (geminiApiKey) {
      try {
        return await geminiRisicoChat(geminiApiKey, geminiModel || 'gemini-2.5-flash', messages)
      } catch (e) {
        log.warn(
          '[risico] Gemini faalde — fallback naar hoofd-AI:',
          e instanceof Error ? e.message : e,
        )
        return resilientMainAiChat(messages)
      }
    }

    // Kimi (Moonshot) — 128K context, alleen als Gemini niet geconfigureerd is
    if (useKimi && moonshotApiKey) {
      try {
        return await kimiChat(moonshotApiKey, baseUrl, messages, kimiFetchOptionsForPhase(phase))
      } catch (e) {
        log.warn(
          '[risico] Kimi (Moonshot) faalde na retries — fallback naar hoofd-AI:',
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
  /** Google Gemini API key — gebruikt als Kimi niet beschikbaar is. */
  geminiApiKey?: string
  /** Gemini model (default: gemini-2.5-flash). */
  geminiModel?: string
  /** Top-tier OpenAI model override voor eenmalige heranalyse (bijv. 'o3', 'o4-mini', 'gpt-4.1'). */
  openaiModelOverride?: string
  /** OpenAI API-sleutel voor de model override. */
  openaiApiKey?: string
  /** Anthropic Claude model override voor eenmalige heranalyse (bijv. 'claude-opus-4-7', 'claude-sonnet-4-6'). */
  claudeModelOverride?: string
  /** Anthropic API-sleutel voor de Claude model override. */
  claudeApiKey?: string
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

  const useClaude = !!(config.claudeModelOverride && config.claudeApiKey)
  const useOpenAI = !useClaude && !!(config.openaiModelOverride && config.openaiApiKey)
  const useKimi = !useClaude && !useOpenAI && !!config.moonshotApiKey
  const baseUrl = config.moonshotBaseUrl || MOONSHOT_BASE

  const chatFn = buildRisicoChatFn(
    useKimi,
    config.moonshotApiKey,
    baseUrl,
    useOpenAI ? config.openaiModelOverride : undefined,
    useOpenAI ? config.openaiApiKey : undefined,
    useClaude ? config.claudeModelOverride : undefined,
    useClaude ? config.claudeApiKey : undefined,
    config.geminiApiKey,
    config.geminiModel,
  )

  /** Minder gelijktijdige TLS-verbindingen naar Moonshot vermindert `fetch failed` in Electron. */
  const chunkConcurrency = useKimi
    ? Math.min(2, LLM_CHUNK_EXTRACTION_CONCURRENCY)
    : LLM_CHUNK_EXTRACTION_CONCURRENCY

  const providerLabel = useClaude
    ? `Claude ${config.claudeModelOverride}`
    : useOpenAI
      ? `OpenAI ${config.openaiModelOverride}`
      : useKimi
        ? 'Kimi k2.6'
        : 'hoofd-AI'

  const tenderContext = [
    `Aanbesteding: ${tender.titel}`,
    tender.opdrachtgever ? `Opdrachtgever: ${tender.opdrachtgever}` : '',
    tender.referentienummer ? `Referentienummer: ${tender.referentienummer}` : '',
    tender.sluitingsdatum ? `Sluitingsdatum: ${tender.sluitingsdatum}` : '',
    tender.geraamde_waarde ? `Geraamde waarde: ${tender.geraamde_waarde}` : '',
    tender.type_opdracht ? `Type opdracht: ${tender.type_opdracht}` : '',
  ].filter(Boolean).join('\n')

  const totalChars = documentTexts.reduce((s, t) => s + t.length, 0)
  log.info(`[risico] Start analyse: ${documentTexts.length} blokken, ${Math.round(totalChars / 1000)}k tekens, provider=${providerLabel}`)

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

/**
 * Bouw een RisicoChatFn vanuit een RisicoAnalysisConfig.
 * Geëxporteerd zodat de V2 orchestrator dezelfde chatFn kan gebruiken.
 */
export function buildRisicoChatFnFromConfig(config: RisicoAnalysisConfig): RisicoChatFn {
  const useClaude = !!(config.claudeModelOverride && config.claudeApiKey)
  const useOpenAI = !useClaude && !!(config.openaiModelOverride && config.openaiApiKey)
  const useKimi = !useClaude && !useOpenAI && !!config.moonshotApiKey
  const baseUrl = config.moonshotBaseUrl || MOONSHOT_BASE
  return buildRisicoChatFn(
    useKimi,
    config.moonshotApiKey,
    baseUrl,
    useOpenAI ? config.openaiModelOverride : undefined,
    useOpenAI ? config.openaiApiKey : undefined,
    useClaude ? config.claudeModelOverride : undefined,
    useClaude ? config.claudeApiKey : undefined,
    config.geminiApiKey,
    config.geminiModel,
  )
}
