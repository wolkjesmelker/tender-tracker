import log from 'electron-log'
import { aiService } from './ai-service'
import { DEFAULT_RISICO_DOC_GATE_PROMPT } from './risico-prompt-defaults'

export type RisicoAttachment = {
  naam: string
  type?: string
  /** Volledige geëxtraheerde tekst (max zoals in collector). */
  text: string
  samenvatting?: string
}

const SNIPPET_CHARS = 2200
/** Minimaal aantal tekens aan bijlagetekst na filter; anders alles meenemen (kwaliteit). */
const MIN_INCLUDED_ATTACHMENT_CHARS = 12_000

type HeuristicDecision = 'include' | 'exclude' | 'uncertain'

function norm(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Whitelist eerst: PVe, leidraad, contract, enz. moeten nooit vallen op blacklist.
 * Blacklist: typische invul-/inschrijf-only stukken.
 */
export function heuristicRisicoAttachmentDecision(naam: string, type?: string): HeuristicDecision {
  const hay = norm(`${naam} ${type || ''}`)

  const forceInclude =
    /\b(pve|programma\s*van\s*eisen|eisenprogramma)\b/.test(hay) ||
    /\b(aanbestedings)?leidraad\b/.test(hay) ||
    /\b(lastenregister|bestek)\b/.test(hay) ||
    /\b(nota\s*van\s*inlichtingen|nvi\b)\b/.test(hay) ||
    /\b(concept)?(overeenkomst|contract)\b/.test(hay) ||
    /\b(beoordelings|gunnings|prijs(formule|berekening)?)\b/.test(hay) ||
    /\b(specificatie|lastenboek)\b/.test(hay) ||
    /\b(aanbestedingsdocument|tenderdocument|offerteaanvraag)\b/.test(hay) ||
    /\binschrijf\s*voorwaarden\b/.test(hay) ||
    /\b(voorwaarden|eisen).*?(aanbesteding|inschrijving)\b/.test(hay)

  if (forceInclude) return 'include'

  const forceExclude =
    /\buniform\s+europees\b/.test(hay) ||
    /\buea\b/.test(hay) ||
    /\binschrijfformulier\b/.test(hay) ||
    /\bdeelnemersformulier\b/.test(hay) ||
    /\bmachtigingsformulier\b/.test(hay) ||
    /\b(aanmeldingsformulier|aanmeldformulier)\b/.test(hay) ||
    /^[^\n]*(onderteken|ondertekening)[^\n]*formulier/.test(hay) ||
    /\bkvk[-\s]?uittreksel\b/.test(hay) ||
    /\beigen\s+verklaring\b/.test(hay) ||
    /\bintegriteitsverklaring\b/.test(hay) && /\bformulier\b/.test(hay)

  if (forceExclude) return 'exclude'

  return 'uncertain'
}

function snippetForGate(att: RisicoAttachment): string {
  if (att.samenvatting?.trim()) {
    return att.samenvatting.trim().slice(0, SNIPPET_CHARS)
  }
  return att.text.trim().slice(0, SNIPPET_CHARS)
}

async function classifyUncertainWithLlm(
  uncertain: { attachment: RisicoAttachment; index: number }[],
): Promise<Map<number, { include: boolean; reason: string }>> {
  const out = new Map<number, { include: boolean; reason: string }>()
  if (uncertain.length === 0) return out

  const docs = uncertain.map(({ attachment: a, index: i }) => ({
    index: i,
    naam: a.naam,
    type: a.type || '',
    snippet: snippetForGate(a),
  }))

  const user = JSON.stringify({ docs }, null, 0)
  let raw: string
  try {
    raw = await aiService.chat(
      [
        { role: 'system', content: DEFAULT_RISICO_DOC_GATE_PROMPT },
        { role: 'user', content: user },
      ],
      { preferJsonOutput: true },
    )
  } catch (e) {
    log.warn('[risico-gate] LLM-classificatie mislukt — neem onzekere bijlagen mee:', e)
    for (const u of uncertain) {
      out.set(u.index, { include: true, reason: 'LLM-fout; veilig meegenomen' })
    }
    return out
  }

  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const parsed = JSON.parse(cleaned) as { items?: { index: number; include: boolean; reason?: string }[] }
    const items = Array.isArray(parsed.items) ? parsed.items : []
    for (const it of items) {
      if (typeof it.index !== 'number' || typeof it.include !== 'boolean') continue
      out.set(it.index, { include: it.include, reason: String(it.reason || '').slice(0, 200) })
    }
    for (const u of uncertain) {
      if (!out.has(u.index)) {
        out.set(u.index, { include: true, reason: 'Ontbrekend in modelantwoord; veilig meegenomen' })
      }
    }
  } catch (e) {
    log.warn('[risico-gate] JSON parse classificatie mislukt — alles meenemen:', e)
    for (const u of uncertain) {
      out.set(u.index, { include: true, reason: 'Parse-fout; veilig meegenomen' })
    }
  }
  return out
}

export type RisicoGateResult = {
  included: RisicoAttachment[]
  excluded: { naam: string; reason: string }[]
  /** true als drempel te weinig tekens gaf en alles opnieuw is meegenomen */
  fallbackAllAttachments: boolean
}

/**
 * Filtert bijlagen vóór Kimi-risico: heuristiek + één lichte LLM-batch voor onzekere items.
 */
export async function gateRisicoAttachments(attachments: RisicoAttachment[]): Promise<RisicoGateResult> {
  if (attachments.length === 0) {
    return { included: [], excluded: [], fallbackAllAttachments: false }
  }

  // Pass-through (2026-04-19): document-gate tijdelijk uitgeschakeld voor snelheid.
  // De heuristiek hieronder en de LLM-classificatie kostten per run een extra
  // OpenAI-call en marginale tekenwinst. Neem alle bijlagen direct mee; de
  // bestaande SINGLE_PASS_MAX_CHARS / chunking-laag begrensen verderop.
  if (attachments.length > 0) {
    log.info(`[risico-gate] Uitgeschakeld: alle ${attachments.length} bijlagen meegenomen zonder filter`)
    return { included: [...attachments], excluded: [], fallbackAllAttachments: true }
  }

  const excluded: { naam: string; reason: string }[] = []
  const includeList: RisicoAttachment[] = []
  const uncertain: { attachment: RisicoAttachment; index: number }[] = []
  let idx = 0

  for (const att of attachments) {
    const d = heuristicRisicoAttachmentDecision(att.naam, att.type)
    if (d === 'include') {
      includeList.push(att)
      log.info(`[risico-gate] meenemen (heuristiek): ${att.naam.slice(0, 80)}`)
    } else if (d === 'exclude') {
      excluded.push({ naam: att.naam, reason: 'Heuristiek: waarschijnlijk invul-/inschrijfformulier' })
      log.info(`[risico-gate] uitgesloten (heuristiek): ${att.naam.slice(0, 80)}`)
    } else {
      uncertain.push({ attachment: att, index: idx })
      idx++
    }
  }

  const llmMap = await classifyUncertainWithLlm(uncertain)
  for (const u of uncertain) {
    const r = llmMap.get(u.index) ?? { include: true, reason: 'default' }
    if (r.include) {
      includeList.push(u.attachment)
      log.info(`[risico-gate] meenemen (model): ${u.attachment.naam.slice(0, 72)} — ${r.reason}`)
    } else {
      excluded.push({ naam: u.attachment.naam, reason: r.reason || 'Model: invulformulier / niet substantieel' })
      log.info(`[risico-gate] uitgesloten (model): ${u.attachment.naam.slice(0, 72)}`)
    }
  }

  let included = includeList
  let fallbackAllAttachments = false

  const attChars = (list: RisicoAttachment[]) => list.reduce((s, a) => s + a.text.length, 0)
  const charsIncluded = attChars(included)

  if (included.length === 0 && attachments.length > 0) {
    log.warn('[risico-gate] Geen bijlagen over na filter — fallback: alle bijlagen meenemen')
    included = [...attachments]
    fallbackAllAttachments = true
  } else if (charsIncluded < MIN_INCLUDED_ATTACHMENT_CHARS && excluded.length > 0 && attachments.length > 0) {
    log.warn(
      `[risico-gate] Weinig bijlagetekens na filter (${charsIncluded} < ${MIN_INCLUDED_ATTACHMENT_CHARS}) — fallback: alle bijlagen`,
    )
    included = [...attachments]
    fallbackAllAttachments = true
  }

  return { included, excluded, fallbackAllAttachments }
}
