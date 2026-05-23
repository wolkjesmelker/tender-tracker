import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, ChevronUp, ExternalLink, FilterX, Loader2, MapPin, MapPinOff, Navigation, Search } from 'lucide-react'
import type { TenderMapItem } from './tender-map-helpers'
import { getScorePalette } from './tender-map-helpers'
import type { BedrijfsProfiel } from '../../../shared/types'

export interface TenderMapFilters {
  search: string
  minScore: number
  maxScore: number
  startFrom: string
  startTo: string
  eindFrom: string
  eindTo: string
  bedragMin: string
  bedragMax: string
  countries: { nl: boolean; be: boolean; overig: boolean }
  /** Maximale afstand (km, luchtlijn) van het kantoor. 0 = uitgeschakeld. */
  rijafstandKm: number
  /** Wanneer true: toon alle aanbestedingen, negeer rijafstand (cirkel blijft zichtbaar). */
  rijafstandToonAlles: boolean
}

export const DEFAULT_TENDER_MAP_FILTERS: TenderMapFilters = {
  search: '',
  minScore: 0,
  maxScore: 100,
  startFrom: '',
  startTo: '',
  eindFrom: '',
  eindTo: '',
  bedragMin: '',
  bedragMax: '',
  countries: { nl: true, be: true, overig: true },
  rijafstandKm: 0,
  rijafstandToonAlles: false,
}

export function areTenderMapFiltersDefault(f: TenderMapFilters): boolean {
  const d = DEFAULT_TENDER_MAP_FILTERS
  return (
    f.search === d.search &&
    f.minScore === d.minScore &&
    f.maxScore === d.maxScore &&
    f.startFrom === d.startFrom &&
    f.startTo === d.startTo &&
    f.eindFrom === d.eindFrom &&
    f.eindTo === d.eindTo &&
    f.bedragMin === d.bedragMin &&
    f.bedragMax === d.bedragMax &&
    f.countries.nl === d.countries.nl &&
    f.countries.be === d.countries.be &&
    f.countries.overig === d.countries.overig &&
    f.rijafstandKm === d.rijafstandKm &&
    f.rijafstandToonAlles === d.rijafstandToonAlles
  )
}

interface TenderMapSidebarProps {
  items: TenderMapItem[]
  total: number
  filters: TenderMapFilters
  setFilters: (next: TenderMapFilters) => void
  onClearFilters: () => void
  filtersAreActive: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  countCounts: { nl: number; be: number; overig: number }
  profielen: BedrijfsProfiel[]
  selectedProfielId: string | null
  onSelectProfiel: (id: string) => void
  geocodingKantoor: boolean
  kantoorCoords: [number, number] | null
}

function formatShortDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: '2-digit' })
}

export function TenderMapSidebar({
  items,
  total,
  filters,
  setFilters,
  onClearFilters,
  filtersAreActive,
  selectedId,
  onSelect,
  countCounts,
  profielen,
  selectedProfielId,
  onSelectProfiel,
  geocodingKantoor,
  kantoorCoords,
}: TenderMapSidebarProps) {
  const navigate = useNavigate()
  const [filtersOpen, setFiltersOpen] = useState(true)

  const set = <K extends keyof TenderMapFilters>(key: K, value: TenderMapFilters[K]) =>
    setFilters({ ...filters, [key]: value })

  return (
    <aside className="flex h-full w-full flex-col gap-3 overflow-hidden">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
        {/* Header — altijd zichtbaar, klik om in/uitklappen */}
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2.5 text-left"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Filters</h3>
            {filtersAreActive && !filtersOpen && (
              <span className="rounded-full bg-[var(--primary)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--primary-foreground)]">
                actief
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--muted-foreground)]">
              {items.length}/{total}
            </span>
            <ChevronUp
              className={`h-4 w-4 text-[var(--muted-foreground)] transition-transform duration-200 ${filtersOpen ? '' : 'rotate-180'}`}
            />
          </div>
        </button>

        {/* Inklapbaar gedeelte */}
        {filtersOpen && (
          <div className="border-t border-[var(--border)] p-3 pt-2.5">
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                type="search"
                value={filters.search}
                onChange={(e) => set('search', e.target.value)}
                placeholder="Zoek op titel, plaats of opdrachtgever"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-1.5 pl-8 pr-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]"
              />
            </div>

        <div className="grid grid-cols-2 gap-2">
          <NumField
            label="Score min"
            value={filters.minScore}
            onChange={(v) => set('minScore', v)}
            min={0}
            max={100}
          />
          <NumField
            label="Score max"
            value={filters.maxScore}
            onChange={(v) => set('maxScore', v)}
            min={0}
            max={100}
          />
          <DateField label="Start vanaf" value={filters.startFrom} onChange={(v) => set('startFrom', v)} />
          <DateField label="Start t/m" value={filters.startTo} onChange={(v) => set('startTo', v)} />
          <DateField label="Eind vanaf" value={filters.eindFrom} onChange={(v) => set('eindFrom', v)} />
          <DateField label="Eind t/m" value={filters.eindTo} onChange={(v) => set('eindTo', v)} />
          <TextField
            label="Bedrag min"
            value={filters.bedragMin}
            onChange={(v) => set('bedragMin', v)}
            placeholder="bv. 100000"
          />
          <TextField
            label="Bedrag max"
            value={filters.bedragMax}
            onChange={(v) => set('bedragMax', v)}
            placeholder="bv. 5000000"
          />
        </div>

        {/* Rijafstand filter */}
        <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <Navigation className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" />
            <span className="text-[11px] font-semibold text-[var(--foreground)]">Rijafstand kantoor</span>
          </div>

          {/* Vestiging selector */}
          {profielen.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                <Building2 className="h-3 w-3" />
                Vestiging
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedProfielId ?? ''}
                  onChange={(e) => onSelectProfiel(e.target.value)}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]"
                >
                  {profielen.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.naam}{p.stad ? ` — ${p.stad}` : ''}
                    </option>
                  ))}
                </select>
                {geocodingKantoor && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-[var(--muted-foreground)]" />
                )}
                {!geocodingKantoor && kantoorCoords && (
                  <span title="Locatie gevonden" className="text-emerald-500">
                    <MapPin className="h-3.5 w-3.5" />
                  </span>
                )}
                {!geocodingKantoor && !kantoorCoords && selectedProfielId && (
                  <span title="Locatie niet gevonden — controleer het adres in bedrijfsprofielen" className="text-amber-500">
                    <MapPin className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
              {!geocodingKantoor && !kantoorCoords && selectedProfielId && (
                <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                  Adres niet gevonden. Controleer het adres in Instellingen → Bedrijfsprofiel.
                </p>
              )}
            </div>
          )}
          {profielen.length === 0 && (
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Geen bedrijfsprofielen gevonden. Voeg er een toe via Instellingen → Bedrijfsprofiel.
            </p>
          )}

          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={500}
              step={5}
              value={filters.rijafstandKm || ''}
              onChange={(e) => {
                const n = Number(e.target.value)
                const km = Number.isFinite(n) && n > 0 ? Math.round(n) : 0
                setFilters({ ...filters, rijafstandKm: km, rijafstandToonAlles: km > 0 ? filters.rijafstandToonAlles : false })
              }}
              placeholder="km"
              disabled={!kantoorCoords && !geocodingKantoor}
              className="w-20 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)] disabled:opacity-40"
            />
            <span className="text-[11px] text-[var(--muted-foreground)]">
              {filters.rijafstandKm > 0
                ? `Toon binnen ${filters.rijafstandKm} km`
                : kantoorCoords ? 'Voer km in om te filteren' : '—'}
            </span>
          </div>
          {filters.rijafstandKm > 0 && kantoorCoords && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={filters.rijafstandToonAlles}
                onChange={(e) => set('rijafstandToonAlles', e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--primary)]"
              />
              <span className="text-[11px] text-[var(--muted-foreground)]">
                Toon alles (cirkel blijft zichtbaar)
              </span>
            </label>
          )}
          {filters.rijafstandKm > 0 && kantoorCoords && (
            <p className="text-[10px] text-[var(--muted-foreground)]/70">
              Op basis van luchtlijn vanuit het kantooradres.
            </p>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <CountryChip
            active={filters.countries.nl}
            onToggle={() => set('countries', { ...filters.countries, nl: !filters.countries.nl })}
            label="Nederland"
            flag="NL"
            count={countCounts.nl}
          />
          <CountryChip
            active={filters.countries.be}
            onToggle={() => set('countries', { ...filters.countries, be: !filters.countries.be })}
            label="België"
            flag="BE"
            count={countCounts.be}
          />
          <CountryChip
            active={filters.countries.overig}
            onToggle={() =>
              set('countries', { ...filters.countries, overig: !filters.countries.overig })
            }
            label="Overig"
            flag="…"
            count={countCounts.overig}
          />
        </div>

        {filtersAreActive && (
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-2 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]/70"
          >
            <FilterX className="h-3.5 w-3.5 shrink-0" />
            Wis alle filters
          </button>
        )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
        {items.length === 0 ? (
          <div className="p-6 text-center text-xs text-[var(--muted-foreground)]">
            <p>Geen aanbestedingen die voldoen aan de filters.</p>
            {total > 0 && filtersAreActive && (
              <p className="mt-2 text-[11px]">Gebruik <span className="font-medium text-[var(--foreground)]">Wis alle filters</span> hierboven om alles weer op de kaart te tonen.</p>
            )}
            {total === 0 && <p className="mt-1.5">Er zijn nog geen geanalyseerde of gekwalificeerde aanbestedingen.</p>}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {items.map((it) => {
              const score = it.tender.totaal_score ?? null
              const palette = getScorePalette(score)
              const isSelected = it.tender.id === selectedId
              return (
                <li key={it.tender.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(it.tender.id)}
                    className={[
                      'group flex w-full gap-3 px-3 py-2.5 text-left transition-colors',
                      isSelected
                        ? 'bg-[var(--accent)]/40'
                        : 'hover:bg-[var(--muted)]/50',
                    ].join(' ')}
                  >
                    <div
                      className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold ring-2 ${palette.badge} ${palette.ring}`}
                    >
                      {score != null ? Math.round(score) : '—'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <div className="line-clamp-2 text-xs font-semibold leading-snug text-[var(--foreground)]">
                          {it.tender.titel}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/aanbestedingen/${it.tender.id}`)
                          }}
                          title="Open detail"
                          className="rounded p-1 text-[var(--muted-foreground)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                        {it.hasCoords ? (
                          <MapPin className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <MapPinOff className="h-3 w-3 text-amber-500" />
                        )}
                        <span className="line-clamp-1">{it.plaats || 'Locatie onbekend'}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-[var(--muted-foreground)]">
                        {it.bedragLabel && (
                          <span className="font-medium text-[var(--foreground)]">{it.bedragLabel}</span>
                        )}
                        <span>Start {formatShortDate(it.startDatum)}</span>
                        <span>Eind {formatShortDate(it.eindDatum)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)))
        }}
        className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]"
      />
    </label>
  )
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]"
      />
    </label>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]"
      />
    </label>
  )
}

function CountryChip({
  active,
  onToggle,
  label,
  flag,
  count,
}: {
  active: boolean
  onToggle: () => void
  label: string
  flag: string
  count: number
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={[
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
        active
          ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
          : 'border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]',
      ].join(' ')}
    >
      <span className="font-mono text-[10px] tracking-wider">{flag}</span>
      <span>{label}</span>
      <span className="rounded-full bg-[var(--muted)] px-1.5 py-px text-[9px] font-medium text-[var(--muted-foreground)]">
        {count}
      </span>
    </button>
  )
}
