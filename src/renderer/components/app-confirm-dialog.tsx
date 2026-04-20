import type { ReactNode } from 'react'
import { Loader2, AlertTriangle, Info, FolderSync } from 'lucide-react'
import { cn } from '../lib/utils'

type Variant = 'default' | 'danger' | 'accent'

type Props = {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: Variant
  loading?: boolean
  /** Toon een foutmelding onder de beschrijving (bijv. na een mislukte actie). */
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function AppConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Bevestigen',
  cancelLabel = 'Annuleren',
  variant = 'default',
  loading,
  error,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null

  const iconWrap =
    variant === 'danger'
      ? 'bg-red-100'
      : variant === 'accent'
        ? 'bg-amber-100'
        : 'bg-[var(--muted)]'
  const Icon =
    variant === 'danger' ? AlertTriangle : variant === 'accent' ? FolderSync : Info
  const iconClass =
    variant === 'danger' ? 'text-red-600' : variant === 'accent' ? 'text-amber-700' : 'text-[var(--muted-foreground)]'

  const confirmBtn =
    variant === 'danger'
      ? 'bg-red-600 text-white hover:bg-red-700'
      : variant === 'accent'
        ? 'bg-amber-600 text-white hover:bg-amber-700'
        : 'bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90'

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-confirm-title"
      onClick={(e) => e.target === e.currentTarget && !loading && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-[var(--card)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3">
          <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full', iconWrap)}>
            <Icon className={cn('h-5 w-5', iconClass)} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="app-confirm-title" className="text-base font-semibold text-[var(--foreground)]">
              {title}
            </h2>
            <div className="mt-2 space-y-2 text-sm text-[var(--muted-foreground)]">{description}</div>
            {error ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm hover:bg-[var(--muted)] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50',
              confirmBtn
            )}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
