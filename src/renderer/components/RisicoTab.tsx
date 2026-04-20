import React, { useState, useEffect, useCallback } from 'react'
import {
  ShieldAlert, ShieldCheck, ShieldX, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, RefreshCw, Loader2, FileSearch,
  AlertCircle, Info, Scale, TrendingDown, Building2, Lock,
  Cpu, DollarSign, Gavel, Target, BookOpen, ClipboardList,
  MessageSquareWarning, HelpCircle, FileWarning, Play
} from 'lucide-react'
import { api } from '../lib/ipc-client'
import { useAnalysisActiveStore } from '../stores/analysis-active-store'
import { useAgentStore } from '../stores/agent-store'
import type { RisicoAnalyseResult, RisicoGebied, RisicoItem, RisicoScore, InschrijfAdvies } from '../../shared/types'
import {
  CitedSourceButton,
  LinkedCitationText,
  RisicoCitationModalLayer,
} from './risico-citation-links'

// ── Score helpers ─────────────────────────────────────────────────────────────

function scoreBadgeClass(score: RisicoScore | string): string {
  if (score === 'Hoog') return 'bg-red-100 text-red-700 border border-red-200'
  if (score === 'Middel') return 'bg-amber-100 text-amber-700 border border-amber-200'
  return 'bg-green-100 text-green-700 border border-green-200'
}

function scoreRingColor(score: RisicoScore | string): string {
  if (score === 'Hoog') return 'text-red-600'
  if (score === 'Middel') return 'text-amber-500'
  return 'text-green-600'
}

function scoreDot(score: RisicoScore | string): string {
  if (score === 'Hoog') return 'bg-red-500'
  if (score === 'Middel') return 'bg-amber-400'
  return 'bg-green-500'
}

function adviesBadge(advies: InschrijfAdvies | string): { label: string; cls: string } {
  switch (advies) {
    case 'inschrijfbaar': return { label: 'Inschrijfbaar', cls: 'bg-green-100 text-green-700 border border-green-200' }
    case 'inschrijfbaar_onder_voorwaarden': return { label: 'Inschrijfbaar onder voorwaarden', cls: 'bg-amber-100 text-amber-700 border border-amber-200' }
    case 'hoog_risico': return { label: 'Hoog risico', cls: 'bg-orange-100 text-orange-700 border border-orange-200' }
    case 'no_go': return { label: 'No-go — nader beoordelen', cls: 'bg-red-100 text-red-700 border border-red-200' }
    default: return { label: String(advies), cls: 'bg-gray-100 text-gray-700' }
  }
}

function risicoTypeClass(type: string): string {
  switch (type) {
    case 'knock-out': return 'bg-red-50 text-red-700 border border-red-200'
    case 'juridisch': return 'bg-blue-50 text-blue-700 border border-blue-200'
    case 'commercieel': return 'bg-yellow-50 text-yellow-700 border border-yellow-200'
    case 'operationeel': return 'bg-purple-50 text-purple-700 border border-purple-200'
    case 'strategisch': return 'bg-indigo-50 text-indigo-700 border border-indigo-200'
    case 'bewijsrisico': return 'bg-gray-100 text-gray-700 border border-gray-200'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function gebiedIcon(naam: string): React.ReactNode {
  const n = naam.toLowerCase()
  if (n.includes('procedur') || n.includes('formeel')) return <ClipboardList className="h-4 w-4" />
  if (n.includes('uitsluit') || n.includes('geschikt') || n.includes('selectie')) return <Target className="h-4 w-4" />
  if (n.includes('transparant') || n.includes('proportional') || n.includes('gelijkheid')) return <Scale className="h-4 w-4" />
  if (n.includes('gunning') || n.includes('beoordeling')) return <Gavel className="h-4 w-4" />
  if (n.includes('contract') || n.includes('aansprak')) return <FileWarning className="h-4 w-4" />
  if (n.includes('financ') || n.includes('commerc')) return <DollarSign className="h-4 w-4" />
  if (n.includes('uitvoer') || n.includes('operatio')) return <Cpu className="h-4 w-4" />
  if (n.includes('privacy') || n.includes('informatie') || n.includes('beveiliging')) return <Lock className="h-4 w-4" />
  if (n.includes('intellectueel') || n.includes('eigendom')) return <BookOpen className="h-4 w-4" />
  if (n.includes('strateg') || n.includes('no-go')) return <TrendingDown className="h-4 w-4" />
  return <AlertCircle className="h-4 w-4" />
}

// ── Score ring ────────────────────────────────────────────────────────────────

function OverallScoreRing({ score }: { score: RisicoScore | string }) {
  const color = scoreRingColor(score)
  const pct = score === 'Hoog' ? 85 : score === 'Middel' ? 50 : 20
  const r = 36
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ

  return (
    <div className="relative flex h-24 w-24 flex-shrink-0 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-[var(--muted)]/40" />
        <circle
          cx="44" cy="44" r={r} fill="none" strokeWidth="7"
          stroke="currentColor" className={color}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="flex flex-col items-center">
        <span className={`text-lg font-bold ${color}`}>{score}</span>
      </div>
    </div>
  )
}

// ── Individual risico card ────────────────────────────────────────────────────

function RisicoCard({ item, index }: { item: RisicoItem; index: number }) {
  const [open, setOpen] = useState(false)
  const ernst = item.ernstscore

  return (
    <div className={`rounded-lg border transition-all ${ernst === 'Hoog' ? 'border-red-200 bg-red-50/30' : ernst === 'Middel' ? 'border-amber-200 bg-amber-50/20' : 'border-[var(--border)] bg-[var(--card)]'}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <span className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${ernst === 'Hoog' ? 'bg-red-100 text-red-700' : ernst === 'Middel' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
          {index + 1}
        </span>
        <div className="flex flex-1 flex-col gap-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--foreground)]">{item.titel}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${scoreBadgeClass(ernst)}`}>
              {ernst}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${risicoTypeClass(item.type)}`}>
              {item.type}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span className="text-xs text-[var(--muted-foreground)]">Kans: <span className={`font-medium ${item.kans === 'Hoog' ? 'text-red-600' : item.kans === 'Middel' ? 'text-amber-600' : 'text-green-600'}`}>{item.kans}</span></span>
            <span className="text-xs text-[var(--muted-foreground)]">Impact: <span className={`font-medium ${item.impact === 'Hoog' ? 'text-red-600' : item.impact === 'Middel' ? 'text-amber-600' : 'text-green-600'}`}>{item.impact}</span></span>
          </div>
          {!open && item.feit && (
            <p className="text-xs text-[var(--muted-foreground)] line-clamp-2 italic">
              <LinkedCitationText text={item.feit} />
            </p>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)] mt-1" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)] mt-1" />}
      </button>

      {open && (
        <div className="border-t border-[var(--border)] px-4 pb-4 pt-3 space-y-3">
          <DetailRow label="Feit uit stukken" icon={<Info className="h-3.5 w-3.5" />} value={item.feit} />
          <DetailRow label="Bron" icon={<BookOpen className="h-3.5 w-3.5" />} value={item.bron} />
          {item.juridische_duiding && item.juridische_duiding !== 'n.v.t.' && item.juridische_duiding !== 'Niet van toepassing' && (
            <DetailRow label="Juridische duiding" icon={<Scale className="h-3.5 w-3.5" />} value={item.juridische_duiding} highlight />
          )}
          {item.consequenties && item.consequenties !== 'n.v.t.' && (
            <DetailRow label="Consequenties (uit stukken)" icon={<Info className="h-3.5 w-3.5" />} value={item.consequenties} />
          )}
          <DetailRow label="Waarom een risico" icon={<AlertTriangle className="h-3.5 w-3.5" />} value={item.waarom_risico} />
          {item.verificatie && item.verificatie !== 'n.v.t.' && (
            <DetailRow label="Benodigde verificatie" icon={<HelpCircle className="h-3.5 w-3.5" />} value={item.verificatie} />
          )}
          <DetailRow label="Aanbevolen actie" icon={<CheckCircle2 className="h-3.5 w-3.5" />} value={item.actie} action />
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, icon, value, highlight, action }: {
  label: string; icon: React.ReactNode; value: string; highlight?: boolean; action?: boolean
}) {
  if (!value || value.trim() === '') return null
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${highlight ? 'text-blue-600' : action ? 'text-green-700' : 'text-[var(--muted-foreground)]'}`}>
        {icon}
        {label}
      </div>
      <p className={`text-sm leading-relaxed pl-5 ${highlight ? 'text-blue-900' : action ? 'text-green-900 font-medium' : 'text-[var(--foreground)]'}`}>
        <LinkedCitationText text={value} />
      </p>
    </div>
  )
}

// ── Risicogebied section ──────────────────────────────────────────────────────

function GebiedSection({ gebied }: { gebied: RisicoGebied }) {
  const [collapsed, setCollapsed] = useState(false)
  const hoogCount = gebied.risicos.filter(r => r.ernstscore === 'Hoog').length
  const middelCount = gebied.risicos.filter(r => r.ernstscore === 'Middel').length
  const laagCount = gebied.risicos.filter(r => r.ernstscore === 'Laag').length

  return (
    <div className="rounded-xl border bg-[var(--card)] shadow-sm overflow-hidden">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-[var(--muted)]/30 transition-colors"
      >
        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${gebied.score === 'Hoog' ? 'bg-red-100 text-red-600' : gebied.score === 'Middel' ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
          {gebiedIcon(gebied.naam)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--foreground)]">{gebied.naam}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${scoreBadgeClass(gebied.score)}`}>
              {gebied.score}
            </span>
            <div className="flex items-center gap-1.5">
              {hoogCount > 0 && <span className="flex items-center gap-0.5 text-[10px] text-red-600"><span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block" />{hoogCount} hoog</span>}
              {middelCount > 0 && <span className="flex items-center gap-0.5 text-[10px] text-amber-600"><span className="h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />{middelCount} middel</span>}
              {laagCount > 0 && <span className="flex items-center gap-0.5 text-[10px] text-green-600"><span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />{laagCount} laag</span>}
            </div>
          </div>
          {gebied.score_toelichting && (
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)] line-clamp-1">
              <LinkedCitationText text={gebied.score_toelichting} />
            </p>
          )}
        </div>
        {collapsed ? <ChevronDown className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" /> : <ChevronUp className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />}
      </button>

      {!collapsed && (
        <div className="border-t border-[var(--border)] p-4 space-y-3">
          {gebied.score_toelichting && (
            <p className="text-sm text-[var(--muted-foreground)] italic border-l-2 border-[var(--border)] pl-3">
              <LinkedCitationText text={gebied.score_toelichting} />
            </p>
          )}
          {gebied.risicos.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">Geen risico's geïdentificeerd in dit gebied.</p>
          ) : (
            <div className="space-y-2">
              {gebied.risicos.map((item, idx) => (
                <RisicoCard key={idx} item={item} index={idx} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ step, percentage, agent }: { step: string; percentage: number; agent?: string }) {
  return (
    <div className="rounded-xl border bg-[var(--card)] p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--primary)]" />
        <span className="text-sm font-medium text-[var(--foreground)]">Risico-analyse bezig…</span>
        {agent?.trim() ? (
          <span className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)]">
            {agent.trim()}
          </span>
        ) : null}
      </div>
      <div className="h-2 w-full rounded-full bg-[var(--muted)]">
        <div
          className="h-2 rounded-full bg-[var(--primary)] transition-all duration-500"
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{step}</p>
    </div>
  )
}

// ── Main RisicoTab component ──────────────────────────────────────────────────

interface RisicoTabProps {
  aanbestedingId: string
  risicoAnalyseJson: string | null | undefined
  risicoAnalyseAt: string | null | undefined
  /** 1-based positie in main-process wachtrij, of null */
  risicoWachtrijPositie?: number | null
  onRefresh: () => void | Promise<void>
}

export function RisicoTab({
  aanbestedingId,
  risicoAnalyseJson,
  risicoAnalyseAt,
  risicoWachtrijPositie = null,
  onRefresh,
}: RisicoTabProps) {
  const [analyzing, setAnalyzing] = useState(false)
  const [progressStep, setProgressStep] = useState('')
  const [progressPct, setProgressPct] = useState(0)
  const [progressAgent, setProgressAgent] = useState('')
  const [error, setError] = useState<string | null>(null)

  const risicoStoreEntry = useAnalysisActiveStore((s) => {
    const e = s.active[aanbestedingId]
    return e?.type === 'risico' ? e : null
  })

  const result: RisicoAnalyseResult | null = risicoAnalyseJson
    ? (() => { try { return JSON.parse(risicoAnalyseJson) } catch { return null } })()
    : null

  const risicoBusy = risicoStoreEntry != null

  const displayStep = (risicoStoreEntry?.step || progressStep || '').trim() || 'Risico-analyse…'
  const displayPct =
    typeof risicoStoreEntry?.percentage === 'number'
      ? Math.min(100, Math.max(0, risicoStoreEntry.percentage))
      : progressPct
  const displayAgent = (risicoStoreEntry?.agent || progressAgent).trim()

  // Listen to risico progress events (both standalone and pipeline-embedded)
  useEffect(() => {
    const unsub = api.onRisicoProgress?.((data: unknown) => {
      const d = data as { aanbestedingId: string; step: string; percentage: number; agent?: string }
      if (d.aanbestedingId !== aanbestedingId) return
      setProgressStep(d.step)
      setProgressPct(d.percentage)
      if (typeof d.agent === 'string' && d.agent.trim()) setProgressAgent(d.agent.trim())
      // When the pipeline-embedded analysis finishes (100%), refresh data
      if (d.percentage >= 100) {
        void onRefresh()
      }
    })
    return () => {
      unsub?.()
    }
  }, [aanbestedingId, onRefresh])

  const inRisicoWachtrij = risicoWachtrijPositie != null && risicoWachtrijPositie > 0

  const handleAnalyse = useCallback(async () => {
    if (risicoBusy || inRisicoWachtrij) return
    setAnalyzing(true)
    setError(null)
    setProgressStep('Analyse starten…')
    setProgressPct(0)
    setProgressAgent('')
    try {
      const res = await api.startRisicoAnalyse(aanbestedingId) as {
        success: boolean
        error?: string
        queued?: boolean
        position?: number
        alreadyRunning?: boolean
      }
      if (res?.queued || res?.alreadyRunning) {
        /* Voortgang volgt via IPC + batch-status */
      } else if (!res?.success) {
        setError(res?.error || 'Analyse mislukt')
      } else {
        await onRefresh()
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyzing(false)
    }
  }, [aanbestedingId, onRefresh, risicoBusy, inRisicoWachtrij])

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!result && !analyzing && !risicoBusy) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--muted)]">
          <ShieldAlert className="h-8 w-8 text-[var(--muted-foreground)]" />
        </div>
        <h3 className="mb-2 text-base font-semibold text-[var(--foreground)]">Nog geen risico-inventarisatie</h3>
        <p className="mb-6 max-w-sm text-sm text-[var(--muted-foreground)]">
          Start een risico-inventarisatie om alle aanbestedingsstukken te analyseren op juridische,
          commerciële en operationele risico's per risicogebied.
        </p>
        {inRisicoWachtrij && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
            <Info className="h-4 w-4 flex-shrink-0" />
            Deze inventarisatie staat in de wachtrij (positie {risicoWachtrijPositie}). Hij start automatisch na de lopende analyse(s).
          </div>
        )}
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}
        <button
          onClick={handleAnalyse}
          disabled={risicoBusy || inRisicoWachtrij}
          className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          {inRisicoWachtrij ? `In wachtrij (nr. ${risicoWachtrijPositie})` : 'Start risico-inventarisatie'}
        </button>
      </div>
    )
  }

  // ── Loading state (ook na navigatie: store houdt risico-analyse vast) ────────
  if (!result && (analyzing || risicoBusy)) {
    return (
      <div className="space-y-4">
        <ProgressBar step={displayStep} percentage={displayPct} agent={displayAgent || undefined} />
      </div>
    )
  }

  if (!result) return null

  const advies = adviesBadge(result.inschrijfadvies)
  const hoogGebieden = result.risicogebieden?.filter(g => g.score === 'Hoog').length ?? 0
  const middelGebieden = result.risicogebieden?.filter(g => g.score === 'Middel').length ?? 0
  const alleRisicos = result.risicogebieden?.flatMap(g => g.risicos) ?? []
  const aantalRisicos = alleRisicos.length
  const aantalHoog = alleRisicos.filter(r => r.ernstscore === 'Hoog').length

  return (
    <RisicoCitationModalLayer tenderId={aanbestedingId}>
    <div className="space-y-5">
      {(analyzing || risicoBusy) && (
        <ProgressBar step={displayStep} percentage={displayPct} agent={displayAgent || undefined} />
      )}

      {inRisicoWachtrij && !risicoBusy && !analyzing && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
          <Info className="h-4 w-4 flex-shrink-0" />
          Heranalyse staat in de wachtrij (positie {risicoWachtrijPositie}).
        </div>
      )}

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">Risico Inventarisatie</h2>
          {risicoAnalyseAt && (
            <p className="text-xs text-[var(--muted-foreground)]">
              Geanalyseerd op {new Date(risicoAnalyseAt).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
        </div>
        <button
          onClick={handleAnalyse}
          disabled={analyzing || risicoBusy || inRisicoWachtrij}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {inRisicoWachtrij ? `Wachtrij ${risicoWachtrijPositie}` : 'Heranalyse'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Management summary card */}
      <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
        <div className="flex items-start gap-5">
          <OverallScoreRing score={result.overall_score} />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-[var(--foreground)]">Overall risicoscore</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${scoreBadgeClass(result.overall_score)}`}>
                {result.overall_score}
              </span>
              <span className={`rounded-lg px-2.5 py-0.5 text-[11px] font-semibold ${advies.cls}`}>
                {advies.label}
              </span>
            </div>
            <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
              <LinkedCitationText text={result.overall_toelichting} />
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted-foreground)]">
              <span><strong className="text-[var(--foreground)]">{result.risicogebieden?.length ?? 0}</strong> risicogebieden</span>
              <span><strong className="text-[var(--foreground)]">{aantalRisicos}</strong> risico's totaal</span>
              {aantalHoog > 0 && <span className="text-red-600 font-medium">{aantalHoog} hoog-risico</span>}
              {hoogGebieden > 0 && <span className="text-red-600">{hoogGebieden} gebied{hoogGebieden > 1 ? 'en' : ''} hoog</span>}
              {middelGebieden > 0 && <span className="text-amber-600">{middelGebieden} gebied{middelGebieden > 1 ? 'en' : ''} middel</span>}
            </div>
          </div>
        </div>

        {/* Management samenvatting */}
        {result.management_samenvatting && (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Management samenvatting</p>
            <p className="text-sm text-[var(--foreground)] leading-relaxed">
              <LinkedCitationText text={result.management_samenvatting} />
            </p>
          </div>
        )}
      </div>

      {/* Top 5 risico's */}
      {result.top5_risicos?.length > 0 && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <ShieldX className="h-4 w-4 text-red-500" />
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Top 5 zwaarste risico's</h3>
          </div>
          <ol className="space-y-2">
            {result.top5_risicos.map((r, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-100 text-[11px] font-bold text-red-700">{i + 1}</span>
                <span className="text-sm text-[var(--foreground)] leading-relaxed">
                  <LinkedCitationText text={r} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Kernbevindingen */}
      {result.kernbevindingen &&
        (result.kernbevindingen.procedureel ||
          result.kernbevindingen.juridisch ||
          result.kernbevindingen.commercieel ||
          result.kernbevindingen.uitvoering) && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[var(--primary)]" />
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Kernbevindingen</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Procedureel', text: result.kernbevindingen.procedureel },
              { label: 'Juridisch', text: result.kernbevindingen.juridisch },
              { label: 'Commercieel', text: result.kernbevindingen.commercieel },
              { label: 'Uitvoering', text: result.kernbevindingen.uitvoering },
            ].map(
              (k) =>
                k.text?.trim() && (
                  <div key={k.label} className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{k.label}</p>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                      <LinkedCitationText text={k.text} />
                    </p>
                  </div>
                ),
            )}
          </div>
        </div>
      )}

      {/* Risicogebieden */}
      {result.risicogebieden?.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <ShieldAlert className="h-4 w-4 text-[var(--primary)]" />
            Risicoanalyse per gebied
          </h3>
          {result.risicogebieden.map((gebied, idx) => (
            <GebiedSection key={idx} gebied={gebied} />
          ))}
        </div>
      )}

      {/* No-go factoren */}
      {result.no_go_factoren?.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/40 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldX className="h-4 w-4 text-red-600" />
            <h3 className="text-sm font-semibold text-red-700">No-go / Dealbreakers</h3>
          </div>
          <ul className="space-y-1.5">
            {result.no_go_factoren.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-red-800">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
                <LinkedCitationText text={f} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tegenstrijdigheden */}
      {result.tegenstrijdigheden?.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageSquareWarning className="h-4 w-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-amber-700">Tegenstrijdigheden, leemtes en onzekerheden</h3>
            </div>
            <button
              type="button"
              onClick={() => {
                const agent = useAgentStore.getState()
                agent.setActiveTender(aanbestedingId)
                agent.setPanelOpen(true)
                const lijst = (result.tegenstrijdigheden ?? []).map((t, idx) => `${idx + 1}. ${t}`).join('\n')
                agent.setPendingUserInput(
                  `Bekijk de volgende tegenstrijdigheden en leemtes in deze aanbesteding en geef per punt een korte actie/advies:\n\n${lijst}`
                )
              }}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
            >
              Bespreek met agent
            </button>
          </div>
          <ul className="space-y-1.5">
            {result.tegenstrijdigheden.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                <LinkedCitationText text={t} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Wetsartikelen / beginselen */}
      {result.wetsartikelen_bijlage && result.wetsartikelen_bijlage.length > 0 && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Scale className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Wetsartikelen en beginselen (bijlage)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                  <th className="pb-2 pr-3 text-left font-medium">Artikel / beginsel</th>
                  <th className="pb-2 pr-3 text-left font-medium">Korte inhoud</th>
                  <th className="pb-2 pr-3 text-left font-medium">Toegepast bij</th>
                  <th className="pb-2 pr-3 text-left font-medium">Relevantie</th>
                  <th className="pb-2 text-left font-medium">Bron</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {result.wetsartikelen_bijlage.map((w, i) => (
                  <tr key={i} className="text-[var(--foreground)] align-top">
                    <td className="py-2 pr-3 font-medium">
                      <LinkedCitationText text={w.artikel_of_beginsel} />
                    </td>
                    <td className="py-2 pr-3 text-[var(--muted-foreground)]">
                      <LinkedCitationText text={w.korte_inhoud} />
                    </td>
                    <td className="py-2 pr-3">
                      <LinkedCitationText text={w.toegepast_bij_risico} />
                    </td>
                    <td className="py-2 pr-3 text-[var(--muted-foreground)]">
                      <LinkedCitationText text={w.relevantie} />
                    </td>
                    <td className="py-2">
                      {w.bron_url ? (
                        <CitedSourceButton url={w.bron_url} />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vragen voor NvI */}
      {result.vragen_nvi?.length > 0 && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-blue-500" />
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Vragen voor de nota van inlichtingen</h3>
          </div>
          <div className="space-y-3">
            {result.vragen_nvi.map((v, i) => (
              <div key={i} className="rounded-lg border border-blue-100 bg-blue-50/30 p-3 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                  <LinkedCitationText text={v.doel} />
                </p>
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  Bron: <LinkedCitationText text={v.bron} />
                </p>
                <p className="text-sm text-[var(--foreground)]">
                  <LinkedCitationText text={v.formulering} />
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Document inventarisatie */}
      {result.document_inventarisatie?.length > 0 && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-[var(--muted-foreground)]" />
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Geanalyseerde documenten</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                  <th className="pb-2 pr-4 text-left font-medium">Document</th>
                  <th className="pb-2 pr-4 text-left font-medium">Versie/datum</th>
                  <th className="pb-2 pr-4 text-left font-medium">Rol</th>
                  <th className="pb-2 text-left font-medium">Opmerkingen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {result.document_inventarisatie.map((d, i) => (
                  <tr key={i} className="text-[var(--foreground)]">
                    <td className="py-1.5 pr-4 font-medium">{d.naam}</td>
                    <td className="py-1.5 pr-4 text-[var(--muted-foreground)]">{d.versie || '—'}</td>
                    <td className="py-1.5 pr-4">{d.rol}</td>
                    <td className="py-1.5 text-[var(--muted-foreground)]">
                      {d.opmerkingen ? <LinkedCitationText text={d.opmerkingen} /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Herhaal heranalyse onderaan voor gemak */}
      <div className="flex justify-center pb-2">
        <button
          onClick={handleAnalyse}
          disabled={analyzing || risicoBusy || inRisicoWachtrij}
          className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          {inRisicoWachtrij ? `In wachtrij (nr. ${risicoWachtrijPositie})` : 'Heranalyse uitvoeren'}
        </button>
      </div>
    </div>
    </RisicoCitationModalLayer>
  )
}
