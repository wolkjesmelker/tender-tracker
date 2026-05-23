/** Zelfde sleutels als kaartpagina — straal (km) en gekozen bedrijfsprofiel voor kantoor. */
export const MAP_RADIUS_STORAGE_KEY = 'tendermap_rijafstand_km'
export const MAP_SELECTED_PROFILE_STORAGE_KEY = 'tendermap_selected_profiel_id'

/** Haversine-afstand in km tussen twee WGS84-punten. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

export function readMapRadiusKmFromStorage(): number {
  const saved = parseInt(localStorage.getItem(MAP_RADIUS_STORAGE_KEY) ?? '', 10)
  return Number.isFinite(saved) && saved > 0 ? saved : 0
}

export type TenderWorkAreaStatus = 'inactive' | 'no_coords' | 'inside' | 'outside'

export function tenderWorkAreaStatus(
  tender: { map_lat?: number | null; map_lng?: number | null },
  kantoorCoords: [number, number] | null,
  radiusKm: number,
): TenderWorkAreaStatus {
  if (radiusKm <= 0 || !kantoorCoords) return 'inactive'
  const lat = tender.map_lat
  const lng = tender.map_lng
  if (lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return 'no_coords'
  }
  const d = haversineKm(kantoorCoords[0], kantoorCoords[1], Number(lat), Number(lng))
  return d <= radiusKm ? 'inside' : 'outside'
}
