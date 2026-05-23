import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  BellRing,
  CheckCheck,
  ChevronRight,
  FileText,
  Trash2,
  X,
  Sparkles,
} from 'lucide-react'
import { api } from '../lib/ipc-client'
import type { TenderUpdate } from '../../shared/types'

/** Geeft een leesbare reden-label terug. */
function redenLabel(reden: TenderUpdate['reden']): { label: string; icon: React.ReactNode; kleur: string } {
  if (reden === 'eerste_analyse') {
    return {
      label: 'Nieuw geanalyseerd',
      icon: <Sparkles className="h-3 w-3" />,
      kleur: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400',
    }
  }
  return {
    label: 'Nieuwe documenten',
    icon: <FileText className="h-3 w-3" />,
    kleur: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400',
  }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'zojuist'
  if (min < 60) return `${min} min geleden`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} uur geleden`
  const days = Math.floor(hr / 24)
  return `${days} dag${days > 1 ? 'en' : ''} geleden`
}

interface TenderUpdatesModalProps {
  unreadCount: number
  onCountChange: (count: number) => void
  onClose: () => void
}

export function TenderUpdatesModal({ unreadCount, onCountChange, onClose }: TenderUpdatesModalProps) {
  const [updates, setUpdates] = useState<TenderUpdate[]>([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const loadUpdates = async () => {
    setLoading(true)
    try {
      const list = (await (api as any).getTenderUpdates?.()) as TenderUpdate[] | undefined
      setUpdates(list ?? [])
    } finally {
      setLoading(false)
    }
  }

  const refreshCount = async () => {
    const count = (await (api as any).getTenderUpdatesCount?.()) as number | undefined
    onCountChange(count ?? 0)
  }

  useEffect(() => {
    void loadUpdates()
  }, [])

  const handleMarkAllRead = async () => {
    await (api as any).markAllTenderUpdatesRead?.()
    setUpdates((prev) => prev.map((u) => ({ ...u, is_gelezen: 1 as 0 | 1 })))
    onCountChange(0)
  }

  const handleClearAll = async () => {
    await (api as any).clearTenderUpdates?.()
    setUpdates([])
    onCountChange(0)
  }

  const handleClickItem = async (update: TenderUpdate) => {
    if (!update.is_gelezen) {
      await (api as any).markTenderUpdateRead?.(update.id)
      setUpdates((prev) =>
        prev.map((u) => (u.id === update.id ? { ...u, is_gelezen: 1 as 0 | 1 } : u))
      )
      await refreshCount()
    }
    onClose()
    navigate(`/aanbestedingen/${update.aanbesteding_id}`)
  }

  const unreadInList = updates.filter((u) => !u.is_gelezen).length

  return (
    <div className="fixed inset-0 z-[9000] flex items-start justify-end pt-16 pr-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />

          {/* Panel */}
          <div className="relative z-10 flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary)]/10">
                <BellRing className="h-4 w-4 text-[var(--primary)]" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">Aanbestedingsupdates</h2>
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  {updates.length === 0
                    ? 'Geen updates'
                    : `${updates.length} melding${updates.length !== 1 ? 'en' : ''}${unreadInList > 0 ? ` · ${unreadInList} ongelezen` : ''}`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {unreadInList > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    title="Alles als gelezen markeren"
                    className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                  >
                    <CheckCheck className="h-4 w-4" />
                  </button>
                )}
                {updates.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    title="Alle meldingen verwijderen"
                    className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center py-10">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
                </div>
              )}

              {!loading && updates.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Bell className="h-8 w-8 text-[var(--muted-foreground)]/40" />
                  <p className="text-sm text-[var(--muted-foreground)]">Geen updates gevonden</p>
                  <p className="text-[11px] text-[var(--muted-foreground)]/70">
                    Na een scrape verschijnen hier aanbestedingen met nieuwe documenten.
                  </p>
                </div>
              )}

              {!loading && updates.length > 0 && (
                <ul className="divide-y divide-[var(--border)]">
                  {updates.map((update) => {
                    const reden = redenLabel(update.reden)
                    return (
                      <li key={update.id}>
                        <button
                          type="button"
                          onClick={() => void handleClickItem(update)}
                          className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--muted)]/50 ${
                            !update.is_gelezen ? 'bg-[var(--primary)]/[0.03]' : ''
                          }`}
                        >
                          {/* Ongelezen indicator */}
                          <div className="mt-1.5 flex-shrink-0">
                            {!update.is_gelezen ? (
                              <span className="block h-2 w-2 rounded-full bg-[var(--primary)]" />
                            ) : (
                              <span className="block h-2 w-2 rounded-full bg-transparent" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${reden.kleur}`}>
                                {reden.icon}
                                {reden.label}
                              </span>
                            </div>
                            <p className={`text-xs font-medium leading-snug line-clamp-2 ${!update.is_gelezen ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'}`}>
                              {update.titel}
                            </p>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                              {update.opdrachtgever && (
                                <span className="truncate">{update.opdrachtgever}</span>
                              )}
                              {update.opdrachtgever && <span>·</span>}
                              <span>{formatRelativeTime(update.detected_at)}</span>
                            </div>
                          </div>

                          <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Footer */}
            {updates.length > 0 && (
              <div className="border-t border-[var(--border)] px-4 py-2.5">
                <p className="text-[10px] text-[var(--muted-foreground)]/60">
                  Klik op een aanbesteding om naar de details te gaan.
                </p>
              </div>
            )}
          </div>
    </div>
  )
}
export function TenderUpdatesBell({
  unreadCount,
  onClick,
}: {
  unreadCount: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Aanbestedingen met nieuwe informatie"
      aria-label={`Aanbestedingsupdates${unreadCount > 0 ? ` (${unreadCount} ongelezen)` : ''}`}
      className={`relative rounded-lg p-2 transition-colors ${
        unreadCount > 0
          ? 'text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20'
          : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
      }`}
    >
      {unreadCount > 0 ? (
        <BellRing className="h-5 w-5 animate-pulse" />
      ) : (
        <Bell className="h-5 w-5" />
      )}
      {unreadCount > 0 && (
        <>
          <span className="absolute right-1 top-1 h-3.5 w-3.5 animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        </>
      )}
    </button>
  )
}
