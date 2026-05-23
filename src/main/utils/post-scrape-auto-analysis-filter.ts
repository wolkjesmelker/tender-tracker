import log from 'electron-log'
import { getDb } from '../db/connection'
import { geocodeAddressString, resolveTenderGeocodes } from '../geocoding/tender-geocoder'
import { isPostScrapeAnalyzeImmediatelyEnabled } from './post-scrape-analyze-setting'
import {
  MAP_RADIUS_STORAGE_KEY,
  MAP_SELECTED_PROFILE_STORAGE_KEY,
  tenderWorkAreaStatus,
} from '../../shared/tender-work-area'

export type WorkAreaPrefsFromDb = {
  active: boolean
  radiusKm: number
  profileId: string | null
}

export function readWorkAreaPrefsFromDb(): WorkAreaPrefsFromDb {
  const db = getDb()
  const rRow = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(MAP_RADIUS_STORAGE_KEY) as { value: string } | undefined
  const pRow = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(MAP_SELECTED_PROFILE_STORAGE_KEY) as { value: string } | undefined
  const parsed = parseInt(String(rRow?.value ?? '').trim(), 10)
  const radiusKm = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  const profileId = (pRow?.value ?? '').trim() || null
  return {
    active: radiusKm > 0 && profileId != null,
    radiusKm,
    profileId,
  }
}

async function resolveKantoorCoordsForProfile(profileId: string): Promise<[number, number] | null> {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT adres, postcode, stad, land FROM bedrijfsprofielen WHERE id = ?`,
    )
    .get(profileId) as
    | { adres: string | null; postcode: string | null; stad: string | null; land: string | null }
    | undefined
  if (!row) return null
  const hit = await geocodeAddressString(row.adres ?? undefined, row.postcode ?? undefined, row.stad ?? undefined, row.land ?? undefined)
  if (!hit || hit.lat == null || hit.lng == null) return null
  return [hit.lat, hit.lng]
}

/**
 * Bepaalt welke tender-id's na een scrape automatisch in de post-scrape AI-wachtrij horen.
 *
 * - Als "Verwerk meteen analyse" uit staat: geen id's.
 * - Als het werkgebied niet actief is (geen straal > 0 of geen profiel in app_settings): alle id's (bestaand gedrag).
 * - Als werkgebied actief is: alleen tenders waarvan de kaartlocatie binnen de straal ligt;
 *   ontbrekende coördinaten worden eerst via Nominatim geprobeerd. Buiten werkgebied of nog steeds
 *   geen locatie → niet automatisch (handmatige analyse op detailpagina).
 */
export async function filterTenderIdsForAutoPostScrapeAnalysis(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))]
  if (!unique.length) return []

  if (!isPostScrapeAnalyzeImmediatelyEnabled()) {
    log.info(
      `[post-scrape] Automatische AI uit (${unique.length} id's): instelling "Verwerk meteen analyse" staat uit.`,
    )
    return []
  }

  const prefs = readWorkAreaPrefsFromDb()
  if (!prefs.active) {
    log.info(
      `[post-scrape] Werkgebied niet actief (straal/profiel) — automatische analyse voor alle ${unique.length} id's.`,
    )
    return unique
  }

  const kantoorCoords = prefs.profileId ? await resolveKantoorCoordsForProfile(prefs.profileId) : null
  if (!kantoorCoords) {
    log.warn(
      '[post-scrape] Werkgebied ingesteld maar kantoor niet te geocoderen — automatische analyse voor alle id\'s (geen geografische filter).',
    )
    return unique
  }

  const idsMissingCoords = unique.filter((id) => {
    const row = getDb()
      .prepare('SELECT map_lat, map_lng FROM aanbestedingen WHERE id = ?')
      .get(id) as { map_lat: unknown; map_lng: unknown } | undefined
    const lat = row?.map_lat
    const lng = row?.map_lng
    return (
      lat == null ||
      lng == null ||
      Number.isNaN(Number(lat)) ||
      Number.isNaN(Number(lng))
    )
  })

  if (idsMissingCoords.length > 0) {
    log.info(
      `[post-scrape] Geocode ${idsMissingCoords.length} tender(s) voor werkgebied-check…`,
    )
    await resolveTenderGeocodes(idsMissingCoords)
  }

  const db = getDb()
  const inside: string[] = []
  const outside: string[] = []
  const noCoords: string[] = []

  for (const id of unique) {
    const row = db
      .prepare('SELECT map_lat, map_lng FROM aanbestedingen WHERE id = ?')
      .get(id) as { map_lat?: number | null; map_lng?: number | null } | undefined
    const st = tenderWorkAreaStatus(
      { map_lat: row?.map_lat ?? null, map_lng: row?.map_lng ?? null },
      kantoorCoords,
      prefs.radiusKm,
    )
    if (st === 'inside') inside.push(id)
    else if (st === 'outside') outside.push(id)
    else noCoords.push(id)
  }

  log.info(
    `[post-scrape] Werkgebied (${prefs.radiusKm} km): ${inside.length} automatisch, ${outside.length} buiten gebied, ${noCoords.length} zonder bruikbare locatie (handmatige analyse).`,
  )

  return inside
}
