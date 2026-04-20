import React, { useEffect, useRef, useState, useCallback } from 'react'
import { X, Terminal, Cpu, BarChart2, Settings2, RotateCcw } from 'lucide-react'
import { api } from '../lib/ipc-client'
import { buildConfiguredMainAgentLabel, buildRisicoModelDisplay } from '../../shared/ai-display'
import { estimateTokenCostEur, formatEurIndicative } from '../../shared/ai-pricing'

export type AiAnalysisActivityLine = {
  step: string
  percentage: number
  at: number
  /** Wie de stap uitvoert: app (tracking/tekst) of LLM-provider + model */
  agent?: string
}

interface TokenUsageRow {
  provider?: string
  model?: string
  label: string
  inputTokens: number
  outputTokens: number
  total: number
}

interface TokenStats {
  last7days: {
    byModel: TokenUsageRow[]
    totalTokens: number
    totalInput: number
    totalOutput: number
  }
  recent: {
    byModel: TokenUsageRow[]
    totalTokens: number
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

type Props = {
  open: boolean
  onClose: () => void
  lines: AiAnalysisActivityLine[]
  /** Toon pulserende indicator zolang de pipeline nog loopt */
  active?: boolean
}

export function AiAnalysisActivityPanel({ open, onClose, lines, active }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastPct = lines.length ? lines[lines.length - 1].percentage : 0
  const lastAgent = lines.length ? lines[lines.length - 1].agent : undefined

  const [tokenStats, setTokenStats] = useState<TokenStats | null>(null)
  const [settings, setSettings] = useState<Record<string, string> | null>(null)
  const [statsError, setStatsError] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)

  const fetchStats = useCallback(async () => {
    setStatsError(false)
    try {
      const all = await api.getAllSettings()
      if (all && typeof all === 'object') setSettings(all as Record<string, string>)
    } catch {
      /* instellingen optioneel */
    }
    try {
      const stats = await api.getTokenStats()
      if (stats) setTokenStats(stats as TokenStats)
    } catch {
      setStatsError(true)
    }
  }, [])

  // Fetch on open; blijf pollen zolang het paneel open is (tokens worden vaak ná de eerste fetch weggeschreven).
  useEffect(() => {
    if (!open) return
    void fetchStats()
    const id = setInterval(() => void fetchStats(), 8_000)
    return () => clearInterval(id)
  }, [open, fetchStats])

  const prevActiveRef = useRef(active)
  useEffect(() => {
    if (prevActiveRef.current && !active) void fetchStats()
    prevActiveRef.current = active
  }, [active, fetchStats])

  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [open, lines])

  const handleReset = useCallback(async () => {
    if (!resetConfirm) { setResetConfirm(true); return }
    setResetting(true)
    try {
      await api.resetTokenStats()
      setTokenStats(null)
      await fetchStats()
    } finally {
      setResetting(false)
      setResetConfirm(false)
    }
  }, [resetConfirm, fetchStats])

  if (!open) return null

  const mainConfigured = settings != null ? buildConfiguredMainAgentLabel(settings) : null
  const risicoDisplay = settings != null ? buildRisicoModelDisplay(settings) : null
  const kimiCliNote =
    (settings?.ai_provider || '').trim() === 'kimi_cli'
      ? 'Kimi CLI rapporteert geen tokenaantallen; verbruik kan lager lijken dan in werkelijkheid.'
      : null

  // Which models appear in the current session's activity lines
  const sessionAgents = Array.from(
    new Set(lines.map((l) => l.agent).filter((a): a is string => Boolean(a?.trim()))),
  )

  // recent = DB-aggregatie laatste 8 uur (zie getTokenStats)
  const recentModels = tokenStats?.recent.byModel ?? []
  const recentTotal = tokenStats?.recent.totalTokens ?? 0
  const days7Total = tokenStats?.last7days.totalTokens ?? 0
  const days7Models = tokenStats?.last7days.byModel ?? []

  const rowCost = (m: TokenUsageRow) =>
    m.provider
      ? estimateTokenCostEur(m.provider, m.model || '', m.inputTokens, m.outputTokens)
      : null
  const days7CostSum = days7Models.reduce((s, m) => {
    const c = rowCost(m)
    return c != null ? s + c : s
  }, 0)
  const days7HasPricedRow = days7Models.some((m) => rowCost(m) != null)

  return (
    <div
      className="fixed bottom-5 right-5 z-[100] flex w-[min(100vw-1.5rem,28rem)] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-emerald-500/25 bg-[#0a0f0d] shadow-2xl shadow-black/50 ring-1 ring-white/[0.06]"
      role="dialog"
      aria-label="AI-analyse activiteit"
    >
      {/* ── Title bar ── */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] bg-[#111916] px-3 py-2">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-[#ff5f57]/90" />
          <span className="h-2 w-2 rounded-full bg-[#febc2e]/90" />
          <span className="h-2 w-2 rounded-full bg-[#28c840]/90" />
        </div>
        <Terminal className="h-3.5 w-3.5 text-emerald-400/80" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-tight text-emerald-100/95">
          AI-activiteit
        </span>
        {active && (
          <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-emerald-400/90">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Bezig
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-emerald-200/50 transition-colors hover:bg-white/10 hover:text-emerald-100"
          title="Venster sluiten (analyse loopt door)"
          aria-label="Venster sluiten"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Current agent bar ── */}
      {lastAgent ? (
        <div className="border-b border-white/[0.06] bg-[#0d1411] px-3 py-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-200/45">Agent</p>
          <p className="truncate font-mono text-[11px] text-cyan-200/90" title={lastAgent}>
            {lastAgent}
          </p>
        </div>
      ) : null}

      {/* ── Activity log ── */}
      <div
        ref={scrollRef}
        className="max-h-[min(38vh,300px)] min-h-[180px] overflow-y-auto overflow-x-hidden px-3 py-2.5 font-mono text-[11px] leading-snug [scrollbar-color:rgba(16,185,129,0.35)_transparent]"
      >
        {lines.length === 0 ? (
          <p className="text-emerald-100/45">Wachten op eerste stap…</p>
        ) : (
          <ul className="space-y-1.5">
            {lines.map((line, i) => (
              <li
                key={`${line.at}-${i}`}
                className="border-b border-white/[0.04] pb-1.5 last:border-b-0 last:pb-0"
              >
                <div className="flex gap-2.5">
                  <span className="w-9 shrink-0 tabular-nums text-right text-emerald-400/95">
                    {line.percentage}%
                  </span>
                  <span className="min-w-0 flex-1 break-words text-emerald-100/88">{line.step}</span>
                </div>
                {line.agent ? (
                  <p className="mt-0.5 pl-[2.875rem] font-mono text-[10px] leading-snug text-cyan-200/55">
                    via {line.agent}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Progress bar ── */}
      <div className="border-t border-white/[0.08] bg-[#111916] px-3 py-2.5">
        <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-emerald-200/50">
          <span>Voortgang</span>
          <span className="tabular-nums text-emerald-300/90">{lastPct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-black/40">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-400 transition-[width] duration-500 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, lastPct))}%` }}
          />
        </div>
      </div>

      {/* ── Token & model footer ── */}
      <div className="border-t border-white/[0.06] bg-[#090e0b] px-3 py-3 space-y-3">

        {(mainConfigured || risicoDisplay) && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200/50">
              <Settings2 className="h-3 w-3" />
              Geconfigureerde modellen
            </div>
            <div className="space-y-2 rounded-md border border-white/[0.06] bg-black/20 px-2 py-2">
              {mainConfigured && (
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-wide text-emerald-200/35">Hoofd-analyse</p>
                  <p className="font-mono text-[10px] text-cyan-200/85" title={mainConfigured}>
                    {mainConfigured}
                  </p>
                </div>
              )}
              {risicoDisplay && (
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-wide text-emerald-200/35">
                    Risico-inventarisatie
                  </p>
                  <p className="font-mono text-[10px] text-cyan-200/85" title={risicoDisplay.label}>
                    {risicoDisplay.label}
                  </p>
                  <p className="mt-0.5 text-[9px] leading-snug text-emerald-100/40">{risicoDisplay.hint}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {kimiCliNote && (
          <p className="text-[9px] leading-snug text-amber-200/50">{kimiCliNote}</p>
        )}

        {/* Active-session models */}
        {(sessionAgents.length > 0 || recentModels.length > 0) && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200/50">
              <Cpu className="h-3 w-3" />
              Sessie / laatste 8 uur
            </div>
            <div className="space-y-1">
              {/* Show from recent DB data (has token counts) if available, else from log lines */}
              {recentModels.length > 0
                ? recentModels.map((m) => (
                    <div key={m.label} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-mono text-[10px] text-cyan-200/75" title={m.label}>
                        {m.label}
                      </span>
                      <span className="shrink-0 tabular-nums text-[10px] text-emerald-300/80">
                        {formatTokens(m.inputTokens)}↑ {formatTokens(m.outputTokens)}↓
                      </span>
                    </div>
                  ))
                : sessionAgents.map((a) => (
                    <div key={a} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/70" />
                      <span className="min-w-0 truncate font-mono text-[10px] text-cyan-200/75" title={a}>
                        {a}
                      </span>
                    </div>
                  ))}
              {recentModels.length > 0 && recentTotal > 0 && (
                <div className="mt-0.5 flex justify-end">
                  <span className="text-[10px] text-emerald-400/60">
                    Huidig: <span className="font-semibold text-emerald-300/90">{formatTokens(recentTotal)}</span> tokens
                  </span>
                </div>
              )}
              {recentModels.length === 0 && sessionAgents.length > 0 && mainConfigured && (
                <p className="text-[9px] text-emerald-100/35">
                  Zodra het model API-calls afrondt, verschijnen hier tokenaantallen (database).
                </p>
              )}
            </div>
          </div>
        )}

        {/* 7-day summary */}
        <div className="border-t border-white/[0.06] pt-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200/50">
            <BarChart2 className="h-3 w-3" />
            Verbruik afgelopen 7 dagen
          </div>
          {statsError ? (
            <p className="text-[10px] text-amber-200/60">
              Kon tokenstatistieken niet laden. In web-modus: start{' '}
              <span className="font-mono">npm run dev:web</span> (dev-API) of gebruik de desktop-app.
            </p>
          ) : days7Models.length === 0 ? (
            <p className="text-[10px] text-emerald-100/30 italic">
              Nog geen registraties — na de eerste voltooide AI-aanroep (analyse, risico of locatiedetectie)
              verschijnen tokens en een indicatieve kostenraming.
            </p>
          ) : (
            <div className="space-y-1">
              {days7Models.map((m) => {
                const c = rowCost(m)
                return (
                  <div key={m.label} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-[10px] text-cyan-200/60" title={m.label}>
                      {m.label}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="tabular-nums text-[10px] text-emerald-300/70">{formatTokens(m.total)}</span>
                      {c != null && (
                        <span className="tabular-nums text-[9px] text-emerald-400/45">
                          ~ {formatEurIndicative(c)}
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
              <div className="mt-1 space-y-0.5 border-t border-white/[0.05] pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/40">Totaal</span>
                  <span className="tabular-nums text-[11px] font-bold text-emerald-300/90">
                    {formatTokens(days7Total)} tokens
                  </span>
                </div>
                {days7HasPricedRow && days7CostSum > 0 && (
                  <div className="flex items-center justify-end">
                    <span className="text-[10px] text-emerald-400/55">
                      Indicatief ~ {formatEurIndicative(days7CostSum)}
                    </span>
                  </div>
                )}
              </div>
              <p className="pt-1 text-[8px] leading-snug text-emerald-100/25">
                Kosten zijn schattingen op basis van gangbare API-tarieven; controleer je factuur bij de provider.
              </p>
            </div>
          )}
        </div>

        {/* Reset button */}
        <div className="border-t border-white/[0.06] pt-2.5">
          <button
            type="button"
            onClick={handleReset}
            onBlur={() => setResetConfirm(false)}
            disabled={resetting}
            className={`flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] font-semibold transition-colors ${
              resetConfirm
                ? 'bg-red-900/60 text-red-200 hover:bg-red-800/70 border border-red-700/50'
                : 'bg-white/[0.04] text-emerald-200/50 hover:bg-white/[0.08] hover:text-emerald-200/80 border border-white/[0.06]'
            }`}
          >
            <RotateCcw className={`h-3 w-3 ${resetting ? 'animate-spin' : ''}`} />
            {resetConfirm ? 'Zeker weten? Klik nogmaals om te resetten' : 'Tokenverbruik resetten'}
          </button>
        </div>
      </div>
    </div>
  )
}
