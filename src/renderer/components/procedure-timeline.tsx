import React, { useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import type { ProcedureTimelineStep, TenderProcedureContext } from '../../shared/types'
import { formatDate, formatDateTime } from '../lib/utils'

function formatApiValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** TenderNed API levert CPV/NUTS vaak als objecten met code + omschrijving — geen raw JSON tonen. */
function formatCpvOrNutsList(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return null

  let data: unknown = value
  if (typeof value === 'string') {
    const t = value.trim()
    if (t.startsWith('[') || t.startsWith('{')) {
      try {
        data = JSON.parse(t) as unknown
      } catch {
        return <span className="text-xs leading-relaxed break-words">{value}</span>
      }
    } else {
      return <span className="text-xs leading-relaxed break-words">{value}</span>
    }
  }

  if (!Array.isArray(data)) {
    return <span className="text-xs leading-relaxed break-words">{formatApiValue(data)}</span>
  }

  return (
    <ul className="mt-1 space-y-2 list-none">
      {data.map((item, i) => {
        if (item && typeof item === 'object' && 'code' in item) {
          const o = item as {
            code?: string
            omschrijving?: string
            isHoofdOpdracht?: boolean
          }
          return (
            <li key={i} className="text-xs leading-relaxed text-[var(--foreground)]">
              <span className="font-mono text-[11px] text-[var(--foreground)]">{o.code ?? '—'}</span>
              {o.omschrijving ? (
                <span className="text-[var(--muted-foreground)]"> — {o.omschrijving}</span>
              ) : null}
              {o.isHoofdOpdracht ? (
                <span className="ml-1.5 rounded bg-[var(--primary)]/10 px-1 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                  hoofdopdracht
                </span>
              ) : null}
            </li>
          )
        }
        return (
          <li key={i} className="text-xs leading-relaxed break-words">
            {formatApiValue(item)}
          </li>
        )
      })}
    </ul>
  )
}

export function ProcedureOverviewCard({
  context,
}: {
  context: TenderProcedureContext | null
}) {
  const [modalStep, setModalStep] = useState<ProcedureTimelineStep | null>(null)

  if (!context) return null

  const h = context.apiHighlights

  return (
    <>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
        <h2 className="text-base font-semibold mb-1">Procedure en bronnen</h2>
        <p className="text-xs text-[var(--muted-foreground)] mb-4">
          Gegevens uit de bron (o.a. TenderNed API) en verzamelde portals. Klik op een tijdslijnstap voor details en links.
        </p>

        {h && (
          <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2 text-sm">
            {h.kenmerk && (
              <div>
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Kenmerk</span>
                <p className="font-medium">{h.kenmerk}</p>
              </div>
            )}
            {h.procedureCode && (
              <div>
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Procedure</span>
                <p className="font-medium">{h.procedureCode}</p>
              </div>
            )}
            {(h.typePublicatie || h.typePublicatieCode) && (
              <div>
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Type publicatie</span>
                <p className="font-medium">
                  {[h.typePublicatie, h.typePublicatieCode].filter(Boolean).join(' · ')}
                </p>
              </div>
            )}
            {h.aanbestedingStatus && (
              <div>
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Status</span>
                <p className="font-medium">{h.aanbestedingStatus}</p>
              </div>
            )}
            {h.publicatieDatum && (
              <div>
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Publicatiedatum</span>
                <p className="font-medium">{formatDate(h.publicatieDatum)}</p>
              </div>
            )}
            {h.sluitingsDatum && (
              <div>
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Sluiting inschrijving</span>
                <p className="font-medium text-red-600">{formatDate(h.sluitingsDatum)}</p>
              </div>
            )}
            {h.sluitingsDatumMarktconsultatie && (
              <div>
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Marktconsultatie</span>
                <p className="font-medium">{formatDate(h.sluitingsDatumMarktconsultatie)}</p>
              </div>
            )}
            {h.cpvCodes != null && (
              <div className="sm:col-span-2">
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">CPV</span>
                <div>{formatCpvOrNutsList(h.cpvCodes)}</div>
              </div>
            )}
            {h.nutsCodes != null && (
              <div className="sm:col-span-2">
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">NUTS</span>
                <div>{formatCpvOrNutsList(h.nutsCodes)}</div>
              </div>
            )}
          </div>
        )}

        {context.timeline.length > 0 && (
          <div className="relative">
            <div
              className="absolute left-4 top-2 bottom-2 w-px bg-[var(--border)]"
              aria-hidden
            />
            <ul className="space-y-5">
              {context.timeline.map((step) => (
                <li key={step.id} className="relative flex gap-4">
                  <div className="relative z-[1] flex w-8 shrink-0 justify-center pt-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-[var(--primary)] ring-[3px] ring-[var(--card)]"
                      aria-hidden
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setModalStep(step)}
                    className="min-w-0 flex-1 text-left rounded-lg py-1 pr-2 hover:bg-[var(--muted)]/40 transition-colors"
                  >
                    <p className="text-xs font-semibold text-[var(--foreground)]">{step.label}</p>
                    {step.date && (
                      <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{formatDate(step.date)}</p>
                    )}
                    {step.detail && (
                      <p className="text-[11px] text-[var(--muted-foreground)] mt-1 line-clamp-2">{step.detail}</p>
                    )}
                    {(step.links?.length ?? 0) > 0 && (
                      <p className="text-[10px] text-[var(--primary)] mt-1">
                        {step.links!.length} link{step.links!.length !== 1 ? 's' : ''} — tik voor details
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {context.portals && context.portals.length > 0 && (
          <div className="mt-6 pt-4 border-t border-[var(--border)]">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">
              Portals en gerelateerde bronnen
            </p>
            <ul className="space-y-2">
              {context.portals.map((p, i) => (
                <li key={`${p.url}-${i}`}>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1 break-all"
                  >
                    <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">{p.categorie}</span>
                    {p.titel || p.url}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {context.lastSynced && (
          <p className="mt-4 text-[10px] text-[var(--muted-foreground)]">
            Laatst gesynchroniseerd: {formatDateTime(context.lastSynced)}
          </p>
        )}
      </div>

      {modalStep && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="procedure-step-title"
          onClick={() => setModalStep(null)}
        >
          <div
            className="max-w-lg w-full rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <h3 id="procedure-step-title" className="text-sm font-semibold pr-6">
                {modalStep.label}
              </h3>
              <button
                type="button"
                onClick={() => setModalStep(null)}
                className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                aria-label="Sluiten"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {modalStep.date && (
              <p className="text-xs text-[var(--muted-foreground)] mb-2">{formatDate(modalStep.date)}</p>
            )}
            {modalStep.detail && (
              <p className="text-sm text-[var(--foreground)] leading-relaxed mb-4">{modalStep.detail}</p>
            )}
            {modalStep.links && modalStep.links.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase text-[var(--muted-foreground)] mb-2">Links</p>
                <ul className="space-y-2">
                  {modalStep.links.map((L, i) => (
                    <li key={`${L.url}-${i}`}>
                      <a
                        href={L.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[var(--primary)] hover:underline break-all inline-flex items-center gap-1"
                      >
                        {L.titel}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              onClick={() => setModalStep(null)}
              className="mt-4 w-full rounded-lg border py-2 text-sm hover:bg-[var(--muted)]/50"
            >
              Sluiten
            </button>
          </div>
        </div>
      )}
    </>
  )
}
