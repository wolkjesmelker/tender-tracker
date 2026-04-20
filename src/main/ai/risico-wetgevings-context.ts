import log from 'electron-log'
import path from 'path'
import fs from 'fs'
import { fetchWithRetry } from '../utils/http-resilience'
import { getAppDataPath } from '../utils/paths'

/** Canonieke bronnen (zoals in risicoprompt / praktijk); BWBR-nummers zijn actueel op wetten.nl. */
export const RISICO_WETGEVINGS_URLS = {
  aanbestedingswet2012: 'https://wetten.overheid.nl/BWBR0032203/',
  aanbestedingsbesluit: 'https://wetten.overheid.nl/BWBR0032919/',
  pianooAwThema: 'https://www.pianoo.nl/nl/regelgeving/aanbestedingswet-2012',
  pianooRegelgeving: 'https://www.pianoo.nl/nl/regelgeving',
  euPublicProcurementNl: 'https://single-market-economy.ec.europa.eu/single-market/public-procurement_nl',
} as const

const FETCH_TIMEOUT_MS = 25_000
const UA = 'TenderTracker/1.0 (risico-analyse; wetgevingsreferentie)'

/** 24u-cache voor het volledige referentiekader (4 bronnen samen). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_VERSION = 1
const CACHE_FILE_NAME = 'risico-wetgevings-context.json'
let memoryCache: { value: string; expiresAt: number; version: number } | null = null

function getCacheFilePath(): string | null {
  try {
    const dir = path.join(getAppDataPath(), 'cache')
    fs.mkdirSync(dir, { recursive: true })
    return path.join(dir, CACHE_FILE_NAME)
  } catch {
    return null
  }
}

function loadCache(): string | null {
  const now = Date.now()
  if (memoryCache && memoryCache.version === CACHE_VERSION && memoryCache.expiresAt > now) {
    return memoryCache.value
  }
  const file = getCacheFilePath()
  if (!file) return null
  try {
    if (!fs.existsSync(file)) return null
    const raw = fs.readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw) as { value?: string; expiresAt?: number; version?: number }
    if (
      !parsed ||
      typeof parsed.value !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.version !== CACHE_VERSION ||
      parsed.expiresAt <= now
    ) {
      return null
    }
    memoryCache = { value: parsed.value, expiresAt: parsed.expiresAt, version: CACHE_VERSION }
    return parsed.value
  } catch (e) {
    log.warn('[risico] Wetgevingscache lezen mislukt:', e)
    return null
  }
}

function saveCache(value: string): void {
  const expiresAt = Date.now() + CACHE_TTL_MS
  memoryCache = { value, expiresAt, version: CACHE_VERSION }
  const file = getCacheFilePath()
  if (!file) return
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({ value, expiresAt, version: CACHE_VERSION, savedAt: Date.now() }),
      'utf-8',
    )
  } catch (e) {
    log.warn('[risico] Wetgevingscache schrijven mislukt:', e)
  }
}

type BronConfig = {
  titel: string
  url: string
  extract: (html: string) => string
  maxChars: number
}

function stripHtmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return Number.isFinite(code) ? String.fromCharCode(code) : _
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  return s
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractWettenContent(html: string): string {
  const start = html.indexOf('<div id="content">')
  if (start === -1) return ''
  const foot = html.indexOf('<div class="footer row--footer"', start)
  const slice = foot > start ? html.slice(start, foot) : html.slice(start, start + 600_000)
  return stripHtmlToText(slice)
}

function extractPianooSection(html: string): string {
  const start = html.indexOf('<section id="content"')
  if (start === -1) return ''
  const foot = html.indexOf('<footer class="footer"', start)
  const slice = foot > start ? html.slice(start, foot) : html.slice(start, start + 400_000)
  return stripHtmlToText(slice)
}

function extractEuMain(html: string): string {
  const idIdx = html.indexOf('id="main-content"')
  if (idIdx === -1) return ''
  const mainStart = html.lastIndexOf('<main', idIdx)
  const foot = html.indexOf('<footer', idIdx)
  if (mainStart === -1 || foot === -1 || foot <= mainStart) return ''
  return stripHtmlToText(html.slice(mainStart, foot))
}

const BRONNEN: BronConfig[] = [
  {
    titel: 'Aanbestedingswet 2012 (wetten.nl, BWBR0032203)',
    url: RISICO_WETGEVINGS_URLS.aanbestedingswet2012,
    extract: extractWettenContent,
    maxChars: 9_000,
  },
  {
    titel: 'Aanbestedingsbesluit (wetten.nl, BWBR0032919)',
    url: RISICO_WETGEVINGS_URLS.aanbestedingsbesluit,
    extract: extractWettenContent,
    maxChars: 7_000,
  },
  {
    titel: 'PIANOo — thema Aanbestedingswet 2012',
    url: RISICO_WETGEVINGS_URLS.pianooAwThema,
    extract: extractPianooSection,
    maxChars: 4_500,
  },
  {
    titel: 'Europese Commissie — openbare aanbesteding (NL)',
    url: RISICO_WETGEVINGS_URLS.euPublicProcurementNl,
    extract: extractEuMain,
    maxChars: 3_500,
  },
]

async function fetchHtml(url: string): Promise<string> {
  const res = await fetchWithRetry(
    url,
    {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.5',
      },
    },
    {
      maxAttempts: 4,
      baseDelayMs: 900,
      maxDelayMs: 14_000,
      timeoutPerAttemptMs: FETCH_TIMEOUT_MS,
    },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n\n[… tekst ingekort i.v.m. contextlimiet; raadpleeg de volledige bron via de URL.]`
}

/**
 * Haalt actuele wet- en beleidsteksten op van de URLs in {@link RISICO_WETGEVINGS_URLS}
 * en bouwt een blok voor het model (ter ondersteuning van juridische duiding).
 * Faalt deels: ontbrekende bronnen worden vermeld met alleen de link.
 */
export async function fetchRisicoWetgevingsContext(): Promise<string> {
  const cached = loadCache()
  if (cached) {
    log.info('[risico] Wetgevingscontext uit 24u-cache (geen HTTP-calls).')
    return cached
  }

  const parts: string[] = [
    '=== REFERENTIEKADER WETGEVING & BELEID (automatisch opgehaald; ingekort) ===',
    'Alleen voor juridische kwalificatie / artikelverwijzing. Risico-feiten en citaten: uitsluitend uit tenderdocumenten in het gebruikersbericht.',
    'Verwijzing naar wet: artikel/beginsel + desgewijs bron_url in wetsartikelen_bijlage. Geen risico’s “bedenken” uit dit blok zonder steun in de stukken.',
    '',
  ]

  for (const b of BRONNEN) {
    try {
      const html = await fetchHtml(b.url)
      let text = b.extract(html)
      if (!text || text.length < 80) {
        text = stripHtmlToText(html).slice(0, b.maxChars)
      }
      if (!text || text.length < 40) {
        parts.push(`--- ${b.titel} ---`, `URL: ${b.url}`, '(Kon geen leesbare tekst extraheren; raadpleeg de URL handmatig.)', '')
        continue
      }
      parts.push(`--- ${b.titel} ---`, `URL: ${b.url}`, truncate(text, b.maxChars), '')
    } catch (e) {
      log.warn('[risico] Wetgevingsfetch mislukt:', b.url, e)
      parts.push(`--- ${b.titel} ---`, `URL: ${b.url}`, '(Ophalen mislukt; gebruik desgewijs de URL als bronverwijzing.)', '')
    }
  }

  parts.push(
    '--- Aanvullende verwijzingen (niet automatisch opgehaald) ---',
    `PIANOo regelgeving-overzicht: ${RISICO_WETGEVINGS_URLS.pianooRegelgeving}`,
    'Gids proportionaliteit en overige PIANOo-publicaties: via pianoo.nl onder Regelgeving / Thema’s.',
    '',
  )

  const rendered = parts.join('\n')
  saveCache(rendered)
  log.info(`[risico] Wetgevingscontext opnieuw opgebouwd (${rendered.length} tekens) en 24u gecachet.`)
  return rendered
}

/** Verwijdert de on-disk + in-memory cache (bijv. vanuit een instellingenknop). */
export function clearRisicoWetgevingsCache(): void {
  memoryCache = null
  const file = getCacheFilePath()
  if (!file) return
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch (e) {
    log.warn('[risico] Wetgevingscache verwijderen mislukt:', e)
  }
}
