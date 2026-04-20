import { useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw, X, Sparkles, Shield } from 'lucide-react'
import { api, isElectron } from '../../lib/ipc-client'

interface UpdateInfo {
  version?: string
  releaseNotes?: string
}

/**
 * Modale update-melding.
 * Verschijnt automatisch als electron-updater een nieuwere versie detecteert.
 * Stap 1 — Beschikbaar: download-knop
 * Stap 2 — Gedownload: herstart-knop
 * Data in ~/Library/Application Support/tender-tracker/ blijft altijd bewaard.
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

    // Download-voortgang via generiek IPC-event indien beschikbaar
    const off3 = (api as any).onUpdateDownloadProgress?.((p: unknown) => {
      const pct = (p as { percent?: number })?.percent
      if (typeof pct === 'number') setProgress(Math.round(pct))
    })

    return () => {
      off1?.()
      off2?.()
      off3?.()
    }
  }, [])

  // Niet tonen buiten Electron, of als de gebruiker het wegklikte (en nog niet gedownload)
  if (!isElectron || dismissed || (!available && !downloaded)) return null

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
    /* Overlay */
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
    >
      {/* Modal card */}
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="relative bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 px-6 py-5 text-[var(--primary-foreground)]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 id="update-modal-title" className="text-base font-bold">
                {downloaded ? 'Update klaar om te installeren' : 'Nieuwe versie beschikbaar'}
              </h2>
              {available?.version && (
                <p className="text-sm text-white/75 mt-0.5">Versie {available.version}</p>
              )}
            </div>
          </div>
          {/* Sluit-knop (alleen vóór download) */}
          {!downloaded && !busy && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-white/60 hover:bg-white/15 hover:text-white transition-colors"
              aria-label="Later herinneren"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {!downloaded ? (
            <>
              <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
                Er is een nieuwe versie van TenderTracker beschikbaar. Download en installeer de update —
                al uw data en instellingen blijven volledig bewaard.
              </p>

              {/* Data-behoud badge */}
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30 px-3 py-2">
                <Shield className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                  Aanbestedingen, documenten en instellingen blijven bewaard
                </p>
              </div>

              {/* Progress bar (tijdens download) */}
              {busy && (
                <div className="space-y-1.5">
                  <div className="h-2 w-full rounded-full bg-[var(--muted)]">
                    <div
                      className="h-2 rounded-full bg-[var(--primary)] transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)] text-right">{progress}%</p>
                </div>
              )}

              {error && (
                <p className="text-xs text-red-600 rounded-lg bg-red-50 border border-red-200 px-3 py-2">{error}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
              De update is gedownload en klaar om te installeren. De app herstart automatisch en
              al uw data blijft bewaard.
            </p>
          )}
        </div>

        {/* Footer / knoppen */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--muted)]/30 px-6 py-4">
          {!downloaded && !busy && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-lg px-4 py-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              Later
            </button>
          )}

          {!downloaded && (
            <button
              type="button"
              disabled={busy}
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-5 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {busy
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Downloaden…</>
                : <><Download className="h-4 w-4" /> Downloaden & installeren</>
              }
            </button>
          )}

          {downloaded && (
            <button
              type="button"
              onClick={handleInstall}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-5 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
            >
              <RefreshCw className="h-4 w-4" />
              Nu herstarten en installeren
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
