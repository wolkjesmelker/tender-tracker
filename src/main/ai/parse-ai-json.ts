import log from 'electron-log'
import { jsonrepair } from 'jsonrepair'

/**
 * Haalt het eerste complete JSON-object uit tekst (rekening houdend met strings en escapes).
 * Beter dan /\{[\s\S]*\}/ — dat matcht te gretig bij geneste of gebroken output.
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
        continue
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function stripMarkdownJsonFence(text: string): string {
  const s = text.trim()
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (m) return m[1].trim()
  return s
}

function repairCommonJsonIssues(jsonStr: string): string {
  let s = jsonStr
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/,(\s*)([}\]])/g, '$1$2')
    if (next === s) break
    s = next
  }
  s = s.replace(/:\s*undefined\b/g, ': null')
  s = s.replace(/:\s*NaN\b/g, ': null')
  s = s.replace(/[\u201c\u201d\u201e\u201f]/g, '"')
  s = s.replace(/\u00a0/g, ' ')
  return s
}

function tryJsonRepairThenParse(
  jsonStr: string,
  routeLabel: 'jsonrepair' | 'jsonrepair_basic',
  extractMode: 'standard' | 'greedy_fallback'
): { parsed: Record<string, unknown>; route: typeof routeLabel } | null {
  try {
    const fixed = jsonrepair(jsonStr)
    const parsed = toRecord(JSON.parse(fixed))
    if (!parsed) return null
    log.info(
      `[analysis-json] parse OK (${routeLabel}), extract=${extractMode}, inChars=${jsonStr.length}, repairedChars=${fixed.length}, topKeys=${Object.keys(parsed).sort().join(',')}`
    )
    return { parsed, route: routeLabel }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    log.warn(`[analysis-json] ${routeLabel} (${extractMode}) failed: ${msg}`)
    return null
  }
}

function toRecord(parsed: unknown): Record<string, unknown> | null {
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
}

export type AnalysisJsonParseRoute = 'direct' | 'basic_repair' | 'jsonrepair' | 'jsonrepair_basic'

export type AnalysisJsonExtractMode = 'standard' | 'greedy_fallback'

/**
 * Parseert model-output naar een object. Lokale modellen (o.a. Gemma) produceren vaak
 * markdown, trailing komma's of kleine syntaxfouten — daarom meerdere pogingen.
 */
export function parseAnalysisJsonResponse(raw: string): {
  parsed: Record<string, unknown> | null
  parseError?: string
  parseRoute?: AnalysisJsonParseRoute
  extractMode?: AnalysisJsonExtractMode
} {
  const text = stripMarkdownJsonFence(raw)
  let candidate = extractFirstJsonObject(text)
  let usedGreedy = false
  if (!candidate) {
    const greedy = text.match(/\{[\s\S]*\}/)
    candidate = greedy ? greedy[0] : null
    usedGreedy = !!candidate
  }
  if (!candidate) {
    log.warn(`[analysis-json] geen JSON-object in antwoord (rawLength=${raw.length})`)
    return { parsed: null, parseError: 'Geen JSON-object gevonden in modelantwoord.' }
  }

  const extractMode: AnalysisJsonExtractMode = usedGreedy ? 'greedy_fallback' : 'standard'
  const repairedBasic = repairCommonJsonIssues(candidate)
  const variants = [candidate, repairedBasic]

  for (let i = 0; i < variants.length; i++) {
    try {
      const parsed = toRecord(JSON.parse(variants[i]))
      if (parsed) {
        const parseRoute: AnalysisJsonParseRoute = i === 0 ? 'direct' : 'basic_repair'
        log.info(
          `[analysis-json] parse OK (${parseRoute}), extract=${extractMode}, responseChars=${raw.length}, objectChars=${variants[i].length}, topKeys=${Object.keys(parsed).sort().join(',')}`
        )
        return { parsed, parseRoute, extractMode }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.warn(`[analysis-json] attempt ${i + 1} (${i === 0 ? 'raw' : 'basic_repair'}) JSON.parse: ${msg}`)
    }
  }

  const repaired = tryJsonRepairThenParse(candidate, 'jsonrepair', extractMode)
  if (repaired) {
    return { parsed: repaired.parsed, parseRoute: repaired.route, extractMode }
  }

  const repaired2 = tryJsonRepairThenParse(repairedBasic, 'jsonrepair_basic', extractMode)
  if (repaired2) {
    return { parsed: repaired2.parsed, parseRoute: repaired2.route, extractMode }
  }

  log.error(
    `[analysis-json] alle parse-pogingen gefaald; rawLength=${raw.length}, candidateLength=${candidate.length}`
  )
  return {
    parsed: null,
    parseError:
      'JSON is ongeldig (vaak door afgekapt antwoord of zeldzame syntax). Probeer opnieuw, een ander model, of verminder de hoeveelheid bijlagen/context.',
  }
}
