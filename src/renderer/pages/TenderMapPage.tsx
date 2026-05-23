import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Loader2, MapPin, RefreshCw, Sparkles } from 'lucide-react'
import { api, isElectron } from '../lib/ipc-client'
import type { Aanbesteding, BedrijfsProfiel } from '../../shared/types'
import { TenderMapView } from '../components/map/tender-map-view'
import {
  TenderMapSidebar,
  areTenderMapFiltersDefault,
  DEFAULT_TENDER_MAP_FILTERS,
  type TenderMapFilters,
} from '../components/map/tender-map-sidebar'
import { buildTenderMapItem, type TenderMapItem } from '../components/map/tender-map-helpers'
import { parseEuroAmount } from '../../shared/parse-euro-amount'
import {
  haversineKm,
  MAP_RADIUS_STORAGE_KEY,
  MAP_SELECTED_PROFILE_STORAGE_KEY,
} from '../../shared/tender-work-area'

/** Geocodeer een adres via IPC (main-process Nominatim, met fallback-queries). */
async function geocodeAdresViaIpc(profiel: BedrijfsProfiel): Promise<[number, number] | null> {
  try {
    const result = await (api as any).geocodeAddress?.(
      profiel.adres,
      profiel.postcode,
      profiel.stad,
      profiel.land,
    ) as { lat: number; lng: number } | null | undefined
    if (result?.lat != null && result?.lng != null) return [result.lat, result.lng]
  } catch { /* negeer IPC-fouten */ }
  return null
}

function dateInRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true
  if (!value) return false
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return false
  if (from) {
    const f = new Date(from).getTime()
    if (Number.isFinite(f) && t < f) return false
  }
  if (to) {
    const x = new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1
    if (Number.isFinite(x) && t > x) return false
  }
  return true
}

export function TenderMapPage() {
  const [tenders, setTenders] = useState<Aanbesteding[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<TenderMapFilters>(() => {
    // Herstel opgeslagen straal bij opstart
    const savedKm = parseInt(localStorage.getItem(MAP_RADIUS_STORAGE_KEY) ?? '', 10)
    const rijafstandKm = Number.isFinite(savedKm) && savedKm > 0 ? savedKm : DEFAULT_TENDER_MAP_FILTERS.rijafstandKm
    return {
      ...DEFAULT_TENDER_MAP_FILTERS,
      countries: { ...DEFAULT_TENDER_MAP_FILTERS.countries },
      rijafstandKm,
    }
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flyToToken, setFlyToToken] = useState(0)
  const [zoomToken, setZoomToken] = useState(0)
  // Track vorige filter-waarden om te detecteren wanneer we moeten zoomen
  const prevRijafstandKm = useRef(0)
  const prevToonAlles = useRef(false)
  const [geoProgress, setGeoProgress] = useState<{ done: number; total: number; current?: string } | null>(
    null,
  )
  const [resolving, setResolving] = useState(false)
  const refreshAbortRef = useRef(false)

  // Bedrijfsprofielen & kantoorlocatie
  const [profielen, setProfielen] = useState<BedrijfsProfiel[]>([])
  const [selectedProfielId, setSelectedProfielId] = useState<string | null>(null)
  const [kantoorCoords, setKantoorCoords] = useState<[number, number] | null>(null)
  const [geocodingKantoor, setGeocodingKantoor] = useState(false)
  // Cache: profielId → coords (zodat we niet opnieuw geocoderen)
  const geoCache = useRef<Map<string, [number, number] | null>>(new Map())

  // Laad bedrijfsprofielen
  useEffect(() => {
    void (async () => {
      try {
        const rows = (await (api as any).getBedrijfsprofielen?.()) as BedrijfsProfiel[] | undefined
        if (rows?.length) {
          setProfielen(rows)
          const savedId = localStorage.getItem(MAP_SELECTED_PROFILE_STORAGE_KEY)?.trim()
          const pick =
            (savedId && rows.some((p) => p.id === savedId) ? rows.find((p) => p.id === savedId) : null) ??
            rows.find((p) => p.is_standaard) ??
            rows[0]
          setSelectedProfielId(pick.id)
        }
      } catch { /* geen profielen beschikbaar */ }
    })()
  }, [])

  useEffect(() => {
    if (!selectedProfielId) return
    localStorage.setItem(MAP_SELECTED_PROFILE_STORAGE_KEY, selectedProfielId)
    if (isElectron) {
      void api.setSetting(MAP_SELECTED_PROFILE_STORAGE_KEY, selectedProfielId)
    }
  }, [selectedProfielId])

  // Geocodeer kantooradres wanneer geselecteerde vestiging wijzigt
  const geocodeSelectedProfiel = useCallback(async (profielId: string) => {
    const profiel = profielen.find((p) => p.id === profielId)
    if (!profiel) return

    // Gebruik cache als beschikbaar
    const cacheKey = `${profiel.id}:${[profiel.adres, profiel.postcode, profiel.stad].join('|')}`
    if (geoCache.current.has(cacheKey)) {
      setKantoorCoords(geoCache.current.get(cacheKey) ?? null)
      return
    }

    setGeocodingKantoor(true)
    const coords = await geocodeAdresViaIpc(profiel)
    geoCache.current.set(cacheKey, coords)
    setKantoorCoords(coords)
    setGeocodingKantoor(false)
  }, [profielen])

  useEffect(() => {
    if (!selectedProfielId) return
    void geocodeSelectedProfiel(selectedProfielId)
  }, [selectedProfielId, geocodeSelectedProfiel])

  const selectedProfiel = useMemo(
    () => profielen.find((p) => p.id === selectedProfielId) ?? null,
    [profielen, selectedProfielId],
  )

  const loadTenders = async () => {
    setLoading(true)
    try {
      const rows = (await api.getTenders()) as Aanbesteding[]
      setTenders(rows)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTenders()
  }, [])

  useEffect(() => {
    if (!api.onResolveTenderMapGeocodesProgress) return
    const off = api.onResolveTenderMapGeocodesProgress((p) => setGeoProgress(p))
    return () => { off() }
  }, [])

  /** Standaard: geanalyseerd (score) en/of workflow gekwalificeerd. */
  const relevantToMap = useMemo(() => {
    return (tenders ?? []).filter(
      (t) => t.totaal_score != null || t.status === 'gekwalificeerd',
    )
  }, [tenders])

  const items: TenderMapItem[] = useMemo(() => relevantToMap.map(buildTenderMapItem), [relevantToMap])

  /** Trigger geocoding voor items die nog geen coords hebben. */
  useEffect(() => {
    if (!items.length) return
    if (refreshAbortRef.current) return
    const missing = items.filter((it) => !it.hasCoords).map((it) => it.tender.id)
    if (missing.length === 0) return

    let cancelled = false
    setResolving(true)
    setGeoProgress({ done: 0, total: missing.length })

    api
      .resolveTenderMapGeocodes(missing)
      .then(async () => {
        if (cancelled) return
        const fresh = (await api.getTenders()) as Aanbesteding[]
        if (cancelled) return
        setTenders(fresh)
      })
      .catch(() => { /* stilletjes negeren */ })
      .finally(() => {
        if (!cancelled) { setResolving(false); setGeoProgress(null) }
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((x) => `${x.tender.id}:${x.hasCoords ? 1 : 0}`).join('|')])

  const filtered = useMemo(() => {
    const min = filters.minScore
    const max = filters.maxScore
    const bMin = parseEuroAmount(filters.bedragMin)
    const bMax = parseEuroAmount(filters.bedragMax)
    const search = filters.search.trim().toLowerCase()
    const useRadiusFilter = filters.rijafstandKm > 0 && !filters.rijafstandToonAlles && kantoorCoords != null

    return items.filter((it) => {
      const score = it.tender.totaal_score ?? -1
      if (score < min || score > max) return false

      if (search) {
        const hay = `${it.tender.titel} ${it.tender.opdrachtgever ?? ''} ${it.plaats}`.toLowerCase()
        if (!hay.includes(search)) return false
      }

      if (!dateInRange(it.startDatum, filters.startFrom, filters.startTo)) return false
      if (!dateInRange(it.eindDatum, filters.eindFrom, filters.eindTo)) return false

      if (bMin != null && (it.bedrag == null || it.bedrag < bMin)) return false
      if (bMax != null && (it.bedrag == null || it.bedrag > bMax)) return false

      if (!filters.countries[it.countryGroup]) return false

      if (useRadiusFilter) {
        if (!it.hasCoords || it.tender.map_lat == null || it.tender.map_lng == null) return false
        const dist = haversineKm(kantoorCoords![0], kantoorCoords![1], it.tender.map_lat, it.tender.map_lng)
        if (dist > filters.rijafstandKm) return false
      }

      return true
    })
  }, [items, filters, kantoorCoords])

  const countCounts = useMemo(() => {
    let nl = 0; let be = 0; let overig = 0
    for (const it of items) {
      if (it.countryGroup === 'nl') nl++
      else if (it.countryGroup === 'be') be++
      else overig++
    }
    return { nl, be, overig }
  }, [items])

  const filtersAreActive = useMemo(() => !areTenderMapFiltersDefault(filters), [filters])

  // Trigger geanimeerde zoom bij wijziging van rijafstand of "toon alles"
  // Sla de straal ook op zodat hij bewaard blijft na heropstarten
  useEffect(() => {
    const kmChanged = filters.rijafstandKm !== prevRijafstandKm.current
    const toonAllesChanged = filters.rijafstandToonAlles !== prevToonAlles.current
    if (kmChanged || toonAllesChanged) {
      setZoomToken((t) => t + 1)
    }
    if (kmChanged) {
      if (filters.rijafstandKm > 0) {
        localStorage.setItem(MAP_RADIUS_STORAGE_KEY, String(filters.rijafstandKm))
        if (isElectron) {
          void api.setSetting(MAP_RADIUS_STORAGE_KEY, String(filters.rijafstandKm))
        }
      } else {
        localStorage.removeItem(MAP_RADIUS_STORAGE_KEY)
        if (isElectron) {
          void api.setSetting(MAP_RADIUS_STORAGE_KEY, '')
        }
      }
    }
    prevRijafstandKm.current = filters.rijafstandKm
    prevToonAlles.current = filters.rijafstandToonAlles
  }, [filters.rijafstandKm, filters.rijafstandToonAlles])

  const clearAllMapFilters = () => {
    setFilters({ ...DEFAULT_TENDER_MAP_FILTERS, countries: { ...DEFAULT_TENDER_MAP_FILTERS.countries } })
  }

  const onSelect = (id: string) => {
    setSelectedId(id)
    setFlyToToken((n) => n + 1)
  }

  const totalAnalysed = items.length
  const totalWithCoords = items.filter((x) => x.hasCoords).length

  return (
    <div className="flex min-h-[calc(100vh-9rem)] flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--card)] to-[var(--background)] px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)]/10 text-[var(--primary)]">
            <MapPin className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[var(--foreground)]">Aanbestedingen op de kaart</h1>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Standaard alle geanalyseerde en gekwalificeerde aanbestedingen in Nederland, België
              en omstreken. Klik een marker om geanimeerd naar de locatie te gaan.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SummaryChip label="Totaal" value={totalAnalysed} />
          <SummaryChip label="Op kaart" value={totalWithCoords} accent />
          <SummaryChip label="NL" value={countCounts.nl} />
          <SummaryChip label="BE" value={countCounts.be} />
          {countCounts.overig > 0 && <SummaryChip label="Overig" value={countCounts.overig} />}
          <button
            type="button"
            onClick={() => { refreshAbortRef.current = false; loadTenders() }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Vernieuwen
          </button>
        </div>
      </header>

      {(resolving || loading) && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-1.5 text-[11px] text-[var(--muted-foreground)] shadow-sm backdrop-blur">
          {loading ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /><span>Aanbestedingen laden…</span></>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 text-[var(--primary)]" />
              <span>Locaties opzoeken{geoProgress ? ` (${geoProgress.done}/${geoProgress.total})` : '…'}</span>
              {geoProgress?.current && (
                <span className="line-clamp-1 text-[var(--muted-foreground)]/80">· {geoProgress.current}</span>
              )}
            </>
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_360px]">
        <div className="relative min-h-[480px] lg:h-full">
          <TenderMapView
            items={filtered}
            selectedId={selectedId}
            onSelect={onSelect}
            flyToToken={flyToToken}
            zoomToken={zoomToken}
            radiusKm={filters.rijafstandKm}
            toonAlles={filters.rijafstandToonAlles}
            kantoorCoords={kantoorCoords}
            kantoorNaam={selectedProfiel ? `${selectedProfiel.naam}${selectedProfiel.stad ? ` — ${selectedProfiel.stad}` : ''}` : undefined}
          />
        </div>
        <div className="min-h-[480px] lg:h-full">
          <TenderMapSidebar
            items={filtered}
            total={totalAnalysed}
            filters={filters}
            setFilters={setFilters}
            onClearFilters={clearAllMapFilters}
            filtersAreActive={filtersAreActive}
            selectedId={selectedId}
            onSelect={onSelect}
            countCounts={countCounts}
            profielen={profielen}
            selectedProfielId={selectedProfielId}
            onSelectProfiel={setSelectedProfielId}
            geocodingKantoor={geocodingKantoor}
            kantoorCoords={kantoorCoords}
          />
        </div>
      </div>
    </div>
  )
}

function SummaryChip({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <div
      className={[
        'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium',
        accent
          ? 'border-[var(--primary)]/30 bg-[var(--primary)]/10 text-[var(--primary)]'
          : 'border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]',
      ].join(' ')}
    >
      <span className="uppercase tracking-wide">{label}</span>
      <span className="text-[var(--foreground)]">{value}</span>
    </div>
  )
}
