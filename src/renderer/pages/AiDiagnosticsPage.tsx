import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, isElectron } from '../lib/ipc-client'
import type { AiDiagnosticsSnapshot } from '@shared/ai-diagnostics'
import { formatDateTimeNlFromSqliteUtc } from '@shared/date-format'
import { estimateTokenCostEur, formatEurIndicative } from '@shared/ai-pricing'
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  Stethoscope,
  AlertTriangle,
  Activity,
  Database,
  Cpu,
  Pause,
  Play,
  Euro,
} from 'lucide-react'

const AUTO_REFRESH_MS = 12_000

function formatDt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'medium' })
  } catch {
    return iso
  }
}

export function AiDiagnosticsPage() {
  const [snap, setSnap] = useState<AiDiagnosticsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [silentBusy, setSilentBusy] = useState(false)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (silent) setSilentBusy(true)
    else {
      setLoading(true)
      setError(null)
    }
    try {
      const data = (await api.getAiDiagnosticsSnapshot?.()) as AiDiagnosticsSnapshot | null
      if (!data || typeof data !== 'object') {
        setError('Geen geldige snapshot ontvangen.')
        if (!silent) setSnap(null)
        return
      }
      setSnap(data)
      if (silent) setError(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      if (!silent) setSnap(null)
    } finally {
      if (silent) setSilentBusy(false)
      else setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!autoRefresh) return

    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      void load({ silent: true })
    }

    const id = window.setInterval(tick, AUTO_REFRESH_MS)

    const onVis = () => {
      if (!document.hidden) void load({ silent: true })
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [autoRefresh, load])

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/instellingen"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <ArrowLeft className="h-4 w-4" />
            Instellingen
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]/40"
            title={autoRefresh ? 'Automatisch verversen uit' : 'Automatisch verversen aan (elke 12 s)'}
          >
            {autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {autoRefresh ? 'Auto uit' : 'Auto aan'}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium hover:bg-[var(--muted)]/40 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Vernieuwen
          </button>
        </div>
      </div>

      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Stethoscope className="h-6 w-6 text-[var(--primary)]" />
          AI- en risico-diagnose
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Intern overzicht om te zien of hoofdanalyse en risico-inventarisatie lopen zoals bedoeld. Geen API-sleutels;
          wel checkpoints, actieve jobs en recent modelgebruik (tokens). Met auto-verversen elke {AUTO_REFRESH_MS / 1000}{' '}
          seconden (pauzeert op een verborgen tabblad).
        </p>
        {autoRefresh && (
          <p className="mt-1 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            {silentBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--primary)]" aria-hidden /> : null}
            <span>Automatisch verversen staat aan.</span>
          </p>
        )}
        {!isElectron && (
          <p className="mt-2 text-sm text-amber-800">
            Je ziet een beperkte/dev-snapshot buiten de desktop-app.
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
      )}

      {loading && !snap ? (
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--primary)]" />
          Snapshot laden…
        </div>
      ) : null}

      {snap ? (
        <>
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Signalen &amp; uitleg
            </h2>
            <ul className="list-inside list-disc space-y-1.5 text-sm text-amber-950/90 dark:text-amber-50/90">
              {snap.hints.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>

          {snap.risico.running ? (
            <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-4 dark:bg-cyan-950/40">
              <h2 className="mb-2 text-sm font-semibold text-cyan-950 dark:text-cyan-100">
                Risico-analyse — live (uit voortgangs-kanaal, niet uit token-DB)
              </h2>
              {snap.risico.lastProgress ? (
                <dl className="space-y-1.5 text-xs text-cyan-950/90 dark:text-cyan-50/90">
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-[var(--muted-foreground)]">Tender</dt>
                    <dd className="font-mono text-[11px]">{snap.risico.aanbestedingId ?? '—'}</dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-[var(--muted-foreground)]">Voortgang</dt>
                    <dd className="tabular-nums font-medium">{snap.risico.lastProgress.percentage}%</dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-[var(--muted-foreground)]">Agent (UI-label)</dt>
                    <dd className="text-right">{snap.risico.lastProgress.agent}</dd>
                  </div>
                  <div>
                    <dt className="mb-0.5 text-[var(--muted-foreground)]">Stap</dt>
                    <dd className="rounded-md border border-cyan-500/20 bg-black/10 px-2 py-1.5 font-mono text-[11px] leading-snug dark:bg-black/25">
                      {snap.risico.lastProgress.step}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-[var(--muted-foreground)]">
                  Nog geen tussenstap ontvangen — binnen enkele seconden opnieuw verversen.
                </p>
              )}
              <p className="mt-2 text-[10px] leading-snug text-[var(--muted-foreground)]">
                IPC-label is altijd “risico-inventarisatie”; de echte API-call kan Kimi of (bij fallback) je hoofdmodel zijn — zie electron-log `[risico] LLM-call` / `[risico] Kimi`.
              </p>
            </div>
          ) : null}

          {/* Kostensamenvatting afgelopen 7 dagen */}
          <div className="rounded-xl border bg-[var(--card)] p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Euro className="h-4 w-4 text-[var(--primary)]" />
                Geschatte AI-kosten (afgelopen 7 dagen)
              </h3>
              {snap.tokenStats7d.totalEurOrNull !== null && (
                <span className="rounded-md bg-[var(--primary)]/10 px-2 py-0.5 text-sm font-semibold text-[var(--primary)]">
                  Totaal ≈ {formatEurIndicative(snap.tokenStats7d.totalEurOrNull)}
                </span>
              )}
            </div>
            <p className="mb-3 text-[11px] text-[var(--muted-foreground)]">
              Indicatief op basis van gepubliceerde tokentarieven. Kimi K2: $2/$6 per 1M tokens (in/uit). Claude Sonnet: $3/$15. Ollama en Kimi CLI zijn gratis.
            </p>
            {snap.tokenStats7d.byModel.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">Geen token-gebruik geregistreerd in de afgelopen 7 dagen.</p>
            ) : (
              <div className="overflow-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--muted)]/40">
                    <tr>
                      <th className="px-3 py-2 font-medium">Provider · Model</th>
                      <th className="px-3 py-2 text-right font-medium">Input tokens</th>
                      <th className="px-3 py-2 text-right font-medium">Output tokens</th>
                      <th className="px-3 py-2 text-right font-medium">Kosten (≈)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.tokenStats7d.byModel.map((r, i) => (
                      <tr key={i} className="border-t border-[var(--border)]">
                        <td className="px-3 py-1.5 font-medium">{r.label}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[var(--muted-foreground)]">
                          {r.inputTokens.toLocaleString('nl-NL')}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[var(--muted-foreground)]">
                          {r.outputTokens.toLocaleString('nl-NL')}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                          {r.estimatedEurOrNull !== null
                            ? formatEurIndicative(r.estimatedEurOrNull)
                            : <span className="text-[var(--muted-foreground)]">—</span>}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-[var(--border)] bg-[var(--muted)]/20">
                      <td className="px-3 py-1.5 font-semibold">Totaal</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                        {snap.tokenStats7d.totalInputTokens.toLocaleString('nl-NL')}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                        {snap.tokenStats7d.totalOutputTokens.toLocaleString('nl-NL')}
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-[var(--primary)]">
                        {snap.tokenStats7d.totalEurOrNull !== null
                          ? formatEurIndicative(snap.tokenStats7d.totalEurOrNull)
                          : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-[var(--card)] p-4 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Activity className="h-4 w-4 text-[var(--primary)]" />
                Actieve pipeline
              </h3>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Losse analyse</dt>
                  <dd>{snap.pipeline.singleRunning ? `bezig (${snap.pipeline.singleAnalysisId ?? '?'})` : 'nee'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Batch</dt>
                  <dd>
                    {snap.pipeline.batchRunning
                      ? `ja ${snap.pipeline.batchCurrent}/${snap.pipeline.batchTotal} — ${snap.pipeline.batchCurrentTitle?.slice(0, 48) || snap.pipeline.batchCurrentId}`
                      : 'nee'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Wachtrij losse analyses</dt>
                  <dd>{snap.pipeline.pendingSingleAnalysisIds.length}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Post-scrape wachtrij</dt>
                  <dd>{snap.pipeline.pendingPostScrapeIdsCount}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Risico-run</dt>
                  <dd>
                    {snap.risico.running
                      ? `bezig (${snap.risico.aanbestedingId ?? '?'})`
                      : `nee — wachtrij ${snap.risico.queuedCount}`}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Parallelle LLM-chunks (max)</dt>
                  <dd>{snap.llmChunkConcurrency}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Busy-work / powerSave</dt>
                  <dd>
                    ref {snap.busyWork.refCount}
                    {snap.busyWork.powerSaveActive ? ' · actief' : ''}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border bg-[var(--card)] p-4 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Cpu className="h-4 w-4 text-[var(--primary)]" />
                AI-instellingen (samenvatting)
              </h3>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Provider / model</dt>
                  <dd className="text-right">
                    {snap.aiSettings.ai_provider} · {snap.aiSettings.ai_model}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Hoofd-api-key gezet</dt>
                  <dd>{snap.aiSettings.hasAiApiKey ? 'ja' : 'nee'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Moonshot-key gezet</dt>
                  <dd>{snap.aiSettings.hasMoonshotKey ? 'ja' : 'nee'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Moonshot base URL aangepast</dt>
                  <dd>{snap.aiSettings.moonshotBaseConfigured ? 'ja' : 'nee (default)'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Kimi CLI-pad gezet</dt>
                  <dd>{snap.aiSettings.kimiCliPathConfigured ? 'ja' : 'nee'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Ollama-endpoint</dt>
                  <dd className="truncate text-right">{snap.aiSettings.ollamaBaseUrl}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="rounded-xl border bg-[var(--card)] p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Database className="h-4 w-4 text-[var(--primary)]" />
              Database &amp; tenders
            </h3>
            <p className="mb-2 break-all font-mono text-[11px] text-[var(--muted-foreground)]">{snap.databasePath}</p>
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-[var(--muted-foreground)]">Open checkpoints</dt>
                <dd className="font-medium">{snap.tenderSignals.withCheckpoint}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">Checkpoint &gt; 6 uur oud (mogelijk vast)</dt>
                <dd className="font-medium">{snap.tenderSignals.staleCheckpoints}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">Score maar geen risico-JSON</dt>
                <dd className="font-medium">{snap.tenderSignals.withScoreNoRisico}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted-foreground)]">Met risico-inventarisatie</dt>
                <dd className="font-medium">{snap.tenderSignals.withRisico}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border bg-[var(--card)] p-4 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Token-events (recent)</h3>
              <span className="text-xs text-[var(--muted-foreground)]">
                2 min: {snap.tokenEventsLast2Min} · 15 min: {snap.tokenEventsLast15Min} · 6 u:{' '}
                {snap.tokenEventsLast6h} (waarvan Kimi/Moonshot: {snap.kimiTokenEventsLast6h}) · snapshot:{' '}
                {formatDt(snap.collectedAt)}
              </span>
            </div>
            <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">
              Tabel = laatste invoegen + apart Kimi/Moonshot (anders verdrinken die in honderden kleine hoofd-AI-calls).
              Registratie gebeurt pas als een API-aanroep klaar is (geen tokens tijdens een hangende request).
              Tijden: database bewaart UTC; hier weergegeven in lokale tijd.
            </p>
            <div className="max-h-56 overflow-auto rounded-lg border">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-[var(--muted)]/40">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Tijd</th>
                    <th className="px-2 py-1.5 font-medium">Provider</th>
                    <th className="px-2 py-1.5 font-medium">Model</th>
                    <th className="px-2 py-1.5 font-medium text-right">In</th>
                    <th className="px-2 py-1.5 font-medium text-right">Uit</th>
                    <th className="px-2 py-1.5 font-medium text-right">Kosten (≈)</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.tokenEventsRecent.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-2 py-3 text-[var(--muted-foreground)]">
                        Geen token-regels (of provider registreert geen usage).
                      </td>
                    </tr>
                  ) : (
                    snap.tokenEventsRecent.map((r) => {
                      const cost = estimateTokenCostEur(r.provider, r.model, r.inputTokens, r.outputTokens)
                      return (
                        <tr key={r.id} className="border-t border-[var(--border)]">
                          <td className="px-2 py-1 whitespace-nowrap">
                            {formatDateTimeNlFromSqliteUtc(r.createdAt)}
                          </td>
                          <td className="px-2 py-1">{r.provider}</td>
                          <td className="px-2 py-1">{r.model}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.inputTokens}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.outputTokens}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-[var(--muted-foreground)]">
                            {cost !== null ? formatEurIndicative(cost) : '—'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border bg-[var(--card)] p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold">Analyse-checkpoints (detail)</h3>
            <div className="max-h-96 overflow-auto rounded-lg border">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-[var(--muted)]/40">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Tender</th>
                    <th className="px-2 py-1.5 font-medium">Bijgewerkt</th>
                    <th className="px-2 py-1.5 font-medium">Fase</th>
                    <th className="px-2 py-1.5 font-medium text-right">Blokken</th>
                    <th className="px-2 py-1.5 font-medium text-right">Tekens</th>
                    <th className="px-2 py-1.5 font-medium">AI-fase</th>
                    <th className="px-2 py-1.5 font-medium">Criteria-chunks</th>
                    <th className="px-2 py-1.5 font-medium">Bron / DB</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.checkpoints.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-2 py-3 text-[var(--muted-foreground)]">
                        Geen open checkpoints — analyses zijn afgerond of niet gestart.
                      </td>
                    </tr>
                  ) : (
                    snap.checkpoints.map((c) => (
                      <tr key={c.tenderId} className="border-t border-[var(--border)] align-top">
                        <td className="px-2 py-1">
                          <Link
                            to={`/aanbestedingen/${c.tenderId}`}
                            className="text-[var(--primary)] hover:underline"
                          >
                            {(c.titel || c.tenderId).slice(0, 56)}
                          </Link>
                          {!c.parseOk && (
                            <span className="ml-1 text-red-600">(parse fout)</span>
                          )}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {formatDateTimeNlFromSqliteUtc(c.updatedAt)}
                        </td>
                        <td className="px-2 py-1">{c.stage ?? '—'}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{c.documentBlocks}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{Math.round(c.totalChars / 1000)}k</td>
                        <td className="px-2 py-1">{c.aiPhase ?? '—'}</td>
                        <td className="px-2 py-1">
                          {c.criteriaChunksTotal != null
                            ? `${c.criteriaChunksCompleted ?? 0}/${c.criteriaChunksTotal}`
                            : '—'}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {c.bronProgress} · {c.dbProgress}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
