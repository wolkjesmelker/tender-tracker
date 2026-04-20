/**
 * Document Location Detector
 *
 * Uses OpenAI GPT-4o-mini (cloud, always) to detect when a TenderNed tender
 * references an external platform (Mercell / Negometrix) for its documents.
 * Falls back to regex if no OpenAI key is configured.
 *
 * This runs BEFORE the main analysis and is independent of the user's chosen
 * AI provider — even Ollama users get cloud-powered location detection.
 */

import log from 'electron-log'
import { logTokenUsage, normalizeUsageFromApiBody } from './token-logger'

export interface LocationDetectionResult {
  /** Detected external platform */
  platform: 'mercell' | 'negometrix' | 'ted' | 'other' | 'none'
  /** Full URL of the tender on the external platform */
  externalUrl: string | null
  /** Canonical Mercell/Negometrix URL (if applicable) */
  mercellUrl: string | null
  /** Human-readable explanation */
  additionalInfo: string
  /** Estimated number of documents on the external platform */
  documentCount: number | null
  confidence: 'high' | 'medium' | 'low'
}

// ── Regex-based quick scan ───────────────────────────────────────────────────

/** Inclusief EU/subsites die TenderNed in verwijzingen gebruikt. */
const MERCELL_URL_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:mercell\.com|mercell\.eu|negometrix\.com|s2c\.mercell\.com|apm\.mercell\.com|eu\.mercell\.com)[^\s"'<>)[\]{}]*/gi

/** Zonder scheme (proza of href): www.mercell.com/... */
const MERCELL_HOST_PATH_RE =
  /\b(?:https?:\/\/)?(?:www\.)?(?:mercell\.com|mercell\.eu|negometrix\.com|s2c\.mercell\.com)\/[^\s"'<>)\]}]+/gi

const MERCELL_TEXT_HINTS = [
  'mercell',
  'negometrix',
  's2c.mercell',
  'mercell.com',
  'mercell.eu',
  'negometrix.com',
]

function normalizeMercellCandidate(raw: string): string | null {
  let u = raw.replace(/[.,;)'">\]]+$/g, '').trim()
  if (!u) return null
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/\//, '')
  try {
    const parsed = new URL(u)
    const h = parsed.hostname.toLowerCase()
    if (
      !h.includes('mercell') &&
      !h.includes('negometrix') &&
      !h.includes('s2c.')
    ) {
      return null
    }
    return parsed.href.split('#')[0]
  } catch {
    return null
  }
}

/**
 * Alle Mercell/Negometrix-URLs uit gescrapete TenderNed-tekst (ook zonder https).
 */
export function extractMercellUrls(fullPageText: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const add = (raw: string) => {
    const n = normalizeMercellCandidate(raw)
    if (n && !seen.has(n)) {
      seen.add(n)
      found.push(n)
    }
  }

  let m: RegExpExecArray | null
  const t = fullPageText || ''
  const re1 = new RegExp(MERCELL_URL_RE.source, 'gi')
  while ((m = re1.exec(t)) !== null) add(m[0])

  const re2 = new RegExp(MERCELL_HOST_PATH_RE.source, 'gi')
  while ((m = re2.exec(t)) !== null) add(m[0])

  return found
}

export function textMentionsMercell(text: string): boolean {
  const lower = text.toLowerCase()
  return MERCELL_TEXT_HINTS.some(h => lower.includes(h))
}

/**
 * TenderNed toont soms een blauwe balk: geïmporteerde aankondiging; documenten staan op Mercell
 * (linktekst "Mercell", href naar app.mercell.com e.d.).
 */
export function isTenderNedMercellImportedNotice(text: string): boolean {
  if (!text?.trim()) return false
  const t = text.toLowerCase()
  const hasImport =
    /ge[iï]mporteerde\s+aankondiging/.test(t) ||
    /geimporteerde\s+aankondiging/.test(t) ||
    /imported\s+announcement/.test(t)
  if (!hasImport) return false
  return MERCELL_TEXT_HINTS.some(h => t.includes(h)) || t.includes('negometrix')
}

/**
 * Kies de meest waarschijnlijke inschrijvings-/aanbestedings-URL (niet login/help).
 */
export function pickPreferredMercellUrl(urls: string[]): string | null {
  if (!urls.length) return null
  const scored = urls.map(u => {
    let score = 0
    try {
      const p = new URL(u).pathname.toLowerCase()
      if (/login|sign-?in|auth|\/help|\/support|\/home\/?$|mijn-?mercell|register|wachtwoord/i.test(p)) score -= 80
      if (/\/(tender|notice|aanbesteding|opdracht|sourcing|inkoop|procurement|n-t)\b/i.test(p)) score += 40
      if (/\d{5,}/.test(p)) score += 20
      if (p.length > 25) score += 8
      if (p.split('/').filter(Boolean).length >= 3) score += 5
    } catch {
      score = -100
    }
    return { u, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].u
}

// ── OpenAI cloud detection ───────────────────────────────────────────────────

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const DETECTION_MODEL = 'gpt-4o-mini'
const DETECTION_MAX_TOKENS = 512
const DETECTION_TIMEOUT_MS = 30_000

async function callOpenAIDetector(
  fullPageText: string,
  bronUrl: string,
  apiKey: string
): Promise<LocationDetectionResult | null> {
  const truncated = fullPageText.slice(0, 16_000)
  const importedNotice = isTenderNedMercellImportedNotice(fullPageText)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DETECTION_TIMEOUT_MS)

  try {
    const res = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DETECTION_MODEL,
        max_tokens: DETECTION_MAX_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Je bent een specialist in Nederlandse aanbestedingsteksten. ' +
              'Analyseer de tekst en bepaal of documenten/bijlagen beschikbaar zijn op een extern platform ' +
              '(Mercell, Negometrix, TED, of ander). Antwoord uitsluitend met geldige JSON — geen extra tekst.',
          },
          {
            role: 'user',
            content:
              `Analyseer deze pagina van TenderNed (bronURL: ${bronUrl}).\n` +
              (importedNotice
                ? 'LET OP: dit betreft zeer waarschijnlijk een geïmporteerde aankondiging; de echte inschrijfdocumenten staan op Mercell (of Negometrix). Geef de volledige directe URL naar die aanbesteding op het externe platform.\n\n'
                : '') +
              `TEKST:\n${truncated}\n\n` +
              `Geef JSON terug met EXACT deze velden:\n` +
              `{\n` +
              `  "heeft_externe_documenten": true/false,\n` +
              `  "externe_platform": "mercell" | "negometrix" | "ted" | "anders" | null,\n` +
              `  "externe_url": "<volledige URL naar de aanbesteding op het externe platform, of null>",\n` +
              `  "mercell_url": "<volledige Mercell/Negometrix URL, of null>",\n` +
              `  "aanvullende_info": "<korte uitleg max 150 tekens>",\n` +
              `  "verwacht_aantal_documenten": <getal of null>,\n` +
              `  "zekerheid": "hoog" | "medium" | "laag"\n` +
              `}`,
          },
        ],
      }),
    })

    clearTimeout(timer)

    if (!res.ok) {
      log.warn(`LocationDetector OpenAI HTTP ${res.status}`)
      return null
    }

    const data = await res.json()
    const { input, output } = normalizeUsageFromApiBody(data)
    logTokenUsage('OpenAI', DETECTION_MODEL, input, output)
    const raw =
      ((data as Record<string, unknown>).choices as { message?: { content?: string } }[] | undefined)?.[0]
        ?.message?.content || '{}'
    const p = JSON.parse(raw) as Record<string, unknown>

    let mercellUrl =
      (typeof p.mercell_url === 'string' && p.mercell_url.trim()) ||
      (typeof p.externe_url === 'string' &&
      p.externe_url &&
      textMentionsMercell(p.externe_url as string)
        ? (p.externe_url as string).trim()
        : null)

    if (mercellUrl && !fullPageText.includes(mercellUrl)) {
      const fixed = normalizeMercellCandidate(mercellUrl)
      if (fixed && fullPageText.includes(fixed)) mercellUrl = fixed
      else if (importedNotice && fixed) mercellUrl = fixed
      else mercellUrl = null
    }

    let platform = String(p.externe_platform || '').toLowerCase() || (mercellUrl ? 'mercell' : 'none')
    if (mercellUrl && (platform === 'none' || platform === 'anders' || platform === '')) {
      platform = 'mercell'
    }

    return {
      platform: (['mercell', 'negometrix', 'ted', 'other'].includes(platform)
        ? platform
        : mercellUrl
          ? 'mercell'
          : 'other') as LocationDetectionResult['platform'],
      externalUrl: (p.externe_url as string) || mercellUrl,
      mercellUrl,
      additionalInfo: (p.aanvullende_info as string) || '',
      documentCount:
        typeof p.verwacht_aantal_documenten === 'number'
          ? p.verwacht_aantal_documenten
          : null,
      confidence:
        p.zekerheid === 'hoog'
          ? 'high'
          : p.zekerheid === 'medium'
            ? 'medium'
            : 'low',
    }
  } catch (e: unknown) {
    clearTimeout(timer)
    log.warn('LocationDetector OpenAI call failed:', e)
    return null
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect whether a TenderNed page references an external platform (Mercell etc.)
 * for its documents.
 *
 * @param fullPageText  Full scraped text of the TenderNed page (all tabs merged)
 * @param bronUrl       Original TenderNed URL (for context)
 * @param openaiApiKey  OpenAI API key for cloud detection (optional; regex fallback otherwise)
 */
export async function detectDocumentLocation(
  fullPageText: string,
  bronUrl: string,
  openaiApiKey?: string
): Promise<LocationDetectionResult> {
  const noResult: LocationDetectionResult = {
    platform: 'none',
    externalUrl: null,
    mercellUrl: null,
    additionalInfo: '',
    documentCount: null,
    confidence: 'low',
  }

  if (!fullPageText?.trim()) return noResult

  // Fast regex scan (always run first)
  const regexUrls = extractMercellUrls(fullPageText)
  const hasMercellText = textMentionsMercell(fullPageText)

  // If regex already found a definitive URL — use it (no AI needed)
  if (regexUrls.length > 0 && !openaiApiKey) {
    const best = pickPreferredMercellUrl(regexUrls)!
    log.info(`LocationDetector: Mercell URL via regex: ${best}`)
    return {
      platform: 'mercell',
      externalUrl: best,
      mercellUrl: best,
      additionalInfo: `Mercell URL gevonden via tekstanalyse`,
      documentCount: null,
      confidence: 'medium',
    }
  }

  // Neither regex hit nor text mention? Skip AI call (behalve geïmporteerde Mercell-melding: altijd nuttig om te proberen).
  if (!regexUrls.length && !hasMercellText && !openaiApiKey && !isTenderNedMercellImportedNotice(fullPageText)) {
    return noResult
  }

  // ── OpenAI cloud detection ──────────────────────────────────────────────
  if (openaiApiKey) {
    log.info(`LocationDetector: Calling OpenAI (${DETECTION_MODEL}) for ${bronUrl}`)
    const aiResult = await callOpenAIDetector(fullPageText, bronUrl, openaiApiKey)

    if (aiResult) {
      const bestRegex = pickPreferredMercellUrl(regexUrls)
      // Merge: voorkeur voor URL die letterlijk in de bron staat
      if (!aiResult.mercellUrl && bestRegex) {
        aiResult.mercellUrl = bestRegex
        aiResult.externalUrl = aiResult.externalUrl || bestRegex
        if (aiResult.platform === 'none') aiResult.platform = 'mercell'
        aiResult.confidence = 'medium'
      } else if (aiResult.mercellUrl && bestRegex) {
        const aiIn = fullPageText.includes(aiResult.mercellUrl)
        const regIn = fullPageText.includes(bestRegex)
        if (!aiIn && regIn) {
          aiResult.mercellUrl = bestRegex
          aiResult.externalUrl = bestRegex
          aiResult.confidence = 'medium'
        }
      }
      if (aiResult.mercellUrl && fullPageText.includes(aiResult.mercellUrl) && aiResult.confidence === 'low') {
        aiResult.confidence = 'medium'
      }
      log.info(
        `LocationDetector: platform=${aiResult.platform} url=${aiResult.mercellUrl} confidence=${aiResult.confidence}`
      )
      return aiResult
    }

    // AI failed → regex fallback
  }

  // Regex fallback
  if (regexUrls.length > 0) {
    const best = pickPreferredMercellUrl(regexUrls)!
    return {
      platform: 'mercell',
      externalUrl: best,
      mercellUrl: best,
      additionalInfo: `Mercell URL gevonden via tekstanalyse (AI niet beschikbaar)`,
      documentCount: null,
      confidence: 'medium',
    }
  }

  if (hasMercellText) {
    return {
      platform: 'mercell',
      externalUrl: null,
      mercellUrl: null,
      additionalInfo: 'Mercell/Negometrix vermeld in tekst maar geen directe URL gevonden',
      documentCount: null,
      confidence: 'low',
    }
  }

  return noResult
}
