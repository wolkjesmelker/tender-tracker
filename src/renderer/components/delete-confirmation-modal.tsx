import { Loader2, AlertTriangle } from 'lucide-react'

type Props = {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmationModal({
  open,
  title,
  description,
  confirmLabel = 'Verwijderen',
  loading,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && !loading && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-xl border bg-[var(--card)] p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{description}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-[var(--muted)] disabled:opacity-50"
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
