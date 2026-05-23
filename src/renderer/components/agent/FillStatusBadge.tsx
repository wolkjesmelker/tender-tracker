import { useEffect, useState } from 'react'
import { api } from '../../lib/ipc-client'
import type { AgentDocumentFillSummary } from '@shared/types'
import { cn } from '../../lib/utils'
import { CheckCircle2, Clock, AlertTriangle, CircleDot, Loader2, Download } from 'lucide-react'

interface Props {
  tenderId: string
  documentNaam: string
  className?: string
  /** Externe refresh-trigger (bv. na sluiten wizard). */
  refreshKey?: number
  /** Of een download-knop getoond moet worden. */
  showExport?: boolean
  /** Compacte variant: klein icoontje + (alleen bij user_started) percentage, geen label. */
  compact?: boolean
}

/**
 * Toont invulstatus voor één document:
 * - not_started  → grijs "Invulbaar"
 * - partial      → amber met voortgang + percentage
 * - complete     → groen checkmark "Volledig ingevuld"
 * - contradiction→ rood waarschuwing
 */
export function FillStatusBadge({ tenderId, documentNaam, className, refreshKey, showExport, compact }: Props) {
  const [summary, setSummary] = useState<AgentDocumentFillSummary | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportDone, setExportDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = (await api.agentGetFillSummary?.({ tenderId })) as AgentDocumentFillSummary[] | null
        if (cancelled) return
        const match = Array.isArray(rows) ? rows.find((r) => r.document_naam === documentNaam) : undefined
        setSummary(match || null)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tenderId, documentNaam, refreshKey])

  const handleExport = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setExporting(true)
    try {
      const res = (await api.agentExportFilledDocument?.({ tenderId, documentNaam, format: 'pdf' })) as {
        ok?: boolean
        error?: string
      } | null
      if (!res?.ok) {
        window.alert(res?.error || 'PDF-export mislukt.')
        return
      }
      setExportDone(true)
      setTimeout(() => setExportDone(false), 3000)
    } finally {
      setExporting(false)
    }
  }

  // Geen data: toon niets. Let op: sommige documenten hebben alleen een checklist
  // (geen formuliervelden). Die tellen we toch mee.
  if (!summary || (summary.total_fields === 0 && summary.checklist_total === 0)) return null

  const checklistPct =
    summary.checklist_total > 0
      ? Math.round((summary.checklist_done / summary.checklist_total) * 100)
      : 0
  const pct = summary.percentage
  const label = `${summary.filled_fields}/${summary.total_fields}`
  // Alleen een percentage tonen zodra de gebruiker zelf iets heeft ingevuld
  // óf minimaal één checklist-item heeft afgevinkt. AI-voorstellen alléén tellen
  // niet mee als “begonnen”.
  const started = summary.user_started || summary.checklist_done > 0

  if (compact) {
    const isComplete = summary.status === 'complete'
    const hasContra = summary.status === 'contradiction'
    const dotColor = hasContra
      ? 'bg-red-500'
      : isComplete && started
      ? 'bg-green-500'
      : started
      ? 'bg-amber-500'
      : 'bg-slate-300'
    const title = hasContra
      ? `${summary.contradictions} tegenstrijdigheid(en)`
      : isComplete
      ? 'Volledig ingevuld'
      : started
      ? `${pct}% velden · ${checklistPct}% checklist`
      : 'Nog niet begonnen'
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-[10px]', className)}
        title={title}
      >
        <span className={cn('inline-block h-2 w-2 rounded-full', dotColor)} />
        {started && !isComplete && (
          <span className="font-medium text-[var(--muted-foreground)]">
            {summary.total_fields > 0 ? `${pct}%` : `${checklistPct}%`}
          </span>
        )}
        {isComplete && <CheckCircle2 className="h-3 w-3 text-green-600" />}
      </span>
    )
  }

  const partialText = started
    ? summary.total_fields > 0
      ? `${label} · ${pct}%`
      : `${summary.checklist_done}/${summary.checklist_total} verzameld`
    : 'Invulbaar'
  const statusConfig = {
    not_started: {
      icon: <CircleDot className="h-3 w-3" />,
      text: 'Invulbaar',
      color: 'bg-blue-50 text-blue-700 border border-blue-200',
    },
    partial: {
      icon: <Clock className="h-3 w-3" />,
      text: partialText,
      color: started
        ? 'bg-amber-50 text-amber-800 border border-amber-200'
        : 'bg-blue-50 text-blue-700 border border-blue-200',
    },
    complete: {
      icon: <CheckCircle2 className="h-3 w-3 text-green-600" />,
      text: 'Volledig ingevuld',
      color: 'bg-green-50 text-green-800 border border-green-200',
    },
    contradiction: {
      icon: <AlertTriangle className="h-3 w-3 text-red-600" />,
      text: started ? `${label} · ⚠ Let op` : 'Invulbaar',
      color: 'bg-red-50 text-red-800 border border-red-200',
    },
  }

  const cfg = statusConfig[summary.status] ?? statusConfig.not_started
  const canExport = showExport && summary.filled_fields > 0

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
          cfg.color,
        )}
        title={
          summary.status === 'contradiction'
            ? `${summary.contradictions} tegenstrijdigheid(en)`
            : summary.status === 'complete'
            ? 'Alle velden ingevuld'
            : `${summary.percentage}% ingevuld — ${summary.filled_fields} van ${summary.total_fields} velden`
        }
      >
        {cfg.icon}
        <span>{cfg.text}</span>
      </span>
      {canExport && (
        <button
          type="button"
          onClick={(e) => void handleExport(e)}
          disabled={exporting}
          title="Ingevuld brondocument (PDF-formulier) opslaan"
          className="inline-flex items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          {exporting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : exportDone ? (
            <CheckCircle2 className="h-3 w-3 text-green-600" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          {exportDone ? 'Opgeslagen' : 'PDF'}
        </button>
      )}
    </span>
  )
}
