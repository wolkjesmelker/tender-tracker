import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTenders, useSources } from '../hooks/use-ipc'
import { api, isElectron } from '../lib/ipc-client'
import {
  getStatusLabel,
  getStatusColor,
  cn,
} from '../lib/utils'
import {
  CalendarRange,
  Loader2,
  Search,
  Filter,
  ArrowRight,
  ExternalLink,
  FileText,
  RotateCcw,
  X,
} from 'lucide-react'
import type { Aanbesteding } from '@shared/types'
import {
  getInschrijvingWindow,
  startOfLocalDay,
} from '../lib/tender-inschrijving-dates'

type QuickPreset =
  | ''
  | 'open'
  | 'expired'
  | 'deadline_next_7'
  | 'start_next_7'
  | 'published_last_7'
  | 'deadline_last_7'
  | 'missing_end'
  | 'missing_start'

type SortKey = 'end_asc' | 'end_desc' | 'start_asc' | 'start_desc' | 'title' | 'created_desc'

function parseIsoDateInput(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const [y, m, d] = t.split('-').map((x) => parseInt(x, 10))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d).getTime()
}

function addDaysLocal(base: Date, days: number): Date {
  const x = new Date(base)
  x.setDate(x.getDate() + days)
  return x
}

function matchesQuickPreset(
  preset: QuickPreset,
  start: Date | null,
  end: Date | null,
  now: Date
): boolean {
  const today0 = startOfLocalDay(now)
  const in7 = startOfLocalDay(addDaysLocal(now, 7))
  const ago7 = startOfLocalDay(addDaysLocal(now, -7))

  switch (preset) {
    case '':
      return true
    case 'open':
      if (!end) return true
      return startOfLocalDay(end) >= today0
    case 'expired':
      if (!end) return false
      return startOfLocalDay(end) < today0
    case 'deadline_next_7':
      if (!end) return false
      const e0 = startOfLocalDay(end)
      return e0 >= today0 && e0 <= in7
    case 'start_next_7':
      if (!start) return false
      const s0 = startOfLocalDay(start)
      return s0 >= today0 && s0 <= in7
    case 'published_last_7':
      if (!start) return false
      const ps = startOfLocalDay(start)
      return ps >= ago7 && ps <= today0
    case 'deadline_last_7':
      if (!end) return false
      const pe = startOfLocalDay(end)
      return pe >= ago7 && pe < today0
    case 'missing_end':
      return !end
    case 'missing_start':
      return !start
    default:
      return true
  }
}

export function TenderCalendarPage() {
  const { data: tenders, loading, refresh } = useTenders({ showVerlopen: 'all' })
  const { data: sources } = useSources()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [bronFilter, setBronFilter] = useState('')
  const [quickPreset, setQuickPreset] = useState<QuickPreset>('')
  const [startFrom, setStartFrom] = useState('')
  const [startTo, setStartTo] = useState('')
  const [endFrom, setEndFrom] = useState('')
  const [endTo, setEndTo] = useState('')
  const [origin, setOrigin] = useState<'all' | 'scraped' | 'upload'>('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [minScore, setMinScore] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('end_asc')

  const [detail, setDetail] = useState<Aanbesteding | null>(null)

  const typeOptions = useMemo(() => {
    const set = new Set<string>()
    for (const t of (tenders as Aanbesteding[]) || []) {
      const v = t.type_opdracht?.trim()
      if (v) set.add(v)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'nl'))
  }, [tenders])

  const filteredSorted = useMemo(() => {
    const list = [...(((tenders as Aanbesteding[]) || []) as Aanbesteding[])]
    const now = new Date()
    const sf = parseIsoDateInput(startFrom)
    const st = parseIsoDateInput(startTo)
    const ef = parseIsoDateInput(endFrom)
    const et = parseIsoDateInput(endTo)
    const minS = minScore.trim() === '' ? null : Number(minScore)

    const out = list.filter((row) => {
      const w = getInschrijvingWindow(row)

      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const hay = `${row.titel} ${row.opdrachtgever ?? ''} ${row.referentienummer ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (statusFilter && row.status !== statusFilter) return false
      if (bronFilter && row.bron_website_id !== bronFilter) return false
      if (origin === 'scraped' && row.is_upload) return false
      if (origin === 'upload' && !row.is_upload) return false
      if (typeFilter && (row.type_opdracht || '') !== typeFilter) return false
      if (minS != null && !Number.isNaN(minS)) {
        if (row.totaal_score == null || row.totaal_score < minS) return false
      }

      if (!matchesQuickPreset(quickPreset, w.start, w.end, now)) return false

      if (sf != null && w.start && startOfLocalDay(w.start) < sf) return false
      if (st != null && w.start && startOfLocalDay(w.start) > st) return false
      if (ef != null && w.end && startOfLocalDay(w.end) < ef) return false
      if (et != null && w.end && startOfLocalDay(w.end) > et) return false

      return true
    })

    out.sort((a, b) => {
      const wa = getInschrijvingWindow(a)
      const wb = getInschrijvingWindow(b)
      switch (sortKey) {
        case 'end_asc':
          return (wa.end?.getTime() ?? Infinity) - (wb.end?.getTime() ?? Infinity)
        case 'end_desc':
          return (wb.end?.getTime() ?? -Infinity) - (wa.end?.getTime() ?? -Infinity)
        case 'start_asc':
          return (wa.start?.getTime() ?? Infinity) - (wb.start?.getTime() ?? Infinity)
        case 'start_desc':
          return (wb.start?.getTime() ?? -Infinity) - (wa.start?.getTime() ?? -Infinity)
        case 'title':
          return (a.titel || '').localeCompare(b.titel || '', 'nl', { sensitivity: 'base' })
        case 'created_desc':
        default: {
          const ca = new Date(a.created_at || 0).getTime()
          const cb = new Date(b.created_at || 0).getTime()
          return cb - ca
        }
      }
    })

    return out
  }, [
    tenders,
    search,
    statusFilter,
    bronFilter,
    quickPreset,
    startFrom,
    startTo,
    endFrom,
    endTo,
    origin,
    typeFilter,
    minScore,
    sortKey,
  ])

  const hasActiveFilters =
    search ||
    statusFilter ||
    bronFilter ||
    quickPreset ||
    startFrom ||
    startTo ||
    endFrom ||
    endTo ||
    origin !== 'all' ||
    typeFilter ||
    minScore ||
    sortKey !== 'end_asc'

  const resetFilters = () => {
    setSearch('')
    setStatusFilter('')
    setBronFilter('')
    setQuickPreset('')
    setStartFrom('')
    setStartTo('')
    setEndFrom('')
    setEndTo('')
    setOrigin('all')
    setTypeFilter('')
    setMinScore('')
    setSortKey('end_asc')
  }

  const openBron = (url?: string | null) => {
    const u = url?.trim()
    if (!u) return
    if (isElectron) void api.openExternal(u)
    else window.open(u, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--foreground)] flex items-center gap-2">
            <CalendarRange className="h-6 w-6 text-[var(--primary)]" aria-hidden />
            Aanbestedingskalender
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)] max-w-2xl">
            Overzicht van publicatie- en sluitingsdata van gescrapete en geïmporteerde aanbestedingen.
            Klik op een kaart voor details en een link naar de volledige record.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="shrink-0 rounded-lg border bg-[var(--card)] px-3 py-2 text-sm hover:bg-[var(--muted)]"
        >
          Vernieuwen
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border bg-[var(--card)] p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-[var(--muted-foreground)]" aria-hidden />
          <span className="text-sm font-medium text-[var(--foreground)]">Filters</span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="ml-auto inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Wis filters
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoek titel, opdrachtgever, ref…"
              className="w-full rounded-lg border bg-[var(--background)] py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
          >
            <option value="">Alle statussen</option>
            <option value="gevonden">Gevonden</option>
            <option value="gekwalificeerd">Gekwalificeerd</option>
            <option value="in_aanbieding">In aanbieding</option>
            <option value="afgewezen">Afgewezen</option>
            <option value="gearchiveerd">Gearchiveerd</option>
          </select>
          <select
            value={bronFilter}
            onChange={(e) => setBronFilter(e.target.value)}
            className="rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
          >
            <option value="">Alle bronnen</option>
            {(sources as { id: string; naam: string }[] | null)?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.naam}
              </option>
            ))}
          </select>
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value as typeof origin)}
            className="rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
          >
            <option value="all">Alle herkomst</option>
            <option value="scraped">Alleen gescraped</option>
            <option value="upload">Alleen upload</option>
          </select>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Snelkeuze
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: '' as const, label: 'Geen' },
                { id: 'open' as const, label: 'Nog open (geen verstreken sluiting)' },
                { id: 'expired' as const, label: 'Verlopen' },
                { id: 'deadline_next_7' as const, label: 'Sluit komende 7 dagen' },
                { id: 'start_next_7' as const, label: 'Start inschrijving komende 7 dagen' },
                { id: 'published_last_7' as const, label: 'Gepubliceerd laatste 7 dagen' },
                { id: 'deadline_last_7' as const, label: 'Gesloten laatste 7 dagen' },
                { id: 'missing_end' as const, label: 'Zonder sluitingsdatum' },
                { id: 'missing_start' as const, label: 'Zonder publicatiedatum' },
              ] as const
            ).map((chip) => (
              <button
                key={chip.id || 'none'}
                type="button"
                onClick={() => setQuickPreset(chip.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  quickPreset === chip.id
                    ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                    : 'border-transparent bg-[var(--muted)] text-[var(--foreground)] hover:bg-[var(--muted)]/80'
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <fieldset className="rounded-xl border border-dashed p-3 space-y-2">
            <legend className="px-1 text-xs font-medium text-[var(--muted-foreground)]">
              Start inschrijving (publicatie)
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-[var(--muted-foreground)]">
                Van
                <input
                  type="date"
                  value={startFrom}
                  onChange={(e) => setStartFrom(e.target.value)}
                  className="mt-1 w-full rounded-lg border bg-[var(--background)] px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-[var(--muted-foreground)]">
                Tot en met
                <input
                  type="date"
                  value={startTo}
                  onChange={(e) => setStartTo(e.target.value)}
                  className="mt-1 w-full rounded-lg border bg-[var(--background)] px-2 py-1.5 text-sm"
                />
              </label>
            </div>
          </fieldset>
          <fieldset className="rounded-xl border border-dashed p-3 space-y-2">
            <legend className="px-1 text-xs font-medium text-[var(--muted-foreground)]">
              Einde inschrijving (sluiting)
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-[var(--muted-foreground)]">
                Van
                <input
                  type="date"
                  value={endFrom}
                  onChange={(e) => setEndFrom(e.target.value)}
                  className="mt-1 w-full rounded-lg border bg-[var(--background)] px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-[var(--muted-foreground)]">
                Tot en met
                <input
                  type="date"
                  value={endTo}
                  onChange={(e) => setEndTo(e.target.value)}
                  className="mt-1 w-full rounded-lg border bg-[var(--background)] px-2 py-1.5 text-sm"
                />
              </label>
            </div>
          </fieldset>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-[var(--muted-foreground)]">
            Type opdracht
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="">Alle types</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted-foreground)]">
            Min. score
            <input
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              placeholder="—"
              className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-[var(--muted-foreground)]">
            Sortering
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="end_asc">Sluitingsdatum (oplopend)</option>
              <option value="end_desc">Sluitingsdatum (aflopend)</option>
              <option value="start_asc">Publicatiedatum (oplopend)</option>
              <option value="start_desc">Publicatiedatum (aflopend)</option>
              <option value="title">Titel (A–Z)</option>
              <option value="created_desc">Laatst toegevoegd</option>
            </select>
          </label>
        </div>

        <p className="text-xs text-[var(--muted-foreground)]">
          {loading ? 'Laden…' : `${filteredSorted.length} van ${(tenders as unknown[])?.length ?? 0} aanbestedingen`}
        </p>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-[var(--primary)]" />
        </div>
      ) : filteredSorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-[var(--muted)]/30 py-16 text-center text-sm text-[var(--muted-foreground)]">
          Geen aanbestedingen voor deze filters. Pas de filters aan of wis ze.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredSorted.map((row) => {
            const w = getInschrijvingWindow(row)
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => setDetail(row)}
                className="group text-left rounded-2xl border bg-gradient-to-br from-[var(--primary)]/[0.06] via-[var(--card)] to-[var(--card)] p-5 shadow-sm transition-all hover:shadow-md hover:border-[var(--primary)]/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--foreground)] group-hover:text-[var(--primary)]">
                    {row.titel}
                  </h2>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      getStatusColor(row.status)
                    )}
                  >
                    {getStatusLabel(row.status)}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap items-end gap-3 text-sm text-[var(--foreground)]">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                      Publicatie
                    </p>
                    <span className="mt-0.5 inline-block rounded-lg bg-[var(--muted)]/80 px-2.5 py-1 font-medium tabular-nums">
                      {w.startDisplay}
                    </span>
                  </div>
                  <ArrowRight className="mb-1.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                      Sluiting
                    </p>
                    <span className="mt-0.5 inline-block rounded-lg bg-[var(--muted)]/80 px-2.5 py-1 font-medium tabular-nums">
                      {w.endDisplay}
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-xs text-[var(--muted-foreground)] line-clamp-1">
                  {row.bron_website_naam || (row.is_upload ? 'Upload' : 'Onbekende bron')}
                  {row.opdrachtgever ? ` · ${row.opdrachtgever}` : ''}
                </p>
              </button>
            )
          })}
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setDetail(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border bg-[var(--card)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  Inschrijving
                </p>
                <h2 className="mt-1 text-base font-semibold text-[var(--foreground)] leading-snug">
                  {detail.titel}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded-lg p-2 hover:bg-[var(--muted)]"
                aria-label="Sluiten"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border bg-[var(--background)] p-3">
                  <p className="text-xs text-[var(--muted-foreground)]">Start inschrijving</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">
                    {getInschrijvingWindow(detail).startDisplay}
                  </p>
                </div>
                <div className="rounded-xl border bg-[var(--background)] p-3">
                  <p className="text-xs text-[var(--muted-foreground)]">Einde inschrijving</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">
                    {getInschrijvingWindow(detail).endDisplay}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Waarden zijn afgeleid uit opgeslagen publicatie- en sluitingsdata (eventueel aangevuld via TenderNed/API of AI).
              </p>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Link
                  to={`/aanbestedingen/${detail.id}`}
                  onClick={() => setDetail(null)}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
                >
                  <FileText className="h-4 w-4" />
                  Volledige aanbesteding
                </Link>
                {detail.bron_url?.trim() ? (
                  <button
                    type="button"
                    onClick={() => openBron(detail.bron_url)}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium hover:bg-[var(--muted)]"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Bronpagina
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
