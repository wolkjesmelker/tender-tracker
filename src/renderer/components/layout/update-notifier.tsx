import { useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw, X, Sparkles } from 'lucide-react'
import { api, isElectron } from '../../lib/ipc-client'

interface UpdateInfo {
  version?: string
  releaseNotes?: string
}

/**
 * Toast rechtsonder: nieuwe versie → knop "Update naar versie x.xx";
 * na download → herstart om te installeren.
 */
export function UpdateNotifier() {
  const [available, setAvailable] = useState<UpdateInfo | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!isElectron) return

    const off1 = api.onUpdateAvailable?.((info: unknown) => {
      const v = info as UpdateInfo
      setAvailable({ version: v?.version, releaseNotes: typeof v?.releaseNotes === 'string' ? v.releaseNotes : undefined })
      setDismissed(false)
    })

    const off2 = api.onUpdateDownloaded?.((info: unknown) => {
      const v = info as UpdateInfo
      if (v?.version) setAvailable(prev => ({ ...prev, version: v.version }))
      setDownloaded(true)
      setBusy(false)
      setProgress(100)
    })

    const off3 = api.onUpdateDownloadProgress?.((p: unknown) => {
      const pct = (p as { percent?: number })?.percent
      if (typeof pct === 'number') setProgress(Math.round(pct))
    })

    return () => {
      off1?.()
      off2?.()
      off3?.()
    }
  }, [])

  if (!isElectron || dismissed || (!available && !downloaded)) return null

  const ver = available?.version ?? ''

  const handleDownload = async () => {
    setError('')
    setBusy(true)
    setProgress(0)
    try {
      await api.downloadAppUpdate?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download mislukt')
      setBusy(false)
    }
  }

  const handleInstall = () => {
    api.installAppUpdate?.()
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-[200] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
      role="dialog"
      aria-labelledby="update-toast-title"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)]/15 text-[var(--primary)]">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 id="update-toast-title" className="text-sm font-semibold text-[var(--foreground)]">
                {downloaded ? 'Installatie klaar' : 'Nieuwe versie beschikbaar'}
              </h2>
              {!downloaded && ver ? (
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Versie {ver}</p>
              ) : null}
            </div>
            {!busy && (
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                aria-label="Sluiten"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {!downloaded ? (
            <>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                Uw gegevens blijven behouden na de update.
              </p>
              {busy && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full rounded-full bg-[var(--muted)]">
                    <div
                      className="h-1.5 rounded-full bg-[var(--primary)] transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-[var(--muted-foreground)] text-right">{progress}%</p>
                </div>
              )}
              {error ? (
                <p className="text-xs text-red-600 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-2 py-1.5">
                  {error}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
              Start de app opnieuw om bij te werken.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--muted)]/25 px-4 py-3">
        {!downloaded && !busy ? (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            Later
          </button>
        ) : null}

        {!downloaded ? (
          <button
            type="button"
            disabled={busy}
            onClick={handleDownload}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Downloaden…
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                {ver ? `Update naar versie ${ver}` : 'Update downloaden'}
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleInstall}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Nu herstarten
          </button>
        )}
      </div>
    </div>
  )
}
