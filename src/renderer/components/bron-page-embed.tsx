import React, { useEffect, useRef, useState } from 'react'
import { X, Loader2, Globe } from 'lucide-react'
import { api, isElectron } from '../lib/ipc-client'

export function BronPageEmbedFrame({
  url,
  tenderId,
  className = '',
}: {
  url: string
  tenderId: string
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [partition, setPartition] = useState<string | null | undefined>(undefined)
  const [loadErr, setLoadErr] = useState(false)

  useEffect(() => {
    if (!isElectron || !tenderId) {
      setPartition(null)
      return
    }
    let cancelled = false
    void api.getBronEmbedPartition?.(tenderId)
      .then((r) => {
        if (!cancelled) setPartition(r?.partition ?? null)
      })
      .catch(() => {
        if (!cancelled) setPartition(null)
      })
    return () => {
      cancelled = true
    }
  }, [tenderId])

  useEffect(() => {
    setLoadErr(false)
  }, [url])

  useEffect(() => {
    if (!isElectron) return
    const wv = containerRef.current?.querySelector('webview')
    if (!wv) return
    const onFail = () => setLoadErr(true)
    const onOk = () => setLoadErr(false)
    wv.addEventListener('did-fail-load', onFail)
    wv.addEventListener('did-finish-load', onOk)
    return () => {
      wv.removeEventListener('did-fail-load', onFail)
      wv.removeEventListener('did-finish-load', onOk)
    }
  }, [url, partition])

  if (!isElectron) {
    return (
      <div className={`flex min-h-[50vh] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--muted)]/30 p-8 text-center text-sm text-[var(--muted-foreground)] ${className}`}>
        <Globe className="h-10 w-10 opacity-40" />
        <p>Ingesloten formulier is alleen beschikbaar in de desktop-app.</p>
      </div>
    )
  }

  if (partition === undefined) {
    return (
      <div className={`flex min-h-[50vh] items-center justify-center gap-2 text-[var(--muted-foreground)] ${className}`}>
        <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
        <span className="text-sm">Sessie voorbereiden…</span>
      </div>
    )
  }

  return (
    <div className={`flex min-h-[60vh] flex-col gap-2 ${className}`}>
      {loadErr && (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Laden is mislukt of geblokkeerd. Probeer «Open in systeembrowser».
        </p>
      )}
      <div ref={containerRef} className="min-h-[60vh] w-full flex-1 overflow-hidden rounded-lg border border-[var(--border)] bg-white">
        {React.createElement('webview', {
          key: url,
          src: url,
          ...(partition ? { partition } : {}),
          allowpopups: 'true',
          style: { width: '100%', height: '100%', minHeight: '60vh' },
        })}
      </div>
    </div>
  )
}

export function BronPageEmbedModal({
  open,
  url,
  title,
  tenderId,
  onClose,
}: {
  open: boolean
  url: string
  title: string
  tenderId: string
  onClose: () => void
}) {
  if (!open || !url) return null

  const openSysBrowser = () => {
    void api.openExternal(url)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bron-embed-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="bron-embed-title" className="text-sm font-semibold text-[var(--foreground)]">
              {title || 'Formulier'}
            </h2>
            <p className="mt-0.5 break-all text-xs text-[var(--muted-foreground)]">{url}</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={openSysBrowser}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--muted)]"
            >
              Open in systeembrowser
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              aria-label="Sluiten"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <BronPageEmbedFrame url={url} tenderId={tenderId} />
        </div>
      </div>
    </div>
  )
}
