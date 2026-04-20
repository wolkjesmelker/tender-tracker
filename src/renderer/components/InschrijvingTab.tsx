import React, { useMemo, useState } from 'react'
import {
  Building2, MapPin, CalendarDays, Euro, Hash, FileCheck, ExternalLink,
  Clock, ClipboardList,
  Send, Globe, ScrollText, AlertTriangle, ChevronDown,
  Briefcase, Info, Link2, Phone, Mail, Home, User, Navigation,
} from 'lucide-react'
import type {
  Aanbesteding,
  AiExtractedTenderFields,
  BronNavigatieLink,
  TenderProcedureContext,
  ProcedureTimelineStep,
} from '../../shared/types'
import { formatDate, formatDateTime } from '../lib/utils'

interface InschrijvingTabProps {
  tender: Aanbesteding
  procedureContext: TenderProcedureContext | null
  aiExtracted: Partial<AiExtractedTenderFields>
  criteriaScores: Record<string, unknown>
  bronNavLinks: BronNavigatieLink[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a loose date string (ISO or dd-mm-yyyy) to a Date. Returns null if invalid. */
function parseLooseDate(s?: string | null): Date | null {
  if (!s || typeof s !== 'string') return null
  const t = s.trim()
  if (!t) return null
  // dd-mm-yyyy
  const dm = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (dm) {
    const d = new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]),
      dm[4] ? Number(dm[4]) : 0, dm[5] ? Number(dm[5]) : 0)
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(t)
  return isNaN(d.getTime()) ? null : d
}

function daysBetween(a: Date, b: Date): number {
  const MS = 24 * 60 * 60 * 1000
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((db - da) / MS)
}

type TimelinePhase = 'past' | 'current' | 'future' | 'today' | 'undated'

interface EnrichedTimelineStep extends ProcedureTimelineStep {
  parsedDate: Date | null
  phase: TimelinePhase
  daysFromToday: number | null
}

interface TodayMarker {
  isTodayMarker: true
}

/** Merge AI-extracted dates into the timeline, sort, and classify past/current/future. */
function buildEnrichedTimeline(
  baseTimeline: ProcedureTimelineStep[] | undefined,
  ai: Partial<AiExtractedTenderFields>
): Array<EnrichedTimelineStep | TodayMarker> {
  const now = new Date()
  const steps: ProcedureTimelineStep[] = Array.isArray(baseTimeline) ? [...baseTimeline] : []

  const hasId = (id: string) => steps.some((s) => s.id === id)
  const hasDateMatch = (iso?: string) => {
    if (!iso) return false
    const d = parseLooseDate(iso)
    if (!d) return false
    return steps.some((s) => {
      const sd = parseLooseDate(s.date)
      return sd && Math.abs(sd.getTime() - d.getTime()) < 60_000
    })
  }

  if (ai.publicatiedatum && !hasId('publicatie') && !hasDateMatch(ai.publicatiedatum)) {
    steps.push({
      id: 'ai-publicatie',
      label: 'Publicatiedatum',
      date: ai.publicatiedatum,
      detail: 'Datum volgens AI-analyse van de aanbestedingsdocumenten.',
    })
  }
  if (ai.sluitingsdatum_inschrijving && !hasId('inschrijving') && !hasDateMatch(ai.sluitingsdatum_inschrijving)) {
    steps.push({
      id: 'ai-sluiting',
      label: 'Sluiting inschrijving',
      date: ai.sluitingsdatum_inschrijving,
      detail: 'Uiterste datum voor indiening volgens AI-analyse.',
    })
  }
  if (ai.datum_start_uitvoering) {
    steps.push({
      id: 'ai-start-uitvoering',
      label: 'Start uitvoering',
      date: ai.datum_start_uitvoering,
      detail: 'Geplande startdatum van de uitvoering.',
    })
  }
  if (ai.datum_einde_uitvoering) {
    steps.push({
      id: 'ai-einde-uitvoering',
      label: 'Einde uitvoering',
      date: ai.datum_einde_uitvoering,
      detail: 'Geplande einddatum van de uitvoering.',
    })
  }

  const enriched: EnrichedTimelineStep[] = steps.map((s) => {
    const parsedDate = parseLooseDate(s.date)
    const daysFromToday = parsedDate ? daysBetween(now, parsedDate) : null
    let phase: TimelinePhase = 'undated'
    if (parsedDate && daysFromToday !== null) {
      if (daysFromToday < 0) phase = 'past'
      else if (daysFromToday === 0) phase = 'today'
      else if (daysFromToday <= 14) phase = 'current'
      else phase = 'future'
    }
    return { ...s, parsedDate, phase, daysFromToday }
  })

  enriched.sort((a, b) => {
    if (a.parsedDate && b.parsedDate) return a.parsedDate.getTime() - b.parsedDate.getTime()
    if (a.parsedDate && !b.parsedDate) return -1
    if (!a.parsedDate && b.parsedDate) return 1
    return 0
  })

  // Inject today marker between last past and first future step
  const result: Array<EnrichedTimelineStep | TodayMarker> = []
  let todayInjected = false
  for (let i = 0; i < enriched.length; i++) {
    const cur = enriched[i]
    const prev = i > 0 ? enriched[i - 1] : null
    if (
      !todayInjected &&
      cur.parsedDate && cur.daysFromToday !== null && cur.daysFromToday > 0 &&
      (!prev || (prev.daysFromToday !== null && prev.daysFromToday < 0))
    ) {
      result.push({ isTodayMarker: true })
      todayInjected = true
    }
    result.push(cur)
  }
  // Past-only or no future steps: append marker at end if we have at least one dated past step
  if (!todayInjected && enriched.some((s) => s.daysFromToday !== null && s.daysFromToday <= 0)) {
    const allDatedPast = enriched.filter((s) => s.parsedDate).every((s) => (s.daysFromToday ?? 0) <= 0)
    if (allDatedPast && enriched.some((s) => s.parsedDate)) {
      // insert marker before undated steps
      const firstUndated = result.findIndex((x) => 'isTodayMarker' in x ? false : !(x as EnrichedTimelineStep).parsedDate)
      if (firstUndated === -1) result.push({ isTodayMarker: true })
      else result.splice(firstUndated, 0, { isTodayMarker: true })
    }
  }

  return result
}

// ── Helper UI atoms ──────────────────────────────────────────────────────────

function InfoRow({ icon: Icon, label, value, valueClassName }: {
  icon: typeof Building2
  label: string
  value: React.ReactNode
  valueClassName?: string
}) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--muted)]/60">
        <Icon className="h-4 w-4 text-[var(--muted-foreground)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
        <p className={`text-sm font-medium text-[var(--foreground)] break-words ${valueClassName ?? ''}`}>
          {value}
        </p>
      </div>
    </div>
  )
}

function CountdownBadge({ targetDate }: { targetDate: Date }) {
  const days = daysBetween(new Date(), targetDate)
  let cls = 'bg-green-100 text-green-700 border-green-200'
  let label = `Nog ${days} dag${days === 1 ? '' : 'en'}`
  if (days < 0) {
    cls = 'bg-gray-100 text-gray-600 border-gray-200'
    label = `${Math.abs(days)} dag${Math.abs(days) === 1 ? '' : 'en'} geleden verlopen`
  } else if (days === 0) {
    cls = 'bg-red-100 text-red-700 border-red-200'
    label = 'Vandaag sluit de inschrijving'
  } else if (days <= 7) {
    cls = 'bg-red-100 text-red-700 border-red-200'
  } else if (days <= 21) {
    cls = 'bg-amber-100 text-amber-700 border-amber-200'
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
      <Clock className="h-3.5 w-3.5" />
      {label}
    </span>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function InschrijvingTab({
  tender,
  procedureContext,
  aiExtracted,
  criteriaScores: _criteriaScores,
  bronNavLinks,
}: InschrijvingTabProps) {
  const timelineItems = useMemo(
    () => buildEnrichedTimeline(procedureContext?.timeline, aiExtracted),
    [procedureContext, aiExtracted]
  )

  // Display field resolution: DB column → AI extracted → undefined
  const dispOpdrachtgever = tender.opdrachtgever || aiExtracted.opdrachtgever
  const dispReferentie = tender.referentienummer || aiExtracted.referentienummer
  const dispProcedureType = aiExtracted.procedure_type || procedureContext?.apiHighlights?.procedureCode
  const dispTypeOpdracht = tender.type_opdracht || aiExtracted.type_opdracht
  const dispRegio = tender.regio || aiExtracted.locatie_of_regio
  const dispWaarde = tender.geraamde_waarde || aiExtracted.geraamde_waarde
  const dispPublicatie = tender.publicatiedatum || aiExtracted.publicatiedatum || procedureContext?.apiHighlights?.publicatieDatum
  const dispSluiting = tender.sluitingsdatum || aiExtracted.sluitingsdatum_inschrijving || procedureContext?.apiHighlights?.sluitingsDatum
  const dispCpv = aiExtracted.cpv_of_werkzaamheden

  const sluitingDate = parseLooseDate(dispSluiting)

  // Categorize submission platforms from bron_navigatie_links
  const platformRe = /platform|extern|inschrijving|aanbesteding|tenderned|mercell|negometrix|s2c|ted\.europa|eforms/i
  const submissionLinks: BronNavigatieLink[] = useMemo(() => {
    const fromPortals = Array.isArray(procedureContext?.portals) ? procedureContext!.portals! : []
    const fromNav = bronNavLinks.filter((L) =>
      platformRe.test(`${L.categorie || ''} ${L.url || ''}`)
    )
    // Dedupe by URL
    const seen = new Set<string>()
    const out: BronNavigatieLink[] = []
    for (const L of [...fromPortals, ...fromNav]) {
      if (!L?.url) continue
      const k = L.url.split('?')[0]
      if (seen.has(k)) continue
      seen.add(k)
      out.push(L)
    }
    return out
  }, [procedureContext, bronNavLinks])

  const apiH = procedureContext?.apiHighlights

  // Parse document_links uit AI-extractie (JSON-array in string-veld)
  const documentLinks = useMemo(() => {
    const raw = aiExtracted.document_links
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (x): x is { url: string; titel?: string; categorie?: string } =>
            x && typeof x === 'object' && typeof x.url === 'string' && x.url.startsWith('http'),
        )
      }
    } catch { /* ignore */ }
    return []
  }, [aiExtracted.document_links])

  // Combineer document_links met bronNavLinks voor een complete linklijst
  const allLinks = useMemo(() => {
    const seen = new Set<string>()
    const out: { url: string; titel?: string; categorie?: string }[] = []
    for (const L of [...documentLinks, ...bronNavLinks]) {
      const key = (L.url || '').split('?')[0]
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(L)
    }
    return out
  }, [documentLinks, bronNavLinks])

  // Groepeer alle links op categorie
  const linksByCat = useMemo(() => {
    const map = new Map<string, typeof allLinks>()
    for (const L of allLinks) {
      const cat = (L.categorie || 'overig').trim() || 'overig'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(L)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [allLinks])

  const formatCpvDisplay = (value: unknown): React.ReactNode => {
    if (value == null) return null
    let data: unknown = value
    if (typeof value === 'string') {
      const t = value.trim()
      if (t.startsWith('[') || t.startsWith('{')) {
        try { data = JSON.parse(t) } catch { return <span className="text-xs">{value}</span> }
      } else {
        return <span className="text-xs">{value}</span>
      }
    }
    if (!Array.isArray(data)) return <span className="text-xs">{String(data)}</span>
    return (
      <ul className="mt-1 space-y-1 list-none">
        {data.map((item, i) => {
          if (item && typeof item === 'object' && 'code' in (item as Record<string, unknown>)) {
            const o = item as { code?: string; omschrijving?: string; isHoofdOpdracht?: boolean }
            return (
              <li key={i} className="text-xs leading-relaxed">
                <span className="font-mono text-[11px]">{o.code ?? '—'}</span>
                {o.omschrijving ? <span className="text-[var(--muted-foreground)]"> — {o.omschrijving}</span> : null}
                {o.isHoofdOpdracht ? (
                  <span className="ml-1.5 rounded bg-[var(--primary)]/10 px-1 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                    hoofd
                  </span>
                ) : null}
              </li>
            )
          }
          return <li key={i} className="text-xs leading-relaxed break-words">{String(item)}</li>
        })}
      </ul>
    )
  }

  return (
    <div className="space-y-6">
      {/* ═════════════════════ 1. PAGE HEADER ═════════════════════ */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--primary)]/10 via-[var(--card)] to-[var(--card)] p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-[var(--foreground)]">Inschrijving &amp; Procedure</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Volledig overzicht van de aanbestedingsprocedure: uitgevende partij, tijdlijn, contactgegevens en relevante links.
            </p>
            {procedureContext?.lastSynced && (
              <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
                Laatst gesynchroniseerd: {formatDateTime(procedureContext.lastSynced)}
              </p>
            )}
          </div>
          {sluitingDate && <CountdownBadge targetDate={sluitingDate} />}
        </div>
      </div>

      {/* ═════════════════════ 2. TWO-COLUMN INFO ROW ═════════════════════ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* LEFT: Uitgevende Partij */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 border-b border-[var(--border)] pb-3">
            <Building2 className="h-5 w-5 text-[var(--primary)]" />
            <h2 className="text-base font-semibold">Uitgevende Partij</h2>
          </div>
          <div className="space-y-3">
            <InfoRow icon={Building2} label="Opdrachtgever" value={dispOpdrachtgever} />
            <InfoRow icon={Hash} label="Referentienummer" value={dispReferentie} valueClassName="font-mono" />
            <InfoRow
              icon={Briefcase}
              label="Type opdracht"
              value={dispTypeOpdracht}
            />
            <InfoRow
              icon={FileCheck}
              label="Procedure"
              value={[dispProcedureType, apiH?.typePublicatie].filter(Boolean).join(' · ') || dispProcedureType}
            />
            {apiH?.aanbestedingStatus && (
              <InfoRow icon={Info} label="Status aanbesteding" value={apiH.aanbestedingStatus} />
            )}
            <InfoRow icon={MapPin} label="Regio / locatie" value={dispRegio} />
            <InfoRow icon={Euro} label="Geraamde waarde" value={dispWaarde} />
            {apiH?.kenmerk && (
              <InfoRow icon={Hash} label="Kenmerk (TenderNed)" value={apiH.kenmerk} valueClassName="font-mono" />
            )}
            {dispCpv && (
              <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--muted)]/30 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">CPV / Werkzaamheden</p>
                <p className="text-sm leading-relaxed">{dispCpv}</p>
              </div>
            )}
            {apiH?.cpvCodes != null && (
              <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--muted)]/30 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">CPV-codes</p>
                {formatCpvDisplay(apiH.cpvCodes)}
              </div>
            )}
            {apiH?.nutsCodes != null && (
              <div className="rounded-lg border border-[var(--border)]/60 bg-[var(--muted)]/30 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">NUTS-codes</p>
                {formatCpvDisplay(apiH.nutsCodes)}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Indienen Inschrijving */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 border-b border-[var(--border)] pb-3">
            <Send className="h-5 w-5 text-[var(--primary)]" />
            <h2 className="text-base font-semibold">Indienen Inschrijving</h2>
          </div>
          <div className="space-y-4">
            {/* Sluitingsdatum prominent */}
            <div className={`rounded-lg border p-4 ${sluitingDate ? 'border-red-200 bg-red-50' : 'border-[var(--border)] bg-[var(--muted)]/30'}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Sluitingsdatum inschrijving</p>
              {dispSluiting ? (
                <>
                  <p className={`mt-1 text-xl font-bold ${sluitingDate ? 'text-red-700' : 'text-[var(--foreground)]'}`}>
                    {formatDate(dispSluiting)}
                  </p>
                  {sluitingDate && (
                    <div className="mt-2"><CountdownBadge targetDate={sluitingDate} /></div>
                  )}
                </>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">Niet bekend</p>
              )}
            </div>

            {dispPublicatie && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Publicatiedatum</p>
                <p className="mt-1 text-sm font-medium">{formatDate(dispPublicatie)}</p>
              </div>
            )}

            {tender.bron_url && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">Bron-aankondiging</p>
                <a
                  href={tender.bron_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--primary)] hover:underline break-all"
                >
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span className="break-all">{tender.bron_url}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </div>
            )}

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">
                Indienen via platform / portal
              </p>
              {submissionLinks.length > 0 ? (
                <ul className="space-y-2">
                  {submissionLinks.map((L, i) => (
                    <li key={`${L.url}-${i}`}>
                      <a
                        href={L.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors"
                      >
                        <Send className="h-4 w-4 shrink-0 text-[var(--primary)]" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-[var(--foreground)] truncate">{L.titel || L.categorie || L.url}</p>
                          <p className="text-[10px] text-[var(--muted-foreground)] truncate">{L.url}</p>
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--muted)]/20 p-3 text-xs text-[var(--muted-foreground)]">
                  <AlertTriangle className="inline h-3.5 w-3.5 mr-1 text-amber-500" />
                  Geen indieningsplatform gedetecteerd. Raadpleeg de bron-aankondiging of start een AI-analyse om portals automatisch te vinden.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═════════════════════ 3. VERTICAL TIMELINE ═════════════════════ */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2 border-b border-[var(--border)] pb-3">
          <CalendarDays className="h-5 w-5 text-[var(--primary)]" />
          <h2 className="text-base font-semibold">Procedureverloop &amp; Tijdslijn</h2>
        </div>

        {timelineItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--muted)]/20 p-6 text-center">
            <Clock className="h-8 w-8 mx-auto text-[var(--muted-foreground)] mb-2" />
            <p className="text-sm text-[var(--muted-foreground)]">
              Nog geen procedure-tijdslijn beschikbaar. Start de AI-analyse om data uit TenderNed en bijlagen te verzamelen.
            </p>
          </div>
        ) : (
          <div className="relative pl-2">
            <div className="absolute left-[1.125rem] top-4 bottom-4 w-0.5 bg-gradient-to-b from-[var(--primary)]/40 via-[var(--border)] to-[var(--border)]" aria-hidden />
            <ul className="space-y-6">
              {timelineItems.map((item, idx) => {
                if ('isTodayMarker' in item) {
                  return (
                    <li key={`today-${idx}`} className="relative flex items-center gap-4">
                      <div className="relative z-[1] flex w-9 shrink-0 justify-center">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 ring-4 ring-[var(--card)] shadow-sm">
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        </span>
                      </div>
                      <div className="flex-1 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-2">
                        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
                          Vandaag &middot; {formatDate(new Date().toISOString())}
                        </p>
                      </div>
                    </li>
                  )
                }

                const step = item
                const phase = step.phase
                const isPast = phase === 'past'
                const isToday = phase === 'today'
                const isCurrent = phase === 'current'

                const dotClass =
                  isPast
                    ? 'bg-[var(--muted-foreground)]/40 ring-[var(--card)]'
                    : isToday
                      ? 'bg-red-500 ring-red-100 ring-4'
                      : isCurrent
                        ? 'bg-amber-500 ring-amber-100 ring-4'
                        : 'bg-[var(--primary)] ring-[var(--card)] ring-[3px]'

                const cardClass =
                  isPast
                    ? 'border-[var(--border)]/60 bg-[var(--muted)]/20 opacity-75'
                    : isToday
                      ? 'border-red-200 bg-red-50 shadow-md'
                      : isCurrent
                        ? 'border-amber-200 bg-amber-50/60 shadow-sm'
                        : 'border-[var(--border)] bg-[var(--background)]'

                const daysLabel =
                  step.daysFromToday !== null
                    ? step.daysFromToday === 0
                      ? 'Vandaag'
                      : step.daysFromToday < 0
                        ? `${Math.abs(step.daysFromToday)} dag${Math.abs(step.daysFromToday) === 1 ? '' : 'en'} geleden`
                        : `Nog ${step.daysFromToday} dag${step.daysFromToday === 1 ? '' : 'en'}`
                    : null

                return (
                  <li key={step.id || `step-${idx}`} className="relative flex gap-4">
                    <div className="relative z-[1] flex w-9 shrink-0 justify-center pt-4">
                      <span className={`h-3 w-3 shrink-0 rounded-full ${dotClass}`} aria-hidden />
                    </div>
                    <div className={`flex-1 rounded-xl border p-4 transition-colors ${cardClass}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className={`text-sm font-semibold ${isPast ? 'text-[var(--muted-foreground)]' : 'text-[var(--foreground)]'}`}>
                            {step.label}
                          </h3>
                          {step.date && (
                            <p className={`mt-0.5 text-xs ${isPast ? 'text-[var(--muted-foreground)]' : 'text-[var(--foreground)]/80'} font-medium`}>
                              {formatDate(step.date)}
                              {daysLabel && (
                                <span className="ml-2 text-[10px] text-[var(--muted-foreground)]">({daysLabel})</span>
                              )}
                            </p>
                          )}
                        </div>
                        {isToday && (
                          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                            Vandaag
                          </span>
                        )}
                        {isCurrent && (
                          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                            Dichtbij
                          </span>
                        )}
                        {isPast && (
                          <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                            Afgerond
                          </span>
                        )}
                      </div>

                      {step.detail && (
                        <p className={`mt-2 text-xs leading-relaxed ${isPast ? 'text-[var(--muted-foreground)]' : 'text-[var(--foreground)]/80'}`}>
                          {step.detail}
                        </p>
                      )}

                      {step.links && step.links.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {step.links.map((L, i) => (
                            <a
                              key={`${L.url}-${i}`}
                              href={L.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] text-[var(--primary)] hover:bg-[var(--primary)]/10 hover:border-[var(--primary)] transition-colors"
                            >
                              <Link2 className="h-3 w-3" />
                              <span className="max-w-[220px] truncate">{L.titel || L.url}</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      {/* ═════════════════════ 4. CONTACTGEGEVENS & INDIENADRES ═════════════════════ */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2 border-b border-[var(--border)] pb-3">
          <User className="h-5 w-5 text-[var(--primary)]" />
          <h2 className="text-base font-semibold">Contactgegevens &amp; Indienadres</h2>
        </div>

        {/* Geen contactgegevens beschikbaar */}
        {!aiExtracted.opdrachtgever_adres &&
          !aiExtracted.opdrachtgever_email &&
          !aiExtracted.opdrachtgever_telefoon &&
          !aiExtracted.opdrachtgever_website &&
          !aiExtracted.contactpersoon_naam &&
          !aiExtracted.contactpersoon_email &&
          !aiExtracted.contactpersoon_telefoon &&
          !aiExtracted.indiening_adres && (
          <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--muted)]/20 p-6 text-center">
            <Building2 className="h-8 w-8 mx-auto text-[var(--muted-foreground)] mb-2" />
            <p className="text-sm text-[var(--muted-foreground)]">
              Nog geen contactgegevens beschikbaar. Start een (nieuwe) AI-analyse om adres, contactpersoon en indienadres te extraheren.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Aanbestedende dienst */}
          {(aiExtracted.opdrachtgever_adres || aiExtracted.opdrachtgever_email ||
            aiExtracted.opdrachtgever_telefoon || aiExtracted.opdrachtgever_website) && (
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--primary)] flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" /> Aanbestedende dienst
              </p>
              {aiExtracted.opdrachtgever_adres && (
                <div className="flex items-start gap-2.5">
                  <Home className="h-4 w-4 mt-0.5 shrink-0 text-[var(--muted-foreground)]" />
                  <span className="text-sm text-[var(--foreground)] whitespace-pre-line">{aiExtracted.opdrachtgever_adres}</span>
                </div>
              )}
              {aiExtracted.opdrachtgever_email && (
                <div className="flex items-center gap-2.5">
                  <Mail className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                  <a href={`mailto:${aiExtracted.opdrachtgever_email}`}
                    className="text-sm text-[var(--primary)] hover:underline break-all">
                    {aiExtracted.opdrachtgever_email}
                  </a>
                </div>
              )}
              {aiExtracted.opdrachtgever_telefoon && (
                <div className="flex items-center gap-2.5">
                  <Phone className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                  <a href={`tel:${aiExtracted.opdrachtgever_telefoon}`}
                    className="text-sm text-[var(--primary)] hover:underline">
                    {aiExtracted.opdrachtgever_telefoon}
                  </a>
                </div>
              )}
              {aiExtracted.opdrachtgever_website && (
                <div className="flex items-center gap-2.5">
                  <Globe className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                  <a href={aiExtracted.opdrachtgever_website} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-[var(--primary)] hover:underline break-all inline-flex items-center gap-1">
                    {aiExtracted.opdrachtgever_website}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Contactpersoon */}
          {(aiExtracted.contactpersoon_naam || aiExtracted.contactpersoon_email || aiExtracted.contactpersoon_telefoon) && (
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--primary)] flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Contactpersoon
              </p>
              {aiExtracted.contactpersoon_naam && (
                <div className="flex items-center gap-2.5">
                  <User className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                  <span className="text-sm font-medium text-[var(--foreground)]">{aiExtracted.contactpersoon_naam}</span>
                </div>
              )}
              {aiExtracted.contactpersoon_email && (
                <div className="flex items-center gap-2.5">
                  <Mail className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                  <a href={`mailto:${aiExtracted.contactpersoon_email}`}
                    className="text-sm text-[var(--primary)] hover:underline break-all">
                    {aiExtracted.contactpersoon_email}
                  </a>
                </div>
              )}
              {aiExtracted.contactpersoon_telefoon && (
                <div className="flex items-center gap-2.5">
                  <Phone className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                  <a href={`tel:${aiExtracted.contactpersoon_telefoon}`}
                    className="text-sm text-[var(--primary)] hover:underline">
                    {aiExtracted.contactpersoon_telefoon}
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Indienadres */}
        {aiExtracted.indiening_adres && (
          <div className={`mt-5 rounded-lg border border-[var(--primary)]/20 bg-[var(--primary)]/5 p-4 ${
            (aiExtracted.opdrachtgever_adres || aiExtracted.contactpersoon_naam) ? '' : ''
          }`}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--primary)] mb-2 flex items-center gap-1.5">
              <Navigation className="h-3.5 w-3.5" /> Aanvraag / inschrijving indienen bij
            </p>
            <p className="text-sm text-[var(--foreground)] whitespace-pre-line leading-relaxed">
              {aiExtracted.indiening_adres}
            </p>
          </div>
        )}
      </div>

      {/* ═════════════════════ 5. LINKS UIT DOCUMENTEN & PORTALS ═════════════════════ */}
      {(linksByCat.length > 0 || documentLinks.length > 0) && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 border-b border-[var(--border)] pb-3">
            <Link2 className="h-5 w-5 text-[var(--primary)]" />
            <h2 className="text-base font-semibold">Links uit documenten &amp; portals</h2>
          </div>
          <p className="mb-4 text-xs text-[var(--muted-foreground)]">
            Hyperlinks gevonden in bijlagen (PDF&apos;s, formulieren) en de bronpagina — procedures, portals, aanvullende informatie en formulieren.
          </p>
          <div className="space-y-5">
            {linksByCat.map(([cat, links]) => (
              <div key={cat}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2 flex items-center gap-1.5">
                  {cat}
                  <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[9px]">{links.length}</span>
                </p>
                <ul className="space-y-1.5">
                  {links.map((L, i) => (
                    <li key={`${L.url}-${i}`}>
                      <a
                        href={L.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-xs hover:border-[var(--border)] hover:bg-[var(--muted)]/40 transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" />
                        <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">
                          {L.titel || L.url}
                        </span>
                        <span className="shrink-0 text-[10px] text-[var(--muted-foreground)] truncate max-w-[40%]">
                          {(() => { try { return new URL(L.url).hostname } catch { return '' } })()}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {linksByCat.length === 0 && documentLinks.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--muted)]/20 p-4 text-xs text-[var(--muted-foreground)] text-center">
                <AlertTriangle className="inline h-3.5 w-3.5 mr-1 text-amber-500" />
                Nog geen links gevonden. Start een AI-analyse om links uit documenten te extraheren.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
