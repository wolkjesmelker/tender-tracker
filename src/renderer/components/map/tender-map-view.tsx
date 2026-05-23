import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip, useMap, Circle } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { TenderMapItem } from './tender-map-helpers'
import { createTenderScoreTriangleIcon, getScorePalette } from './tender-map-helpers'

interface TenderMapViewProps {
  items: TenderMapItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  flyToToken: number
  zoomToken?: number
  /** Rijafstand-cirkel: straal in km (0 = geen cirkel). */
  radiusKm?: number
  /** Als true: kaart toont alle items, zoom naar alles (niet naar straal). */
  toonAlles?: boolean
  kantoorCoords?: [number, number] | null
  kantoorNaam?: string
}

/** Standaard centreringspunt: tussen NL en BE. */
const DEFAULT_CENTER: L.LatLngExpression = [51.6, 5.3]
const DEFAULT_ZOOM = 7

/** Kantoor: vaste cirkel (zelfde stijl als legenda / screenshot). */
const KANTOOR_ICON = L.divIcon({
  className: '',
  html: `<div style="
    width:22px;height:22px;
    background:#2563eb;
    border:3px solid #fff;
    border-radius:50%;
    box-shadow:0 2px 8px rgba(0,0,0,.35);
  "></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

/** Altijd lichte basemap (ook bij app dark mode — leesbaarheid en contrast). */
const MAP_TILES = {
  url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
}

/** Minder gevoelig muiswiel: meer pixels nodig per zoomstap (Leaflet default is 60). */
function MapScrollWheelTuning() {
  const map = useMap()
  useEffect(() => {
    map.options.wheelPxPerZoomLevel = 110
  }, [map])
  return null
}

function TenderScoreMarker({
  item,
  isSelected,
  onSelect,
  flyToToken,
}: {
  item: TenderMapItem
  isSelected: boolean
  onSelect: () => void
  /** Alleen voor geselecteerde marker: opnieuw animeren bij herhaalde klik in het menu. */
  flyToToken: number
}) {
  const score = item.tender.totaal_score ?? null
  const icon = useMemo(
    () => createTenderScoreTriangleIcon(score, getScorePalette(score), isSelected),
    [score, isSelected, isSelected ? flyToToken : 0],
  )
  return (
    <Marker
      position={[item.tender.map_lat as number, item.tender.map_lng as number]}
      icon={icon}
      eventHandlers={{ click: () => onSelect() }}
    >
      <Tooltip
        direction="top"
        offset={[0, -12]}
        opacity={1}
        className="!rounded-lg !border-0 !bg-transparent !p-0 !shadow-none"
      >
        <MapPopupCard item={item} />
      </Tooltip>
    </Marker>
  )
}

function FlyToSelected({
  items,
  selectedId,
  flyToToken,
}: {
  items: TenderMapItem[]
  selectedId: string | null
  flyToToken: number
}) {
  const map = useMap()
  useEffect(() => {
    if (!selectedId) return
    const item = items.find((x) => x.tender.id === selectedId)
    if (!item || !item.hasCoords || item.tender.map_lat == null || item.tender.map_lng == null) return
    const z = map.getZoom()
    const targetZoom = Math.min(12, Math.max(z + 1, 10))
    map.flyTo([item.tender.map_lat, item.tender.map_lng], targetZoom, {
      duration: 1.35,
      easeLinearity: 0.45,
    })
  }, [flyToToken, selectedId, items, map])
  return null
}

/**
 * Past het kaartvenster aan:
 * - Werkgebied: centrummarker + stippellijn-cirkel — zoom zodat de volledige straal netjes in beeld is
 *   (zoals definie-screenshot), met alleen de gefilterde markers (binnen straal).
 * - «Toon alles»: zoom naar alle markers in `items` (ook buiten de cirkel); cirkel blijft zichtbaar.
 * Triggert ook op eerste load en wanneer kantoorcoördinaten binnenkomen (niet alleen op zoomToken).
 */
function MapViewportAutoFit({
  items,
  radiusKm,
  kantoorCoords,
  toonAlles,
  zoomToken,
}: {
  items: TenderMapItem[]
  radiusKm: number
  kantoorCoords: [number, number] | null
  toonAlles: boolean
  zoomToken: number
}) {
  const map = useMap()
  const itemsBoundsKey = useMemo(
    () =>
      items
        .filter((x) => x.hasCoords && x.tender.map_lat != null && x.tender.map_lng != null)
        .map((x) => `${x.tender.id}:${x.tender.map_lat}:${x.tender.map_lng}`)
        .sort()
        .join('|'),
    [items],
  )

  useEffect(() => {
    const zoomToAllMarkers = () => {
      const coords = items
        .filter((x) => x.hasCoords && x.tender.map_lat != null && x.tender.map_lng != null)
        .map((x) => [x.tender.map_lat as number, x.tender.map_lng as number] as [number, number])
      if (coords.length === 0) return
      if (coords.length === 1) {
        map.flyTo(coords[0], 10, { duration: 1.15, easeLinearity: 0.45 })
        return
      }
      map.flyToBounds(L.latLngBounds(coords), {
        padding: [52, 52],
        maxZoom: 11,
        duration: 1.15,
        easeLinearity: 0.45,
      })
    }

    const inCircleMode = radiusKm > 0 && kantoorCoords != null && !toonAlles

    if (inCircleMode) {
      const center = L.latLng(kantoorCoords[0], kantoorCoords[1])
      /* Leaflet toBounds(sizeInMeters): afstand midden → rand van het kader; lichte marge voor de stippellijn */
      const bounds = center.toBounds(radiusKm * 1000 * 1.14)
      map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 12, duration: 1.15, easeLinearity: 0.45 })
      return
    }

    zoomToAllMarkers()
  }, [
    map,
    zoomToken,
    toonAlles,
    radiusKm,
    kantoorCoords?.[0],
    kantoorCoords?.[1],
    itemsBoundsKey,
  ])

  return null
}

export function TenderMapView({
  items,
  selectedId,
  onSelect,
  flyToToken,
  zoomToken = 0,
  radiusKm = 0,
  toonAlles = false,
  kantoorCoords = null,
  kantoorNaam,
}: TenderMapViewProps) {
  const visible = useMemo(() => items.filter((x) => x.hasCoords), [items])
  const showRadius = radiusKm > 0 && kantoorCoords != null

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        minZoom={4}
        maxZoom={18}
        scrollWheelZoom
        zoomControl
        worldCopyJump
        className="h-full w-full"
        style={{ background: '#e8eef5' }}
      >
        <TileLayer
          url={MAP_TILES.url}
          attribution={MAP_TILES.attribution}
          subdomains={MAP_TILES.subdomains}
        />
        <MapScrollWheelTuning />
        <FlyToSelected items={visible} selectedId={selectedId} flyToToken={flyToToken} />
        <MapViewportAutoFit
          items={visible}
          radiusKm={radiusKm}
          kantoorCoords={kantoorCoords}
          toonAlles={toonAlles}
          zoomToken={zoomToken}
        />

        {/* Rijafstand-cirkel + kantoormarker */}
        {showRadius && kantoorCoords && (
          <>
            <Circle
              center={kantoorCoords}
              radius={radiusKm * 1000}
              pathOptions={{
                color: '#2563eb',
                fillColor: '#3b82f6',
                fillOpacity: 0.06,
                weight: 2,
                dashArray: '6 4',
              }}
            />
            <Marker position={kantoorCoords} icon={KANTOOR_ICON}>
              <Tooltip direction="top" offset={[0, -14]} permanent={false} opacity={1}>
                <div className="text-[11px] font-semibold text-zinc-800">
                  {kantoorNaam ?? 'Kantoor'}<br />
                  <span className="font-normal text-zinc-500">{radiusKm} km straal</span>
                </div>
              </Tooltip>
            </Marker>
          </>
        )}

        {visible.map((it) => (
          <TenderScoreMarker
            key={it.tender.id}
            item={it}
            isSelected={it.tender.id === selectedId}
            onSelect={() => onSelect(it.tender.id)}
            flyToToken={flyToToken}
          />
        ))}
      </MapContainer>

      {/* Legenda kantoor */}
      {showRadius && kantoorCoords && (
        <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white/90 px-2.5 py-1.5 text-[11px] shadow-md backdrop-blur-sm">
          <span
            className="inline-block h-3 w-3 rounded-full border-2 border-white shadow-sm"
            style={{ background: '#2563eb' }}
          />
          <span className="font-medium text-zinc-700">{kantoorNaam ?? 'Kantoor'}</span>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-500">{radiusKm} km straal</span>
        </div>
      )}
    </div>
  )
}

function MapPopupCard({ item }: { item: TenderMapItem }) {
  const score = item.tender.totaal_score ?? null
  const palette = getScorePalette(score)
  return (
    <div className="min-w-[220px] max-w-[280px] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-900 shadow-xl">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-bold ${palette.badge}`}
        >
          {score != null ? Math.round(score) : '—'}
        </span>
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">
          {item.plaats || 'Locatie onbekend'}
        </div>
      </div>
      <div className="mt-1.5 line-clamp-2 text-[12px] font-semibold leading-snug text-zinc-900">
        {item.tender.titel}
      </div>
      {item.tender.opdrachtgever && (
        <div className="mt-0.5 line-clamp-1 text-[11px] text-zinc-500">
          {item.tender.opdrachtgever}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-zinc-500">
        {item.bedragLabel && <span className="font-medium text-zinc-900">{item.bedragLabel}</span>}
        {item.startDatum && <span>Start {formatShortDate(item.startDatum)}</span>}
        {item.eindDatum && <span>Eind {formatShortDate(item.eindDatum)}</span>}
      </div>
    </div>
  )
}

function formatShortDate(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: '2-digit' })
}
