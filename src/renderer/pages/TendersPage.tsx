import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTenders, useSources } from '../hooks/use-ipc'
import { api } from '../lib/ipc-client'
import { formatDate, getStatusLabel, getStatusColor, daysUntil } from '../lib/utils'
import {
  Search, Download, Brain, Loader2, CheckCircle2, XCircle,
  CalendarDays, FileText, CheckSquare, Square, RotateCcw, Trash2, Layers, ShieldAlert,
  FileCheck, MessageSquare, Send, Eye, UserCheck, Archive, PenSquare, Hash,
} from 'lucide-react'
import { DeleteConfirmationModal } from '../components/delete-confirmation-modal'
import { useAnalysisActiveStore } from '../stores/analysis-active-store'
import { useThemeStore } from '../stores/theme-store'

type TenderSortOrder = 'created_desc' | 'deadline_asc' | 'score_desc'

function sluitingsdatumTime(raw: unknown): number | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? null : t
}

const PIPELINE_STEPS = [
  { icon: FileText,      label: 'Publicatie',   tooltip: 'Publicatiegegevens & tijdslijn',        tab: 'overzicht' },
  { icon: FileCheck,     label: 'Documenten',   tooltip: 'Aanbestedingsdocumenten & bijlagen',    tab: 'overzicht' },
  { icon: MessageSquare, label: 'Vragen',        tooltip: 'Nota van inlichtingen & Q&A',          tab: 'inschrijving' },
  { icon: Send,          label: 'Inschrijving',  tooltip: 'Indieningsvereisten & procedure',      tab: 'inschrijving' },
  { icon: Eye,           label: 'Beoordeling',   tooltip: 'Gunningscriteria & risico-analyse',    tab: 'risico' },
  { icon: UserCheck,     label: 'Gunning',       tooltip: 'Gunningsbeslissing & uitkomst',        tab: 'inschrijving' },
  { icon: Archive,       label: 'Archief',       tooltip: 'Gearchiveerde aanbesteding',           tab: 'overzicht' },
  { icon: PenSquare,     label: 'Afgerond',      tooltip: 'Afgeronde aanbesteding',               tab: 'overzicht' },
]

function getActiveStep(status: string): number {
  switch (status) {
    case 'gevonden':      return 0
    case 'gekwalificeerd': return 5
    case 'in_aanbieding': return 3
    case 'afgewezen':     return 6
    case 'gearchiveerd':  return 6
    default:              return 0
  }
}

function getCountryFlag(naam?: string, url?: string): string {
  const s = ((naam ?? '') + ' ' + (url ?? '')).toLowerCase()
  if (s.includes('.be') || s.includes('belgi') || s.includes('publicprocurement') || s.includes('e-procurement.be')) return '🇧🇪'
  if (
    s.includes('.nl') || s.includes('nederland') ||
    s.includes('tenderned') || s.includes('aanbesteding') ||
    s.includes('negometrix') || s.includes('mercell.nl') ||
    s.includes('tenderportal') || s.includes('pianoo')
  ) return '🇳🇱'
  if (s.includes('.de') || s.includes('deutsch')) return '🇩🇪'
  if (s.includes('.fr') || s.includes('france')) return '🇫🇷'
  return ''
}

export function TendersPage() {
  const isDark = useThemeStore((s) => s.dark)
  const [searchParams, setSearchParams] = useSearchParams()
  /** Na `?filter=…` uit de URL te hebben gelezen en de URL te wissen, blijft dit de actieve KPI-filter voor de API (anders verliest `urgentOnly` / `createdToday` direct weer). */
  const [dashboardKpiFilter, setDashboardKpiFilter] = useState<string | null>(null)
  const filterFromUrl = searchParams.get('filter')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [bronFilter, setBronFilter] = useState('')
  const [minScore, setMinScore] = useState<number | undefined>()
  const [verlopenFilter, setVerlopenFilter] = useState<string>('active')
  const [sortOrder, setSortOrder] = useState<TenderSortOrder>('created_desc')
  const [dashboardLabel, setDashboardLabel] = useState('')

  const resetFilters = () => {
    setSearch('')
    setStatusFilter('')
    setBronFilter('')
    setMinScore(undefined)
    setVerlopenFilter('active')
    setSortOrder('created_desc')
    setDashboardLabel('')
    setDashboardKpiFilter(null)
  }

  // Apply dashboard KPI filter when URL contains ?filter=…
  useEffect(() => {
    if (!filterFromUrl) return
    resetFilters()
    switch (filterFromUrl) {
      case 'all':
        setVerlopenFilter('all')
        setDashboardLabel('Totaal aanbestedingen')
        setDashboardKpiFilter(null)
        break
      case 'active':
        setVerlopenFilter('active')
        setDashboardLabel('Actieve aanbestedingen')
        setDashboardKpiFilter(null)
        break
      case 'today':
        setVerlopenFilter('all')
        setDashboardLabel('Gevonden vandaag')
        setDashboardKpiFilter('today')
        break
      case 'urgent':
        setVerlopenFilter('active')
        setDashboardLabel('Urgente deadlines (< 7 dagen)')
        setDashboardKpiFilter('urgent')
        break
    }
    setSearchParams({}, { replace: true })
  }, [filterFromUrl])

  const { data: tenders, loading, refresh } = useTenders({
    search: search || undefined,
    status: statusFilter || undefined,
    bron_website_id: bronFilter || undefined,
    minScore,
    showVerlopen: verlopenFilter === 'verlopen' ? true : verlopenFilter === 'all' ? 'all' : undefined,
    ...(dashboardKpiFilter === 'today' ? { createdToday: true } : {}),
    ...(dashboardKpiFilter === 'urgent' ? { urgentOnly: true } : {}),
  })
  const { data: sources } = useSources()

  const navigate = useNavigate()

  const hasActiveFilters =
    search ||
    statusFilter ||
    bronFilter ||
    minScore !== undefined ||
    verlopenFilter !== 'active' ||
    sortOrder !== 'created_desc' ||
    dashboardLabel ||
    dashboardKpiFilter

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<
    null | { kind: 'bulk' } | { kind: 'single'; id: string; titel: string }
  >(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const [singleAnalysisRunning, setSingleAnalysisRunning] = useState(false)
  const [singleAnalysisStep, setSingleAnalysisStep] = useState('')
  const [batchProgress, setBatchProgress] = useState<{ current: number, total: number, step: string, done?: boolean, errors?: string[] } | null>(null)

  const allTenders = useMemo(() => {
    const list = [...((tenders as any[]) || [])]
    if (sortOrder === 'created_desc') {
      list.sort((a: any, b: any) => {
        const ta = new Date(a.created_at || 0).getTime()
        const tb = new Date(b.created_at || 0).getTime()
        if (tb !== ta) return tb - ta
        return (b.totaal_score ?? -1) - (a.totaal_score ?? -1)
      })
    } else if (sortOrder === 'deadline_asc') {
      list.sort((a: any, b: any) => {
        const pa = sluitingsdatumTime(a.sluitingsdatum)
        const pb = sluitingsdatumTime(b.sluitingsdatum)
        if (pa === null && pb === null) return 0
        if (pa === null) return 1
        if (pb === null) return -1
        return pa - pb
      })
    } else if (sortOrder === 'score_desc') {
      list.sort((a: any, b: any) => (b.totaal_score ?? -1) - (a.totaal_score ?? -1))
    }
    return list
  }, [tenders, sortOrder])

  // Actieve analyse-statussen per tender uit de globale store
  const activeAnalyses = useAnalysisActiveStore((s) => s.active)

  // Listen for batch progress (works even after navigation back to this page)
  useEffect(() => {
    let cancelled = false
    const syncSingleRunning = async () => {
      const status = (await api.getBatchStatus?.()) as { singleRunning?: boolean } | undefined
      if (cancelled || !status) return
      const sr = Boolean(status.singleRunning)
      setSingleAnalysisRunning(sr)
      if (!sr) setSingleAnalysisStep('')
    }

    api.getBatchStatus?.().then((status: any) => {
      if (status?.running) {
        setBatchRunning(true)
        setBatchProgress({
          current: status.current,
          total: status.total,
          step: `Analyseren ${status.current}/${status.total}: ${status.currentTitle}`,
        })
      }
      setSingleAnalysisRunning(Boolean(status?.singleRunning))
    })

    void syncSingleRunning()
    const interval = setInterval(() => void syncSingleRunning(), 700)

    const unsub = api.onAnalysisProgress?.((data: any) => {
      if (data.batch) {
        setBatchProgress({ current: data.current, total: data.total, step: data.step, done: data.done, errors: data.errors })
        if (data.done) {
          setBatchRunning(false)
          refresh()
        }
      } else if (typeof data.step === 'string' && data.step.trim()) {
        setSingleAnalysisStep(data.step.trim())
      }
      void syncSingleRunning()
    })
    return () => {
      cancelled = true
      clearInterval(interval)
      unsub?.()
    }
  }, [])

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === allTenders.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(allTenders.map((t: any) => t.id)))
    }
  }

  const handleBatchAnalyze = async () => {
    if (selected.size === 0) return
    setBatchRunning(true)
    setBatchProgress({ current: 0, total: selected.size, step: 'Batch-analyse starten...' })

    const result = await api.startBatchAnalysis?.([...selected])
    if (result && !result.success) {
      setBatchRunning(false)
      setBatchProgress({ current: 0, total: 0, step: `Fout: ${result.error}`, errors: [result.error] })
    }
    // Don't clear selected yet - batch runs in background
  }

  const handleBatchAnalyzeAllActive = async () => {
    setBatchRunning(true)
    setBatchProgress({ current: 0, total: 1, step: 'Actieve aanbestedingen met bron-URL verzamelen…' })
    const result = (await api.startBatchAnalysisAll?.()) as { success?: boolean; error?: string; total?: number } | null
    if (result && !result.success) {
      setBatchRunning(false)
      setBatchProgress({
        current: 0,
        total: 0,
        step: `Fout: ${result.error || 'Onbekend'}`,
        errors: [result.error || 'Onbekend'],
      })
    }
  }

  const executeDelete = async () => {
    if (!pendingDelete) return
    setDeleteLoading(true)
    try {
      if (pendingDelete.kind === 'bulk') {
        await api.deleteTenders([...selected])
        setSelected(new Set())
      } else {
        await api.deleteTender(pendingDelete.id)
      }
      setPendingDelete(null)
      await refresh()
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleExport = async (format: 'pdf' | 'word') => {
    if (!tenders || allTenders.length === 0) return
    const ids = selected.size > 0 ? [...selected] : allTenders.map((t: any) => t.id)
    await api.exportData({ format, aanbestedingIds: ids, includeAnalysis: true, includeScores: true })
  }

  return (
    <div className="space-y-4">
      <DeleteConfirmationModal
        open={pendingDelete != null}
        title={
          pendingDelete?.kind === 'bulk'
            ? `${selected.size} aanbestedingen verwijderen?`
            : 'Aanbesteding verwijderen?'
        }
        description={
          pendingDelete?.kind === 'bulk'
            ? `Weet je zeker dat je ${selected.size} geselecteerde aanbestedingen permanent wilt verwijderen? Alle bijbehorende intern opgeslagen documenten worden ook gewist. Dit kan niet ongedaan worden gemaakt.`
            : pendingDelete?.kind === 'single'
              ? `Weet je zeker dat je "${pendingDelete.titel.slice(0, 160)}${pendingDelete.titel.length > 160 ? '…' : ''}" wilt verwijderen? Lokale documenten van deze aanbesteding worden ook verwijderd. Dit kan niet ongedaan worden gemaakt.`
              : ''
        }
        loading={deleteLoading}
        onCancel={() => !deleteLoading && setPendingDelete(null)}
        onConfirm={executeDelete}
      />

      {/* Batch progress banner - sticky, visible even after nav */}
      {(batchRunning || batchProgress?.done) && batchProgress && (
        <div className={`rounded-xl border p-4 shadow-sm ${batchProgress.done ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
          <div className="flex items-center gap-3">
            {batchProgress.done ? (
              <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-blue-600 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{batchProgress.step}</p>
              {!batchProgress.done && (
                <div className="mt-2 h-2 rounded-full bg-blue-200">
                  <div
                    className="h-2 rounded-full bg-blue-600 transition-all duration-500"
                    style={{ width: `${Math.round((batchProgress.current / batchProgress.total) * 100)}%` }}
                  />
                </div>
              )}
              {batchProgress.errors && batchProgress.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {batchProgress.errors.map((err, i) => (
                    <p key={i} className="text-xs text-red-600 flex items-center gap-1">
                      <XCircle className="h-3 w-3" /> {err}
                    </p>
                  ))}
                </div>
              )}
            </div>
            {batchProgress.done && (
              <button
                onClick={() => { setBatchProgress(null); setSelected(new Set()); refresh() }}
                className="text-xs text-green-700 hover:underline flex-shrink-0"
              >
                Sluiten
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            placeholder="Zoeken op titel, beschrijving, opdrachtgever..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-[var(--card)] py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
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
          className="rounded-lg border bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        >
          <option value="">Alle bronnen</option>
          {((sources as any[]) || []).map((s: any) => (
            <option key={s.id} value={s.id}>{s.naam}</option>
          ))}
        </select>
        <select
          value={minScore ?? ''}
          onChange={(e) => setMinScore(e.target.value ? Number(e.target.value) : undefined)}
          className="rounded-lg border bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        >
          <option value="">Alle scores</option>
          <option value="70">Score 70+</option>
          <option value="50">Score 50+</option>
          <option value="30">Score 30+</option>
        </select>
        <select
          value={verlopenFilter}
          onChange={(e) => setVerlopenFilter(e.target.value)}
          className="rounded-lg border bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        >
          <option value="active">Actief (niet verlopen)</option>
          <option value="verlopen">Verlopen</option>
          <option value="all">Alles tonen</option>
        </select>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as TenderSortOrder)}
          className="rounded-lg border bg-[var(--card)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          title="Sorteervolgorde van de lijst"
        >
          <option value="created_desc">Laatst toegevoegd</option>
          <option value="deadline_asc">Sluitingsdatum (eerst aflopend)</option>
          <option value="score_desc">Score (hoog → laag)</option>
        </select>
        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600 hover:bg-red-100 transition-colors"
            title="Alle filters resetten"
          >
            <RotateCcw className="h-4 w-4" /> Reset
          </button>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleBatchAnalyzeAllActive}
            disabled={batchRunning || singleAnalysisRunning || allTenders.length === 0}
            title="AI-analyse voor alle actieve (niet-verlopen) aanbestedingen met een bron-URL — zelfde werkwijze als handmatig: TenderNed + Mercell, alle bijlagen, score en uitleg per document"
            className="flex items-center gap-1.5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-2.5 text-sm font-medium text-[var(--primary)] hover:bg-[var(--primary)]/15 disabled:opacity-50 transition-colors"
          >
            {batchRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
            Alle actieve analyseren
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="flex items-center gap-1.5 rounded-lg border bg-[var(--card)] px-3 py-2.5 text-sm hover:bg-[var(--muted)] transition-colors"
          >
            <Download className="h-4 w-4" /> PDF
          </button>
          <button
            onClick={() => handleExport('word')}
            className="flex items-center gap-1.5 rounded-lg border bg-[var(--card)] px-3 py-2.5 text-sm hover:bg-[var(--muted)] transition-colors"
          >
            <Download className="h-4 w-4" /> Word
          </button>
        </div>
      </div>

      {/* Active dashboard filter label */}
      {dashboardLabel && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--primary)]/20 bg-[var(--primary)]/5 px-3 py-2">
          <span className="text-sm font-medium text-[var(--primary)]">Filter: {dashboardLabel}</span>
          <button onClick={resetFilters} className="rounded p-0.5 hover:bg-[var(--primary)]/10">
            <XCircle className="h-4 w-4 text-[var(--primary)]" />
          </button>
        </div>
      )}

      {/* Selection bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            {selected.size === allTenders.length && allTenders.length > 0 ? (
              <CheckSquare className="h-4 w-4 text-[var(--primary)]" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            {selected.size > 0 ? `${selected.size} geselecteerd` : `${allTenders.length} aanbestedingen`}
          </button>

          {selected.size > 0 && (
            <>
              <button
                onClick={handleBatchAnalyze}
                disabled={batchRunning || singleAnalysisRunning}
                title={
                  batchRunning                    ? batchProgress?.step
                    : singleAnalysisRunning
                      ? singleAnalysisStep || undefined
                      : undefined
                }
                className="flex max-w-full min-w-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {batchRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    <span className="min-w-0 truncate text-left">
                      {batchProgress?.step?.trim() || 'Batch-analyse bezig…'}
                    </span>
                  </>
                ) : singleAnalysisRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    <span className="min-w-0 truncate text-left">
                      {singleAnalysisStep || 'Losse analyse bezig…'}
                    </span>
                  </>
                ) : (
                  <>
                    <Brain className="h-4 w-4 shrink-0" />
                    <span>Analyseer {selected.size} aanbestedingen</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete({ kind: 'bulk' })}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors"
              >
                <Trash2 className="h-4 w-4" /> Verwijder selectie
              </button>
            </>
          )}
        </div>

        <p className="text-xs text-[var(--muted-foreground)]">
          {loading ? 'Laden...' : ''}
        </p>
      </div>

      {/* Tender list */}
      <div className="space-y-2">
        {allTenders.map((tender: any) => {
          const days = daysUntil(tender.sluitingsdatum)
          const isSelected = selected.has(tender.id)
          const activeEntry = activeAnalyses[tender.id]
          const isAnalysing = !!activeEntry
          const isRisico = activeEntry?.type === 'risico'
          const activeStep = getActiveStep(tender.status)
          const docCount = Array.isArray(tender.document_urls) ? tender.document_urls.length : null
          const scoreDisplay = tender.totaal_score != null ? Math.round(tender.totaal_score) : docCount
          const flag = getCountryFlag(tender.bron_website_naam, tender.bron_url)
          const hasAiAnalyse = tender.totaal_score != null
          const hasRisicoAnalyse = Boolean(tender.risico_analyse_at || tender.risico_analyse)

          return (
            <div
              key={tender.id}
              className={[
                'w-full rounded-xl border bg-[var(--card)] shadow-sm hover:shadow-md transition-all hover:border-[var(--primary)]/30 overflow-hidden',
                isSelected ? 'ring-2 ring-[var(--primary)]/40' : '',
                isAnalysing && !isRisico ? 'ring-2 ring-green-400/50 border-green-200' : '',
                isRisico ? 'ring-2 ring-red-400/50 border-red-200' : '',
              ].filter(Boolean).join(' ')}
            >
              {/* Analyse-voortgangsbalk bovenaan de kaart */}
              {isAnalysing && (
                <div className="overflow-hidden">
                  <div className={`flex items-center gap-2 px-4 py-1.5 text-xs font-medium ${isRisico ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                    {isRisico
                      ? <ShieldAlert className="h-3.5 w-3.5 shrink-0 animate-pulse" />
                      : <Brain className="h-3.5 w-3.5 shrink-0 animate-pulse" />
                    }
                    <span className="truncate">{activeEntry.step || (isRisico ? 'Risico-inventarisatie bezig…' : 'Analyse bezig…')}</span>
                    <Loader2 className={`h-3.5 w-3.5 shrink-0 animate-spin ml-auto ${isRisico ? 'text-red-500' : 'text-green-500'}`} />
                  </div>
                  {activeEntry.percentage > 0 && activeEntry.percentage < 100 && (
                    <div className={`h-0.5 w-full ${isRisico ? 'bg-red-100' : 'bg-green-100'}`}>
                      <div
                        className={`h-0.5 transition-all duration-500 ${isRisico ? 'bg-red-500' : 'bg-green-500'}`}
                        style={{ width: `${activeEntry.percentage}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex min-h-[100px]">
                {/* Left panel — meta info */}
                <div className="w-[210px] flex-shrink-0 border-r border-[var(--border)] px-4 py-3 flex flex-col gap-1 justify-between">
                  <div>
                    {/* Checkbox + org name */}
                    <div className="flex items-start gap-2">
                      <button
                        onClick={(e) => toggleSelect(tender.id, e)}
                        className="mt-0.5 rounded p-0.5 hover:bg-[var(--muted)] transition-colors flex-shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4 text-[var(--primary)]" />
                        ) : (
                          <Square className="h-4 w-4 text-[var(--muted-foreground)]" />
                        )}
                      </button>
                      <button
                        onClick={() => navigate(`/aanbestedingen/${tender.id}`)}
                        className="min-w-0 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          {flag && <span className="text-sm leading-none">{flag}</span>}
                          <span className="text-sm font-semibold text-[var(--foreground)] line-clamp-2 leading-snug">
                            {tender.opdrachtgever || 'Onbekende opdrachtgever'}
                          </span>
                        </div>
                      </button>
                    </div>

                    {/* Dates */}
                    <div className="mt-2 space-y-1 pl-6">
                      {tender.publicatiedatum && (
                        <div className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                          <CalendarDays className="h-3 w-3 flex-shrink-0" />
                          <span>Ontvangen: {formatDate(tender.publicatiedatum)}</span>
                        </div>
                      )}
                      {tender.sluitingsdatum && (
                        <div className={`flex items-center gap-1 text-[11px] ${days != null && days <= 7 ? 'text-red-500 font-medium' : 'text-[var(--muted-foreground)]'}`}>
                          <CalendarDays className={`h-3 w-3 flex-shrink-0 ${days != null && days >= 0 && days <= 7 ? 'animate-deadline-blink text-red-500' : ''}`} />
                          <span className={days != null && days >= 0 && days <= 7 ? 'animate-deadline-blink' : ''}>
                            Deadline: {formatDate(tender.sluitingsdatum)}
                            {days != null && days > 0 && days <= 30 && ` (${days}d)`}
                          </span>
                        </div>
                      )}
                      {tender.relevantie_score != null && tender.relevantie_score > 0 && (
                        <span
                          title={`Relevantiescore: ${Math.round(tender.relevantie_score)}/100`}
                          className={[
                            'inline-flex items-center justify-center rounded-full border-2 font-bold tabular-nums',
                            'h-8 w-8 text-[11px]',
                            tender.relevantie_score >= 70
                              ? 'border-green-500 text-green-600 bg-white dark:bg-transparent dark:border-green-400 dark:text-green-400'
                              : tender.relevantie_score >= 40
                                ? 'border-yellow-400 text-yellow-600 bg-white dark:bg-transparent dark:border-yellow-400 dark:text-yellow-400'
                                : 'border-red-500 text-red-600 bg-white dark:bg-transparent dark:border-red-400 dark:text-red-400',
                          ].join(' ')}
                        >
                          {Math.round(tender.relevantie_score)}
                        </span>
                      )}
                      {(tender.pre_kwalificatie_nummer || tender.definitief_nummer) && (
                        <div className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] font-mono">
                          <Hash className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{tender.pre_kwalificatie_nummer || tender.definitief_nummer}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status + delete */}
                  <div className="flex items-center gap-1.5 pl-6 pt-1">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getStatusColor(tender.status)}`}>
                      {getStatusLabel(tender.status)}
                    </span>
                    {tender.bron_website_naam && (
                      <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[9px] text-[var(--muted-foreground)] truncate max-w-[60px]" title={tender.bron_website_naam}>
                        {tender.bron_website_naam}
                      </span>
                    )}
                    <button
                      type="button"
                      title="Verwijderen"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPendingDelete({ kind: 'single', id: tender.id, titel: tender.titel || 'Zonder titel' })
                      }}
                      className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Right panel — title + pipeline */}
                <div className="flex-1 min-w-0 overflow-hidden px-5 py-3 flex flex-col justify-between">
                  {/* Title — klikbaar naar overzicht */}
                  <button
                    onClick={() => navigate(`/aanbestedingen/${tender.id}`)}
                    className="w-full text-left"
                  >
                    <h3 className="text-sm font-semibold text-[var(--foreground)] line-clamp-2 leading-snug hover:text-[var(--primary)] transition-colors">
                      {tender.titel}
                    </h3>
                  </button>

                  {/* Pipeline — elke stap klikbaar naar eigen tab */}
                  <div className="mt-3 flex items-center">
                    {PIPELINE_STEPS.map((step, idx) => {
                      const StepIcon = step.icon
                      const isActive = idx === activeStep
                      const isPast = idx < activeStep
                      const isLast = idx === PIPELINE_STEPS.length - 1
                      return (
                        <div key={idx} className="flex items-center flex-1 last:flex-none">
                          <div className="relative flex-shrink-0 group">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                navigate(`/aanbestedingen/${tender.id}?tab=${step.tab}`)
                              }}
                              className={[
                                'h-8 w-8 rounded-full border-2 flex items-center justify-center transition-all',
                                'hover:scale-110 hover:shadow-sm',
                                isActive
                                  ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                                  : isPast
                                    ? 'border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]'
                                    : 'border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]',
                              ].join(' ')}
                            >
                              {isAnalysing && isActive ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <StepIcon className="h-3.5 w-3.5" />
                              )}
                            </button>
                            {/* Score badge */}
                            {isActive && scoreDisplay != null && (
                              <span className={[
                                'absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full text-[9px] font-bold flex items-center justify-center px-1 leading-none pointer-events-none',
                                tender.totaal_score != null && tender.totaal_score >= 70 ? 'bg-green-500 text-white' :
                                tender.totaal_score != null && tender.totaal_score >= 40 ? 'bg-yellow-500 text-white' :
                                tender.totaal_score != null ? 'bg-red-500 text-white' :
                                'bg-[var(--primary)] text-[var(--primary-foreground)]',
                              ].join(' ')}>
                                {scoreDisplay}
                              </span>
                            )}
                            {/* Tooltip */}
                            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 hidden group-hover:block">
                              <div className="rounded-md bg-gray-900 px-2 py-1 text-[10px] text-white whitespace-nowrap shadow-lg">
                                <span className="font-semibold">{step.label}</span>
                                <span className="text-gray-300"> — {step.tooltip}</span>
                              </div>
                              <div className="mx-auto mt-0.5 h-1.5 w-1.5 rotate-45 bg-gray-900" />
                            </div>
                          </div>
                          {/* Connector line */}
                          {!isLast && (
                            <div className={[
                              'h-[2px] flex-1 mx-1',
                              isPast || isActive
                                ? 'bg-[var(--primary)]/30'
                                : 'border-t-2 border-dashed border-[var(--border)]',
                            ].join(' ')} style={isPast || isActive ? {} : { background: 'none' }} />
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Bottom meta row */}
                    <div
                    onClick={() => navigate(`/aanbestedingen/${tender.id}`)}
                    className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-1 border-t border-[var(--border)]/50 pt-2 overflow-hidden cursor-pointer"
                  >
                    <div className="flex-shrink-0">
                      <p className="text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]/60 font-medium">Huidige fase</p>
                      <p className="text-[11px] text-[var(--muted-foreground)]">{PIPELINE_STEPS[activeStep]?.label}</p>
                    </div>

                    {/* Analyse-statusindicatoren */}
                    <div className="flex-shrink-0">
                      <p className="text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]/60 font-medium">Analyses</p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span
                          title={hasAiAnalyse ? `AI-analyse uitgevoerd — score ${Math.round(tender.totaal_score)}` : 'Nog geen AI-analyse uitgevoerd'}
                          className={[
                            'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold',
                            hasAiAnalyse
                              ? isDark
                                ? 'border-transparent bg-violet-950/50 text-violet-300'
                                : ''
                              : 'border-transparent bg-[var(--muted)] text-[var(--muted-foreground)]/50',
                          ].join(' ')}
                          style={
                            hasAiAnalyse && !isDark
                              ? { backgroundColor: '#ede9fe', color: '#5b21b6', borderColor: '#8b5cf6' }
                              : undefined
                          }
                        >
                          <Brain className="h-2.5 w-2.5" />
                          AI
                        </span>
                        <span
                          title={hasRisicoAnalyse ? 'Risico-analyse uitgevoerd' : 'Nog geen risico-analyse uitgevoerd'}
                          className={[
                            'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold',
                            hasRisicoAnalyse
                              ? isDark
                                ? 'border-transparent bg-orange-950/50 text-orange-300'
                                : ''
                              : 'border-transparent bg-[var(--muted)] text-[var(--muted-foreground)]/50',
                          ].join(' ')}
                          style={
                            hasRisicoAnalyse && !isDark
                              ? { backgroundColor: '#ffedd5', color: '#9a3412', borderColor: '#fb923c' }
                              : undefined
                          }
                        >
                          <ShieldAlert className="h-2.5 w-2.5" />
                          Risico
                        </span>
                      </div>
                    </div>
                    {tender.bron_website_naam && (
                      <div className="flex-shrink-0">
                        <p className="text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]/60 font-medium">Bron</p>
                        <p className="text-[11px] text-[var(--muted-foreground)]">{tender.bron_website_naam}</p>
                      </div>
                    )}
                    {tender.geraamde_waarde && (
                      <div className="flex-shrink-0">
                        <p className="text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]/60 font-medium">Geraamde waarde (excl. BTW)</p>
                        <p className="text-[11px] font-medium text-[var(--foreground)]">{tender.geraamde_waarde}</p>
                      </div>
                    )}
                    {tender.match_uitleg && (
                      <div className="w-full min-w-0 overflow-hidden">
                        <p className="text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]/60 font-medium">AI Toelichting</p>
                        <p className="text-[11px] italic text-[var(--muted-foreground)] truncate">{tender.match_uitleg}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {!loading && allTenders.length === 0 && (
          <div className="rounded-xl border bg-[var(--card)] py-16 text-center">
            <FileText className="mx-auto h-12 w-12 text-[var(--muted-foreground)]/30" />
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              Geen aanbestedingen gevonden met deze filters.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
