import { useEffect, useState, useCallback, useRef } from 'react'
import { X, Download, FolderOpen, Loader2, AlertCircle, FileText } from 'lucide-react'
import { api, isElectron } from '../lib/ipc-client'
import { shouldLoadBronUrlInEmbeddedBrowser } from '../../shared/bron-embed'
import { BronPageEmbedFrame } from './bron-page-embed'

export type LocalStoredFile = { naam: string; size: number }

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

type ZipEntry = { name: string; size: number; isDirectory: boolean }

type ReadResult =
  | { success: true; kind: 'text'; text: string; truncated?: boolean; mime: string; size: number }
  | { success: true; kind: 'data_url'; base64: string; mime: string; size: number }
  | { success: true; kind: 'file_url'; url: string; mime: string; size: number }
  | { success: true; kind: 'html_preview'; html: string; truncated?: boolean; size: number }
  | {
      success: true
      kind: 'spreadsheet_preview'
      sheetName: string
      rows: string[][]
      truncated: boolean
      size: number
    }
  | { success: true; kind: 'zip_preview'; entries: ZipEntry[]; truncated: boolean; size: number }
  | { success: true; kind: 'no_preview'; mime: string; size: number; reason: 'large' | 'binary' }
  | { success: false; error: string }

export type BronDocumentSource = { url: string; fileName: string; tenderId: string }

export function LocalDocumentPreviewModal({
  open,
  tenderId,
  file,
  bronSource,
  onClose,
  onUnavailable,
}: {
  open: boolean
  tenderId: string
  file: LocalStoredFile | null
  /** Bronlink uit de documentenlijst (TenderNed e.d.); download in de main process enzelfde preview. */
  bronSource?: BronDocumentSource | null
  onClose: () => void
  /** Called when the document can't be opened in-app AND also fails to open externally. */
  onUnavailable?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<ReadResult | null>(null)
  const [saving, setSaving] = useState(false)
  const unavailableCalledRef = useRef(false)

  const isBron = Boolean(bronSource?.url)
  const embedInApp =
    isElectron &&
    isBron &&
    bronSource &&
    shouldLoadBronUrlInEmbeddedBrowser(bronSource.fileName, bronSource.url)

  useEffect(() => {
    if (!open || !tenderId) {
      setPreview(null)
      setError('')
      return
    }
    if (isBron) {
      if (!bronSource) {
        setPreview(null)
        setError('')
        return
      }
    } else if (!file) {
      setPreview(null)
      setError('')
      return
    }

    if (
      isBron &&
      bronSource &&
      isElectron &&
      shouldLoadBronUrlInEmbeddedBrowser(bronSource.fileName, bronSource.url)
    ) {
      setPreview(null)
      setError('')
      setLoading(false)
      return
    }

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      setPreview(null)
      try {
        const r = (isBron
          ? await api.previewBronDocument(bronSource!.url, bronSource!.fileName, bronSource!.tenderId)
          : await api.readLocalTenderDocument(tenderId, file!.naam)) as ReadResult
        if (cancelled) return
        if (!r || typeof r !== 'object') {
          setError('Onbekende reactie van de app')
          return
        }
        if (!('success' in r) || !r.success) {
          setError('error' in r ? String(r.error) : 'Voorbeeld laden mislukt')
          return
        }
        setPreview(r)
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Fout bij laden')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, tenderId, file?.naam, file?.size, isBron, bronSource?.url, bronSource?.fileName, bronSource?.tenderId])

  // When preview resolves to no_preview (unsupported binary), automatically try to open externally.
  // If external open succeeds → close the modal. If it also fails → call onUnavailable.
  useEffect(() => {
    if (!open) {
      unavailableCalledRef.current = false
      return
    }
    if (!preview || !preview.success || preview.kind !== 'no_preview' || preview.reason !== 'binary') return
    if (unavailableCalledRef.current) return
    ;(async () => {
      try {
        const r = (isBron && bronSource
          ? await api.openBronDocumentExternal(bronSource.url, bronSource.fileName, bronSource.tenderId)
          : file
            ? await api.openLocalTenderDocumentExternal(tenderId, file.naam)
            : { success: false }) as { success?: boolean; error?: string }
        if (r?.success) {
          onClose()
        } else {
          unavailableCalledRef.current = true
          onUnavailable?.()
        }
      } catch {
        unavailableCalledRef.current = true
        onUnavailable?.()
      }
    })()
  }, [open, preview, isBron, bronSource, file, tenderId, onClose, onUnavailable])

  const handleDownload = useCallback(async () => {
    if (!tenderId) return
    setSaving(true)
    setError('')
    try {
      if (isBron && bronSource) {
        const r = (await api.saveBronDocumentAs(
          bronSource.url,
          bronSource.fileName,
          bronSource.tenderId
        )) as { success?: boolean; error?: string }
        if (!r?.success && r?.error && r.error !== 'Geannuleerd') {
          setError(r.error)
        }
      } else if (file) {
        const r = (await api.saveLocalTenderDocumentAs(tenderId, file.naam)) as {
          success?: boolean
          error?: string
        }
        if (!r?.success && r?.error && r.error !== 'Geannuleerd') {
          setError(r.error)
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Opslaan mislukt')
    } finally {
      setSaving(false)
    }
  }, [tenderId, file, isBron, bronSource])

  const handleOpenExternal = useCallback(async () => {
    if (!tenderId) return
    setError('')
    try {
      const r = (isBron && bronSource
        ? await api.openBronDocumentExternal(bronSource.url, bronSource.fileName, bronSource.tenderId)
        : file
          ? await api.openLocalTenderDocumentExternal(tenderId, file.naam)
          : { success: false }) as {
        success?: boolean
        error?: string
      }
      if (!r?.success) setError(r?.error || 'Openen met standaard-app mislukt')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Openen mislukt')
    }
  }, [tenderId, file, isBron, bronSource])

  if (!open || (!file && !bronSource)) return null

  const displayFileName = bronSource?.fileName ?? file!.naam
  const sizeSubtitle =
    preview?.success ? formatBytes(preview.size) : file ? formatBytes(file.size) : 'Bronlink — wordt geladen'

  const dataUrl =
    preview && preview.success && preview.kind === 'data_url'
      ? `data:${preview.mime};base64,${preview.base64}`
      : null

  const isPdf = preview?.success && preview.kind === 'data_url' && preview.mime === 'application/pdf'
  const isImage =
    preview?.success && preview.kind === 'data_url' && preview.mime.startsWith('image/')
  const isFileUrl = preview?.success && preview.kind === 'file_url'
  const fileUrlIsPdf = isFileUrl && preview.success && 'mime' in preview && preview.mime === 'application/pdf'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="local-doc-preview-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="local-doc-preview-title" className="text-sm font-semibold text-[var(--foreground)]">
              {displayFileName}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{sizeSubtitle}</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--muted)] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Opslaan als…
            </button>
            <button
              type="button"
              onClick={
                embedInApp && bronSource
                  ? () => void api.openExternal(bronSource.url)
                  : handleOpenExternal
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--muted)]"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {embedInApp ? 'Open in systeembrowser' : 'Extern openen'}
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

        <div className="min-h-[200px] flex-1 overflow-auto p-4">
          {embedInApp && bronSource ? (
            <BronPageEmbedFrame url={bronSource.url} tenderId={tenderId} />
          ) : null}

          {!embedInApp && error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!embedInApp && loading && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-[var(--muted-foreground)]">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
              <p className="text-sm">Voorbeeld laden…</p>
            </div>
          )}

          {!embedInApp && !loading && preview?.success && preview.kind === 'text' && (
            <div className="space-y-2">
              {preview.truncated && (
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Alleen het begin van het bestand wordt getoond (max. tekstlengte).
                </p>
              )}
              {displayFileName.toLowerCase().endsWith('.xml') && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  XML is opgemaakt met inspringing zodat de structuur leesbaar is.
                </p>
              )}
              <pre
                className={`max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-3 text-xs leading-relaxed text-[var(--foreground)] ${
                  /\.(xml|json)$/i.test(displayFileName) ? 'font-mono' : ''
                }`}
              >
                {preview.text}
              </pre>
            </div>
          )}

          {!embedInApp && !loading && preview?.success && preview.kind === 'data_url' && isPdf && dataUrl && (
            <iframe title="PDF-voorbeeld" src={dataUrl} className="doc-preview-light h-[70vh] w-full rounded-lg border border-[var(--border)]" />
          )}

          {!embedInApp && !loading && preview?.success && preview.kind === 'file_url' && fileUrlIsPdf && (
            <iframe
              title="PDF-voorbeeld"
              src={(preview as { kind: 'file_url'; url: string }).url}
              className="doc-preview-light h-[70vh] w-full rounded-lg border border-[var(--border)]"
            />
          )}

          {!embedInApp && !loading && preview?.success && preview.kind === 'data_url' && isImage && dataUrl && (
            <div className="flex justify-center">
              <img src={dataUrl} alt={displayFileName} className="doc-preview-light max-h-[70vh] max-w-full object-contain rounded-lg border border-[var(--border)]" />
            </div>
          )}

          {!embedInApp && !loading && preview?.success && preview.kind === 'html_preview' && (
            <div className="space-y-2">
              {preview.truncated && (
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Alleen het begin van het document wordt getoond (max. omvang).
                </p>
              )}
              <iframe
                title="HTML-voorbeeld"
                srcDoc={preview.html}
                sandbox=""
                className="doc-preview-light h-[65vh] w-full rounded-lg border border-[var(--border)]"
              />
            </div>
          )}

          {!embedInApp && !loading && preview?.success && preview.kind === 'spreadsheet_preview' && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--muted-foreground)]">
                Werkblad: <span className="font-medium text-[var(--foreground)]">{preview.sheetName}</span>
                {preview.truncated && ' — eerste rijen (lange tabellen worden afgekapt).'}
              </p>
              <div className="max-h-[65vh] overflow-auto rounded-lg border border-[var(--border)]">
                <table className="w-full border-collapse text-left text-xs">
                  <tbody>
                    {preview.rows.map((row, ri) => (
                      <tr key={ri} className={ri === 0 ? 'bg-[var(--muted)]/60 font-medium' : ''}>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className="max-w-[14rem] truncate border border-[var(--border)] px-2 py-1 align-top text-[var(--foreground)]"
                            title={cell}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!embedInApp && !loading && preview?.success && preview.kind === 'zip_preview' && (
            <div className="space-y-2">
              {preview.truncated && (
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Alleen de eerste {preview.entries.length} items van het archief worden getoond.
                </p>
              )}
              <ul className="max-h-[65vh] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3 font-mono text-xs text-[var(--foreground)]">
                {preview.entries.map((e, i) => (
                  <li key={i} className="flex gap-2 border-b border-[var(--border)]/50 py-1 last:border-0">
                    <span className="min-w-0 flex-1 truncate" title={e.name}>
                      {e.isDirectory ? `[map] ${e.name}` : e.name}
                    </span>
                    <span className="flex-shrink-0 text-[var(--muted-foreground)]">
                      {e.isDirectory ? '—' : formatBytes(e.size)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!embedInApp && !loading && preview?.success && preview.kind === 'no_preview' && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--muted)]/30 px-6 py-12 text-center">
              <FileText className="h-10 w-10 text-[var(--muted-foreground)]" />
              <p className="text-sm font-medium text-[var(--foreground)]">Geen ingebouwd voorbeeld</p>
              {preview.reason === 'binary' ? (
                <p className="max-w-md text-xs text-[var(--muted-foreground)] leading-relaxed">
                  Bestand wordt geopend met de standaard-app op je computer…
                </p>
              ) : (
                <p className="max-w-md text-xs text-[var(--muted-foreground)] leading-relaxed">
                  Dit bestand is groter dan 20 MB. Gebruik «Opslaan als…» om het te exporteren, of «Extern openen» om het in je standaardprogramma te bekijken.
                </p>
              )}
              {error ? (
                <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
