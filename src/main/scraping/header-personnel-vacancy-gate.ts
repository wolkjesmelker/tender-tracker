/**
 * Bepaalt op basis van lijst-/kopregels (titel + korte toelichting) of een
 * publicatie een personeels-/vacature-inkoop betreft i.p.v. een aanbesteding
 * van werkzaamheden of prestaties (object/dienst met civiele of technische inhoud).
 * Gebruikt OpenAI gpt-4o; zonder API-sleutel valt de gate terug op regex.
 */

import log from 'electron-log'
import { logTokenUsage, normalizeUsageFromApiBody } from '../ai/token-logger'
import { formatFetchFailure } from '../utils/http-resilience'
import { isStaffingOrVacancyByHeuristic, type ScrapeTextFields } from './scrape-qualification'

const HEADER_GATE_MODEL = 'gpt-4o'
const BATCH = 8

export interface TenderListHeader {
  titel: string
  beschrijving?: string
  ruwe_tekst?: string
}

type Verdict = 'personeel' | 'werk'

/**
 * Voor o.a. TenderNed-documentdetectie: `openai_detection_api_key` of, bij OpenAI
 * als AI-provider, `ai_api_key`.
 */
export function resolveOpenAiKeyForScrapeHeaderGate(
  settings: Record<string, string>
): string | null {
  const det = (settings.openai_detection_api_key || '').trim()
  if (det) return det
  if ((settings.ai_provider || '').trim() === 'openai') {
    const k = (settings.ai_api_key || '').trim()
    if (k) return k
  }
  return null
}

function headerText(f: TenderListHeader): string {
  return [f.titel, f.beschrijving, f.ruwe_tekst].filter(Boolean).join(' — ').slice(0, 1500)
}

async function openAiClassifyHeaderBatch(
  items: { idx: number; text: string }[],
  apiKey: string
): Promise<Map<number, Verdict>> {
  const out = new Map<number, Verdict>()
  if (items.length === 0) return out

  const lines = items
    .map((r) => `[${r.idx}] ${r.text.replace(/\s+/g, ' ').trim()}`)
    .join('\n')

  const system = [
    'Je beoordeelt korte zichtbare titels/headers van (Europese) aanbestedingsplatforms.',
    'Doel: onderscheid maken tussen (1) inkoop van PERSONEEL, vacatures, werving, detachering, uitzend-uren, FTE, functies, uitzend- of uitleenkrachten, uitzendbureau, HR- of recruitment-raamcontracten, sollicitatie, arbeid door tussenkomst van uitzendkracht, “medewerker” als hoofddoel;',
    'en (2) echte inkoop van UITVOERING VAN WERKZAAMHEDEN of LEVERING/UITVOERING VAN (CIVIELE) DIENSTEN: werken, leveringen, opdracht voor bouw, onderhoud van infrastructuur, asfalt, wegen, riolering, omgevingswerken, etc.',
    'Als de kop vooral werving van een vakant functie of inhuur van mensen (uren/mandagen) betreft: "personeel".',
    'Bij twijfel of gemengd: "werk" (niet uitsluiten).',
    'Antwoord uitsluitend met JSON: {"verdicts":[{"idx":0,"categorie":"personeel|werk"}]} in dezelfde volgorde en indices als de invoer.',
  ].join('\n')

  const user = `Beoordeel elke regel. Invoer:\n${lines}`

  const endpoint = 'https://api.openai.com/v1/chat/completions'
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: HEADER_GATE_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 500,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })
  } catch (e) {
    throw formatFetchFailure(e, 'OpenAI (header-personeelcheck) niet bereikbaar', endpoint)
  }

  if (!response.ok) {
    const t = await response.text()
    throw new Error(`OpenAI header-personeelcheck: ${response.status} — ${t.slice(0, 500)}`)
  }

  const data = await response.json()
  const { input, output } = normalizeUsageFromApiBody(data)
  logTokenUsage('OpenAI', HEADER_GATE_MODEL, input, output)

  const text = (data as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message
    ?.content
  if (!text?.trim()) {
    throw new Error('OpenAI: lege classificatieresponse')
  }

  let parsed: { verdicts?: { idx: number; categorie?: string }[] }
  try {
    parsed = JSON.parse(text) as { verdicts?: { idx: number; categorie?: string }[] }
  } catch {
    log.warn('[header-personnel-gate] JSON parse failed:', text.slice(0, 200))
    throw new Error('OpenAI: ongeldige JSON bij header-classificatie')
  }

  const verdicts = parsed.verdicts
  if (!Array.isArray(verdicts)) {
    throw new Error('OpenAI: verdicts ontbreekt in JSON')
  }

  for (const v of verdicts) {
    if (typeof v.idx !== 'number' || v.idx < 0) continue
    const c = (v.categorie || '').toLowerCase()
    out.set(
      v.idx,
      c.startsWith('personeel') || c.includes('personeels') ? 'personeel' : 'werk'
    )
  }

  for (const it of items) {
    if (!out.has(it.idx)) {
      out.set(it.idx, 'werk')
    }
  }

  return out
}

/**
 * Verwijdert tenders die (volgens gpt-4o op de kop) personeel/vacature-inkoop zijn.
 * Zonder geldige OpenAI-sleutel: alleen regex; tenders blijven staan behalve duidelijke regex-treffers.
 */
export async function filterTendersExcludingPersonnelHeadersWithGpt4o(
  tenders: TenderListHeader[],
  settings: Record<string, string>,
  options?: { onSkip?: (titel: string, reason: 'regex' | 'gpt') => void }
): Promise<TenderListHeader[]> {
  if (tenders.length === 0) return []

  const apiKey = resolveOpenAiKeyForScrapeHeaderGate(settings)
  const kept: TenderListHeader[] = []
  const needGpt: { tender: TenderListHeader }[] = []

  for (let i = 0; i < tenders.length; i++) {
    const t = tenders[i]
    if (isStaffingOrVacancyByHeuristic(t as ScrapeTextFields)) {
      options?.onSkip?.(t.titel, 'regex')
      log.info(
        `[header-personeel] overgeslagen (regex): "${(t.titel || '').slice(0, 90)}"`
      )
      continue
    }
    if (!apiKey) {
      kept.push(t)
      continue
    }
    needGpt.push({ tender: t })
  }

  if (needGpt.length === 0) return [...kept]
  if (!apiKey) {
    for (const s of needGpt) {
      kept.push(s.tender)
    }
    return kept
  }
  const gptKey: string = apiKey

  for (let start = 0; start < needGpt.length; start += BATCH) {
    const slice = needGpt.slice(start, start + BATCH)
    const items = slice.map((s, j) => ({
      idx: j,
      text: headerText(s.tender),
    }))

    let verdicts: Map<number, Verdict>
    try {
      verdicts = await openAiClassifyHeaderBatch(items, gptKey)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.warn('[header-personeel] GPT-batch mislukt, items conservatief behouden:', msg)
      for (const s of slice) {
        kept.push(s.tender)
      }
      continue
    }

    for (let k = 0; k < slice.length; k++) {
      const s = slice[k]
      const v = verdicts.get(k) ?? 'werk'
      if (v === 'personeel') {
        options?.onSkip?.(s.tender.titel, 'gpt')
        log.info(
          `[header-personeel] overgeslagen (gpt-4o): "${(s.tender.titel || '').slice(0, 90)}"`
        )
      } else {
        kept.push(s.tender)
      }
    }
  }

  return kept
}

/**
 * Lijstfase (België): voorkomt laden van de detail-URL.
 */
export async function shouldSkipListItemForPersonnelHeaderGpt4o(
  titel: string,
  snippet: string | undefined,
  settings: Record<string, string>
): Promise<boolean> {
  const fields: TenderListHeader = { titel, beschrijving: snippet, ruwe_tekst: undefined }
  if (isStaffingOrVacancyByHeuristic(fields as ScrapeTextFields)) {
    return true
  }
  const apiKey = resolveOpenAiKeyForScrapeHeaderGate(settings)
  if (!apiKey) {
    return false
  }
  try {
    const m = await openAiClassifyHeaderBatch(
      [{ idx: 0, text: headerText(fields) }],
      apiKey
    )
    return (m.get(0) ?? 'werk') === 'personeel'
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log.warn('[header-personeel] België lijstcheck gpt-4o mislukt, detail behouden:', msg)
    return false
  }
}
