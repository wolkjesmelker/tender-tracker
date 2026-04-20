import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, StopCircle, FolderSync } from 'lucide-react'
import { useScrapeSessionStore } from '../stores/scrape-session-store'
import { api, isElectron } from '../lib/ipc-client'

export function DocumentFetchResumeBanner() {
  const progress = useScrapeSessionStore((s) => s.progress)
  const p = progress.find((x) => x.jobId === 'doc-fetch-resume')
  const running = isElectron && p?.status === 'bezig'
  const [stopBusy, setStopBusy] = useState(false)
  const [stopErr, setStopErr] = useState<string | null>(null)

  if (!running) return null

  const handleStop = async () => {
    setStopErr(null)
    setStopBusy(true)
    try {
      const res = (await api.stopPendingDocumentFetch()) as { success?: boolean; error?: string }
      if (!res?.success) setStopErr(res?.error || 'Stoppen mislukt')
    } catch (e) {
      setStopErr(e instanceof Error ? e.message : 'Stoppen mislukt')
    } finally {
      setStopBusy(false)
    }
  }

  return (
    <div className="titlebar-no-drag border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FolderSync className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
          <span className="min-w-0 truncate">
            <span className="font-medium">Documentophalen op de achtergrond:</span>{' '}
            <span className="text-amber-900/90 dark:text-amber-200/90">{p.message}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {stopErr && <span className="text-xs text-red-700 dark:text-red-300">{stopErr}</span>}
          <Link
            to="/tracking"
            className="rounded-md border border-amber-300 bg-white/80 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-white dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100"
          >
            Naar Tracking
          </Link>
          <button
            type="button"
            onClick={() => void handleStop()}
            disabled={stopBusy}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-200 dark:hover:bg-red-950/80"
          >
            {stopBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <StopCircle className="h-3.5 w-3.5" />}
            Stoppen
          </button>
        </div>
      </div>
    </div>
  )
}
