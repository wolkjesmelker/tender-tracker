import log from 'electron-log'
import { getDb } from '../db/connection'
import { buildTenderGeocodeQuery } from '../../shared/tender-map-geocode-query'
import type { Aanbesteding } from '../../shared/types'

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'TenderTracker/1.0 (https://www.vandekreekegroep.nl; contact via Questric)'
const REQUEST_DELAY_MS = 1100 // Nominatim usage policy: max 1 req/s

export interface GeocodeResult {
  id: string
  lat: number | null
  lng: number | null
  country_code: string | null
  query: string | null
}

interface NominatimResponseEntry {
  lat?: string
  lon?: string
  display_name?: string
  address?: { country_code?: string }
}

let queueChain: Promise<void> = Promise.resolve()
let lastFetchAt = 0

async function rateLimitedNominatim(query: string, countryHint: 'nl' | 'be' | null): Promise<NominatimResponseEntry | null> {
  const wait = Math.max(0, REQUEST_DELAY_MS - (Date.now() - lastFetchAt))
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastFetchAt = Date.now()

  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    addressdetails: '1',
  })
  if (countryHint) params.set('countrycodes', countryHint)

  const url = `${NOMINATIM_BASE}?${params.toString()}`
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'nl,en;q=0.8',
      },
    })
    if (!res.ok) {
      log.warn(`[geocoder] Nominatim HTTP ${res.status} voor query="${query}"`)
      return null
    }
    const arr = (await res.json()) as NominatimResponseEntry[]
    if (!Array.isArray(arr) || arr.length === 0) return null
    return arr[0]
  } catch (e: unknown) {
    log.warn('[geocoder] Nominatim fetch fout:', e)
    return null
  }
}

function loadTender(id: string): Aanbesteding | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM aanbestedingen WHERE id = ?').get(id) as
    | (Aanbesteding & Record<string, unknown>)
    | undefined
  return row ?? null
}

function persistResult(id: string, lat: number, lng: number, query: string, countryCode: string | null): void {
  const db = getDb()
  db.prepare(
    `UPDATE aanbestedingen
     SET map_lat = ?, map_lng = ?, map_geocode_query = ?, map_geocode_at = datetime('now'), map_country_code = ?
     WHERE id = ?`,
  ).run(lat, lng, query, countryCode, id)
}

function persistFailure(id: string, query: string | null): void {
  const db = getDb()
  // We slaan de query óók op bij falen — voorkomt dat we elke run dezelfde query opnieuw proberen.
  db.prepare(
    `UPDATE aanbestedingen
     SET map_geocode_query = ?, map_geocode_at = datetime('now')
     WHERE id = ?`,
  ).run(query, id)
}

/**
 * Lost coördinaten op voor een lijst tender-id's. Tenders die al een geldige cache
 * hebben (en waarbij de query niet veranderd is) worden onmiddellijk teruggegeven.
 *
 * Verwerkt sequentieel met respect voor de 1 req/s policy. Voortgang via `onProgress`.
 */
export async function resolveTenderGeocodes(
  ids: string[],
  onProgress?: (data: { done: number; total: number; current?: string }) => void,
): Promise<GeocodeResult[]> {
  // Serialize across concurrent invocations om rate-limit te respecteren.
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const previous = queueChain
  queueChain = queueChain.then(() => gate)

  await previous

  try {
    const results: GeocodeResult[] = []
    let done = 0
    const total = ids.length

    for (const id of ids) {
      const tender = loadTender(id)
      if (!tender) {
        results.push({ id, lat: null, lng: null, country_code: null, query: null })
        done++
        onProgress?.({ done, total })
        continue
      }

      const built = buildTenderGeocodeQuery(tender)
      const newQuery = built?.query ?? null

      // Cache-hit als coördinaten bestaan en de query ongewijzigd is.
      if (
        tender.map_lat != null &&
        tender.map_lng != null &&
        (tender.map_geocode_query ?? null) === newQuery
      ) {
        results.push({
          id,
          lat: tender.map_lat,
          lng: tender.map_lng,
          country_code: tender.map_country_code ?? null,
          query: newQuery,
        })
        done++
        onProgress?.({ done, total })
        continue
      }

      if (!built) {
        // Geen bruikbare query — markeer als verwerkt zodat we niet blijven retryen.
        persistFailure(id, null)
        results.push({ id, lat: null, lng: null, country_code: null, query: null })
        done++
        onProgress?.({ done, total })
        continue
      }

      onProgress?.({ done, total, current: built.query })
      const hit = await rateLimitedNominatim(built.query, built.countryHint)
      if (!hit?.lat || !hit?.lon) {
        persistFailure(id, built.query)
        results.push({ id, lat: null, lng: null, country_code: built.countryHint, query: built.query })
        done++
        onProgress?.({ done, total })
        continue
      }
      const lat = Number(hit.lat)
      const lng = Number(hit.lon)
      const cc = (hit.address?.country_code || built.countryHint || '').toLowerCase() || null
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        persistFailure(id, built.query)
        results.push({ id, lat: null, lng: null, country_code: cc, query: built.query })
        done++
        onProgress?.({ done, total })
        continue
      }
      persistResult(id, lat, lng, built.query, cc)
      results.push({ id, lat, lng, country_code: cc, query: built.query })
      done++
      onProgress?.({ done, total })
    }

    return results
  } finally {
    release()
  }
}

/**
 * Geocodeer een vrij adres voor bijv. een bedrijfsprofiel.
 * Probeert meerdere query-varianten (van specifiek naar algemeen).
 * Geeft [lat, lng] terug of null als het adres niet gevonden wordt.
 */
export async function geocodeAddressString(
  adres: string | undefined,
  postcode: string | undefined,
  stad: string | undefined,
  land: string | undefined,
): Promise<{ lat: number; lng: number } | null> {
  const countryHint = (!land || /nederland/i.test(land)) ? 'nl' : /belgi/i.test(land) ? 'be' : null

  // Van specifiek naar algemeen: probeer 3 varianten
  const queries: string[] = []
  const full = [adres, postcode, stad, land].filter(Boolean).join(', ')
  if (full) queries.push(full)
  const withoutStreet = [postcode, stad, land].filter(Boolean).join(', ')
  if (withoutStreet && withoutStreet !== full) queries.push(withoutStreet)
  const cityOnly = [stad, land].filter(Boolean).join(', ')
  if (cityOnly && cityOnly !== withoutStreet) queries.push(cityOnly)

  for (const q of queries) {
    const hit = await rateLimitedNominatim(q, countryHint)
    if (hit?.lat && hit?.lon) {
      const lat = Number(hit.lat)
      const lng = Number(hit.lon)
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        log.info(`[geocoder] Bedrijfsadres gevonden: "${q}" → [${lat}, ${lng}]`)
        return { lat, lng }
      }
    }
    log.info(`[geocoder] Bedrijfsadres niet gevonden voor query: "${q}"`)
  }
  return null
}
