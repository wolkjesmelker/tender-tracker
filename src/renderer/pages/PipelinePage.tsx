import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/ipc-client'
import { cn, formatDate, daysUntil } from '../lib/utils'
import type { Aanbesteding, AiExtractedTenderFields, AIVraag } from '@shared/types'
import {
  Target, Hammer, Send, Trophy, HardHat, CheckCircle2, XCircle,
  Calendar, CalendarCheck, CalendarDays, MapPin, Building2,
  ChevronRight, ExternalLink, X, Edit3, Save, Clock, AlertTriangle,
  BarChart3, FileText, Star, Layers, GripVertical,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Pipeline column definitions
// ---------------------------------------------------------------------------
export type PipelineColumnId =
  | 'gekwalificeerd'
  | 'voorbereiding'
  | 'ingediend'
  | 'gegund'
  | 'uitvoering'
  | 'opgeleverd'
  | 'niet_gegund'

interface PipelineColumn {
  id: PipelineColumnId
  label: string
  description: string
  icon: React.ElementType
  border: string
  headerBg: string
  badgeBg: string
  badgeText: string
  dot: string
  glow: string
}

const COLUMNS: PipelineColumn[] = [
  {
    id: 'gekwalificeerd',
    label: 'Gekwalificeerd',
    description: 'Geselecteerd voor inschrijving',
    icon: Target,
    border: 'border-blue-400',
    headerBg: 'bg-blue-500/10',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-700',
    dot: 'bg-blue-400',
    glow: 'shadow-blue-200',
  },
  {
    id: 'voorbereiding',
    label: 'In Voorbereiding',
    description: 'Offerte wordt opgesteld',
    icon: Hammer,
    border: 'border-amber-400',
    headerBg: 'bg-amber-500/10',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-700',
    dot: 'bg-amber-400',
    glow: 'shadow-amber-200',
  },
  {
    id: 'ingediend',
    label: 'Ingediend',
    description: 'Inschrijving verzonden',
    icon: Send,
    border: 'border-violet-400',
    headerBg: 'bg-violet-500/10',
    badgeBg: 'bg-violet-100',
    badgeText: 'text-violet-700',
    dot: 'bg-violet-400',
    glow: 'shadow-violet-200',
  },
  {
    id: 'gegund',
    label: 'Gegund',
    description: 'Opdracht gewonnen',
    icon: Trophy,
    border: 'border-emerald-400',
    headerBg: 'bg-emerald-500/10',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-700',
    dot: 'bg-emerald-400',
    glow: 'shadow-emerald-200',
  },
  {
    id: 'uitvoering',
    label: 'In Uitvoering',
    description: 'Project wordt uitgevoerd',
    icon: HardHat,
    border: 'border-cyan-400',
    headerBg: 'bg-cyan-500/10',
    badgeBg: 'bg-cyan-100',
    badgeText: 'text-cyan-700',
    dot: 'bg-cyan-400',
    glow: 'shadow-cyan-200',
  },
  {
    id: 'opgeleverd',
    label: 'Opgeleverd',
    description: 'Project voltooid',
    icon: CheckCircle2,
    border: 'border-green-500',
    headerBg: 'bg-green-600/10',
    badgeBg: 'bg-green-100',
    badgeText: 'text-green-700',
    dot: 'bg-green-500',
    glow: 'shadow-green-200',
  },
  {
    id: 'niet_gegund',
    label: 'Niet Gegund',
    description: 'Opdracht niet gewonnen',
    icon: XCircle,
    border: 'border-rose-400',
    headerBg: 'bg-rose-500/10',
    badgeBg: 'bg-rose-100',
    badgeText: 'text-rose-600',
    dot: 'bg-rose-400',
    glow: 'shadow-rose-200',
  },
]

// ---------------------------------------------------------------------------
// Local storage
// ---------------------------------------------------------------------------
const LS_KEY = 'pipeline-data-v2'

interface PipelineCardData {
  column: PipelineColumnId
  realisatiedatum?: string
  notitie?: string
}

interface PipelineStore {
  version: 2
  cards: Record<string, PipelineCardData>
}

function loadStore(): PipelineStore {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as PipelineStore
      if (parsed.version === 2) return parsed
    }
  } catch { /* ignore */ }
  return { version: 2, cards: {} }
}

function saveStore(store: PipelineStore) {
  localStorage.setItem(LS_KEY, JSON.stringify(store))
}

// ---------------------------------------------------------------------------
// Helper: extract ai fields
// ---------------------------------------------------------------------------
function parseAiFields(tender: Aanbesteding): AiExtractedTenderFields | null {
  try {
    if (tender.ai_extracted_fields) return JSON.parse(tender.ai_extracted_fields)
  } catch { /* ignore */ }
  return null
}

function parseAiAnswers(tender: Aanbesteding): Record<string, string> {
  try {
    if (tender.ai_antwoorden) return JSON.parse(tender.ai_antwoorden)
  } catch { /* ignore */ }
  return {}
}

/**
 * Convert raw {[vraagId]: antwoord} to {[vraagtekst]: antwoord} using the
 * question map. Falls back to the raw key if no match is found.
 */
function resolveAiAnswers(
  raw: Record<string, string>,
  vraagMap: Map<string, string>,
): { vraag: string; antwoord: string }[] {
  return Object.entries(raw)
    .filter(([, v]) => v && String(v).trim())
    .map(([id, antwoord]) => ({
      vraag: vraagMap.get(id) ?? id,
      antwoord: String(antwoord),
    }))
}

function parseCriteriaScores(tender: Aanbesteding): Record<string, unknown> {
  try {
    if (tender.criteria_scores) return JSON.parse(tender.criteria_scores)
  } catch { /* ignore */ }
  return {}
}

function formatDateNL(dateStr?: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function getDefaultColumn(tender: Aanbesteding): PipelineColumnId {
  if (tender.status === 'in_aanbieding') return 'ingediend'
  return 'gekwalificeerd'
}

// ---------------------------------------------------------------------------
// Score badge
// ---------------------------------------------------------------------------
function ScoreBadge({ score }: { score?: number | null }) {
  if (score == null) return null
  const color =
    score >= 70 ? 'bg-emerald-100 text-emerald-700' :
    score >= 40 ? 'bg-amber-100 text-amber-700' :
    'bg-rose-100 text-rose-600'
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold', color)}>
      <Star className="h-2.5 w-2.5" />
      {Math.round(score)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Days badge
// ---------------------------------------------------------------------------
function DaysBadge({ dateStr }: { dateStr?: string | null }) {
  const days = daysUntil(dateStr)
  if (days === null) return null
  const color =
    days < 0 ? 'bg-gray-100 text-gray-500' :
    days <= 7 ? 'bg-rose-100 text-rose-600' :
    days <= 21 ? 'bg-amber-100 text-amber-700' :
    'bg-blue-50 text-blue-600'
  const label =
    days < 0 ? `${Math.abs(days)}d geleden` :
    days === 0 ? 'Vandaag' :
    `${days}d`
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', color)}>
      <Clock className="h-2.5 w-2.5" />
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------
interface ProjectCardProps {
  tender: Aanbesteding
  column: PipelineColumn
  cardData: PipelineCardData
  draggingId: string | null
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onClick: () => void
}

function ProjectCard({ tender, column, cardData, draggingId, onDragStart, onDragEnd, onClick }: ProjectCardProps) {
  const aiFields = parseAiFields(tender)
  const realisatiedatum = cardData.realisatiedatum || aiFields?.datum_einde_uitvoering
  const startUitvoering = aiFields?.datum_start_uitvoering
  const isDragging = draggingId === tender.id

  return (
    <div
      draggable
      onDragStart={() => onDragStart(tender.id)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        'group relative rounded-xl border-l-4 bg-[var(--card)] shadow-sm cursor-pointer',
        'transition-all duration-200 hover:shadow-md hover:-translate-y-0.5',
        'select-none',
        column.border,
        isDragging && 'opacity-40 scale-95 rotate-1',
      )}
    >
      {/* Drag handle */}
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-40 transition-opacity">
        <GripVertical className="h-3.5 w-3.5 text-gray-400" />
      </div>

      <div className="p-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-xs font-semibold text-[var(--foreground)] leading-tight line-clamp-2 flex-1 pr-4">
            {tender.titel}
          </h3>
          <ScoreBadge score={tender.totaal_score} />
        </div>

        {/* Opdrachtgever */}
        {tender.opdrachtgever && (
          <div className="flex items-center gap-1 mb-1.5">
            <Building2 className="h-3 w-3 text-[var(--muted-foreground)] flex-shrink-0" />
            <span className="text-[11px] text-[var(--muted-foreground)] truncate">{tender.opdrachtgever}</span>
          </div>
        )}

        {/* Regio */}
        {(tender.regio || aiFields?.locatie_of_regio) && (
          <div className="flex items-center gap-1 mb-2">
            <MapPin className="h-3 w-3 text-[var(--muted-foreground)] flex-shrink-0" />
            <span className="text-[11px] text-[var(--muted-foreground)] truncate">
              {tender.regio || aiFields?.locatie_of_regio}
            </span>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-[var(--border)] my-2" />

        {/* Dates */}
        <div className="space-y-1">
          {/* Publicatiedatum */}
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
              <Calendar className="h-3 w-3 flex-shrink-0" />
              <span>Publicatie</span>
            </div>
            <span className="text-[11px] font-medium text-[var(--foreground)]">
              {formatDateNL(tender.publicatiedatum || aiFields?.publicatiedatum)}
            </span>
          </div>

          {/* Sluitingsdatum */}
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
              <CalendarDays className="h-3 w-3 flex-shrink-0" />
              <span>Sluitingsdatum</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-medium text-[var(--foreground)]">
                {formatDateNL(tender.sluitingsdatum || aiFields?.sluitingsdatum_inschrijving)}
              </span>
              <DaysBadge dateStr={tender.sluitingsdatum || aiFields?.sluitingsdatum_inschrijving} />
            </div>
          </div>

          {/* Start uitvoering */}
          {startUitvoering && (
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                <HardHat className="h-3 w-3 flex-shrink-0" />
                <span>Start uitvoering</span>
              </div>
              <span className="text-[11px] font-medium text-[var(--foreground)]">
                {formatDateNL(startUitvoering)}
              </span>
            </div>
          )}

          {/* Realisatiedatum */}
          {realisatiedatum && (
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1 text-[11px] text-emerald-600">
                <CalendarCheck className="h-3 w-3 flex-shrink-0" />
                <span className="font-medium">Realisatie</span>
              </div>
              <span className="text-[11px] font-semibold text-emerald-600">
                {formatDateNL(realisatiedatum)}
              </span>
            </div>
          )}
        </div>

        {/* Notitie */}
        {cardData.notitie && (
          <>
            <div className="border-t border-[var(--border)] my-2" />
            <p className="text-[11px] text-[var(--muted-foreground)] line-clamp-2 italic">
              {cardData.notitie}
            </p>
          </>
        )}

        {/* Footer: value & type */}
        {(tender.geraamde_waarde || aiFields?.geraamde_waarde || tender.type_opdracht) && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border)]">
            {(tender.geraamde_waarde || aiFields?.geraamde_waarde) && (
              <span className="text-[10px] font-semibold text-[var(--foreground)]/70 bg-[var(--muted)] px-1.5 py-0.5 rounded">
                {tender.geraamde_waarde || aiFields?.geraamde_waarde}
              </span>
            )}
            {tender.type_opdracht && (
              <span className="text-[10px] text-[var(--muted-foreground)] ml-auto">
                {tender.type_opdracht}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project Detail Modal
// ---------------------------------------------------------------------------
interface ProjectModalProps {
  tender: Aanbesteding
  column: PipelineColumn
  cardData: PipelineCardData
  vraagMap: Map<string, string>
  onClose: () => void
  onUpdateCard: (id: string, data: Partial<PipelineCardData>) => void
  onNavigate: () => void
}

function ProjectModal({ tender, column, cardData, vraagMap, onClose, onUpdateCard, onNavigate }: ProjectModalProps) {
  const aiFields = parseAiFields(tender)
  const aiAnswers = parseAiAnswers(tender)
  const resolvedAnswers = resolveAiAnswers(aiAnswers, vraagMap)
  const [editRealisatie, setEditRealisatie] = useState(false)
  const [realisatiedatum, setRealisatiedatum] = useState(
    cardData.realisatiedatum || aiFields?.datum_einde_uitvoering || ''
  )
  const [notitie, setNotitie] = useState(cardData.notitie || '')
  const [editNotitie, setEditNotitie] = useState(false)

  function saveRealisatie() {
    onUpdateCard(tender.id, { realisatiedatum })
    setEditRealisatie(false)
  }

  function saveNotitie() {
    onUpdateCard(tender.id, { notitie })
    setEditNotitie(false)
  }

  const Icon = column.icon

  // Convert date string to input[type=date] value (YYYY-MM-DD)
  function toInputDate(d: string): string {
    if (!d) return ''
    try {
      const parsed = new Date(d)
      if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0]
      // Try DD-MM-YYYY
      const parts = d.split(/[-/]/)
      if (parts.length === 3 && parts[0].length <= 2) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
      }
    } catch { /* ignore */ }
    return d
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--card)] shadow-2xl border border-[var(--border)]">

        {/* Header strip */}
        <div className={cn('px-6 py-4 rounded-t-2xl border-b border-[var(--border)]', column.headerBg)}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={cn('flex items-center justify-center w-9 h-9 rounded-xl', column.badgeBg)}>
                <Icon className={cn('h-4.5 w-4.5', column.badgeText)} />
              </div>
              <div>
                <span className={cn('text-xs font-semibold uppercase tracking-wide', column.badgeText)}>
                  {column.label}
                </span>
                <h2 className="text-base font-bold text-[var(--foreground)] leading-tight mt-0.5">
                  {tender.titel}
                </h2>
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 p-1.5 rounded-lg hover:bg-black/10 transition-colors"
            >
              <X className="h-4 w-4 text-[var(--muted-foreground)]" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Key info row */}
          <div className="grid grid-cols-2 gap-3">
            {tender.opdrachtgever && (
              <div className="flex items-start gap-2">
                <Building2 className="h-4 w-4 text-[var(--muted-foreground)] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[11px] text-[var(--muted-foreground)] uppercase tracking-wide">Opdrachtgever</p>
                  <p className="text-sm font-medium text-[var(--foreground)]">{tender.opdrachtgever}</p>
                </div>
              </div>
            )}
            {(tender.regio || aiFields?.locatie_of_regio) && (
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-[var(--muted-foreground)] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[11px] text-[var(--muted-foreground)] uppercase tracking-wide">Locatie</p>
                  <p className="text-sm font-medium text-[var(--foreground)]">{tender.regio || aiFields?.locatie_of_regio}</p>
                </div>
              </div>
            )}
            {tender.totaal_score != null && (
              <div className="flex items-start gap-2">
                <BarChart3 className="h-4 w-4 text-[var(--muted-foreground)] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[11px] text-[var(--muted-foreground)] uppercase tracking-wide">Score</p>
                  <p className={cn(
                    'text-sm font-bold',
                    tender.totaal_score >= 70 ? 'text-emerald-600' :
                    tender.totaal_score >= 40 ? 'text-amber-600' : 'text-rose-600'
                  )}>
                    {Math.round(tender.totaal_score)} / 100
                  </p>
                </div>
              </div>
            )}
            {(tender.geraamde_waarde || aiFields?.geraamde_waarde) && (
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-[var(--muted-foreground)] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[11px] text-[var(--muted-foreground)] uppercase tracking-wide">Geraamde waarde</p>
                  <p className="text-sm font-medium text-[var(--foreground)]">{tender.geraamde_waarde || aiFields?.geraamde_waarde}</p>
                </div>
              </div>
            )}
          </div>

          {/* Timeline dates */}
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="px-4 py-2.5 bg-[var(--muted)] border-b border-[var(--border)]">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Datumoverzicht
              </h3>
            </div>
            <div className="divide-y divide-[var(--border)]">
              <DateRow icon={Calendar} label="Publicatiedatum" value={tender.publicatiedatum || aiFields?.publicatiedatum} />
              <DateRow icon={CalendarDays} label="Sluitingsdatum inschrijving" value={tender.sluitingsdatum || aiFields?.sluitingsdatum_inschrijving} highlight />
              <DateRow icon={HardHat} label="Start uitvoering" value={aiFields?.datum_start_uitvoering} />

              {/* Realisatiedatum — editable */}
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <CalendarCheck className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm text-[var(--foreground)]">Realisatiedatum</span>
                </div>
                {editRealisatie ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={toInputDate(realisatiedatum)}
                      onChange={e => setRealisatiedatum(e.target.value)}
                      className="text-sm border border-[var(--border)] rounded-lg px-2 py-1 bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    />
                    <button
                      onClick={saveRealisatie}
                      className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500 text-white text-xs font-medium rounded-lg hover:bg-emerald-600 transition-colors"
                    >
                      <Save className="h-3 w-3" />
                      Opslaan
                    </button>
                    <button
                      onClick={() => setEditRealisatie(false)}
                      className="p-1 rounded hover:bg-[var(--muted)] transition-colors"
                    >
                      <X className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-sm font-semibold',
                      realisatiedatum || aiFields?.datum_einde_uitvoering ? 'text-emerald-600' : 'text-[var(--muted-foreground)]'
                    )}>
                      {formatDateNL(cardData.realisatiedatum || aiFields?.datum_einde_uitvoering) || '—'}
                    </span>
                    <button
                      onClick={() => setEditRealisatie(true)}
                      className="p-1 rounded hover:bg-[var(--muted)] transition-colors"
                      title="Realisatiedatum bewerken"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Samenvatting */}
          {tender.ai_samenvatting && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">
                AI Samenvatting
              </h3>
              <p className="text-sm text-[var(--foreground)]/80 leading-relaxed bg-[var(--muted)] rounded-xl p-3">
                {tender.ai_samenvatting}
              </p>
            </div>
          )}

          {/* AI Antwoorden */}
          {resolvedAnswers.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">
                AI Antwoorden
              </h3>
              <div className="space-y-1.5 rounded-xl border border-[var(--border)] overflow-hidden">
                {resolvedAnswers.slice(0, 6).map(({ vraag, antwoord }) => (
                  <div key={vraag} className="px-3 py-2 border-b border-[var(--border)] last:border-0">
                    <p className="text-[11px] font-medium text-[var(--muted-foreground)] mb-0.5">{vraag}</p>
                    <p className="text-xs text-[var(--foreground)]">{antwoord}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notitie */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Pipeline notitie
              </h3>
              {!editNotitie && (
                <button
                  onClick={() => setEditNotitie(true)}
                  className="flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
                >
                  <Edit3 className="h-3 w-3" />
                  Bewerken
                </button>
              )}
            </div>
            {editNotitie ? (
              <div className="space-y-2">
                <textarea
                  value={notitie}
                  onChange={e => setNotitie(e.target.value)}
                  rows={3}
                  placeholder="Voeg een notitie toe..."
                  className="w-full text-sm border border-[var(--border)] rounded-xl px-3 py-2 bg-[var(--card)] text-[var(--foreground)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveNotitie}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-medium rounded-lg hover:opacity-90 transition-opacity"
                  >
                    <Save className="h-3 w-3" />
                    Opslaan
                  </button>
                  <button
                    onClick={() => { setNotitie(cardData.notitie || ''); setEditNotitie(false) }}
                    className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
                  >
                    Annuleren
                  </button>
                </div>
              </div>
            ) : (
              <p className={cn(
                'text-sm rounded-xl p-3 min-h-[48px]',
                notitie || cardData.notitie
                  ? 'bg-[var(--muted)] text-[var(--foreground)]/80'
                  : 'bg-[var(--muted)] text-[var(--muted-foreground)] italic'
              )}>
                {cardData.notitie || 'Geen notitie — klik Bewerken om een notitie toe te voegen.'}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 pt-2 border-t border-[var(--border)]">
            <button
              onClick={onNavigate}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium rounded-xl hover:opacity-90 transition-opacity"
            >
              <ExternalLink className="h-4 w-4" />
              Volledige detailpagina
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-sm rounded-xl border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
            >
              Sluiten
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DateRow({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ElementType
  label: string
  value?: string | null
  highlight?: boolean
}) {
  const days = highlight ? daysUntil(value) : null
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', highlight ? 'text-violet-500' : 'text-[var(--muted-foreground)]')} />
        <span className="text-sm text-[var(--foreground)]">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn('text-sm font-medium', highlight ? 'text-violet-700' : 'text-[var(--foreground)]')}>
          {formatDateNL(value)}
        </span>
        {days !== null && <DaysBadge dateStr={value} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pipeline column component
// ---------------------------------------------------------------------------
interface KanbanColumnProps {
  column: PipelineColumn
  cards: Array<{ tender: Aanbesteding; cardData: PipelineCardData }>
  draggingId: string | null
  isDragOver: boolean
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent, colId: PipelineColumnId) => void
  onDrop: (colId: PipelineColumnId) => void
  onCardClick: (tender: Aanbesteding) => void
}

function KanbanColumn({
  column, cards, draggingId, isDragOver,
  onDragStart, onDragEnd, onDragOver, onDrop, onCardClick,
}: KanbanColumnProps) {
  const Icon = column.icon

  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl transition-all duration-200 w-[270px] flex-shrink-0',
        'bg-[var(--muted)]/50 border border-[var(--border)]',
        isDragOver && 'ring-2 ring-offset-1 scale-[1.01] bg-[var(--muted)]',
        isDragOver && `ring-[${column.dot.replace('bg-', '')}]`,
      )}
      onDragOver={(e) => onDragOver(e, column.id)}
      onDrop={() => onDrop(column.id)}
    >
      {/* Column header */}
      <div className={cn('px-4 py-3 rounded-t-2xl border-b border-[var(--border)]', column.headerBg)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn('w-2 h-2 rounded-full', column.dot)} />
            <Icon className={cn('h-4 w-4', column.badgeText)} />
            <span className="text-sm font-semibold text-[var(--foreground)]">{column.label}</span>
          </div>
          <span className={cn(
            'flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold',
            column.badgeBg, column.badgeText
          )}>
            {cards.length}
          </span>
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 pl-4">{column.description}</p>
      </div>

      {/* Drop zone */}
      <div
        className={cn(
          'flex-1 p-3 space-y-2.5 min-h-[120px] overflow-y-auto',
          isDragOver && 'bg-[var(--accent)]/30 rounded-b-2xl',
        )}
      >
        {cards.length === 0 && (
          <div className={cn(
            'flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-6 px-3',
            'border-[var(--border)] text-[var(--muted-foreground)]',
            isDragOver && `border-current opacity-70 ${column.badgeText}`,
          )}>
            <Icon className="h-6 w-6 mb-1.5 opacity-40" />
            <p className="text-[11px] text-center opacity-60">Sleep een project hierheen</p>
          </div>
        )}
        {cards.map(({ tender, cardData }) => (
          <ProjectCard
            key={tender.id}
            tender={tender}
            column={column}
            cardData={cardData}
            draggingId={draggingId}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={() => onCardClick(tender)}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main pipeline page
// ---------------------------------------------------------------------------
export function PipelinePage() {
  const navigate = useNavigate()
  const [tenders, setTenders] = useState<Aanbesteding[]>([])
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState<PipelineStore>(loadStore)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<PipelineColumnId | null>(null)
  const [selectedTender, setSelectedTender] = useState<Aanbesteding | null>(null)
  const [vraagMap, setVraagMap] = useState<Map<string, string>>(new Map())

  // Load all qualifying tenders
  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.getTenders?.({ status: 'gekwalificeerd', showVerlopen: 'all' }),
      api.getTenders?.({ status: 'in_aanbieding', showVerlopen: 'all' }),
      api.getTenders?.({ status: 'afgewezen', showVerlopen: 'all' }),
    ]).then(([gek, aanbod, afw]) => {
      const all = [
        ...((gek as Aanbesteding[]) || []),
        ...((aanbod as Aanbesteding[]) || []),
        ...((afw as Aanbesteding[]) || []),
      ]
      setTenders(all)
    }).finally(() => setLoading(false))
  }, [])

  // Load AI questions for vraag-ID → vraagtext mapping
  useEffect(() => {
    api.getAIVragen?.().then((vragen) => {
      const map = new Map<string, string>()
      for (const v of (vragen as AIVraag[]) || []) {
        map.set(v.id, v.vraag)
      }
      setVraagMap(map)
    }).catch(() => { /* ignore */ })
  }, [])

  // Persist store to localStorage on change
  const updateStore = useCallback((updater: (prev: PipelineStore) => PipelineStore) => {
    setStore(prev => {
      const next = updater(prev)
      saveStore(next)
      return next
    })
  }, [])

  function getCardData(tender: Aanbesteding): PipelineCardData {
    return store.cards[tender.id] ?? { column: getDefaultColumn(tender) }
  }

  function moveCard(tenderId: string, toColumn: PipelineColumnId) {
    updateStore(prev => ({
      ...prev,
      cards: {
        ...prev.cards,
        [tenderId]: { ...prev.cards[tenderId], column: toColumn },
      },
    }))
  }

  function updateCardData(tenderId: string, data: Partial<PipelineCardData>) {
    updateStore(prev => ({
      ...prev,
      cards: {
        ...prev.cards,
        [tenderId]: { ...prev.cards[tenderId], ...data },
      },
    }))
  }

  // Drag handlers
  function handleDragStart(id: string) {
    setDraggingId(id)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDragOverCol(null)
  }

  function handleDragOver(e: React.DragEvent, colId: PipelineColumnId) {
    e.preventDefault()
    setDragOverCol(colId)
  }

  function handleDrop(colId: PipelineColumnId) {
    if (draggingId) {
      moveCard(draggingId, colId)
    }
    setDraggingId(null)
    setDragOverCol(null)
  }

  // Summary stats
  const totalProjects = tenders.length
  const columnCounts = COLUMNS.reduce((acc, col) => {
    acc[col.id] = tenders.filter(t => getCardData(t).column === col.id).length
    return acc
  }, {} as Record<string, number>)

  const totalValue = tenders
    .filter(t => ['gegund', 'uitvoering', 'opgeleverd'].includes(getCardData(t).column))
    .length

  // Split "niet_gegund" visually — render separately
  const mainColumns = COLUMNS.slice(0, 6)
  const lostColumn = COLUMNS[6]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin" />
          <p className="text-sm text-[var(--muted-foreground)]">Pipeline laden…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full -m-6">
      {/* Page header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)] flex items-center gap-2">
              <Layers className="h-6 w-6 text-[var(--primary)]" />
              Project Pipeline
            </h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
              Volg de voortgang van gekwalificeerde projecten door de inschrijvingsfase tot oplevering
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Quick stats */}
            <div className="hidden sm:flex items-center gap-3">
              <StatPill label="Totaal" value={totalProjects} color="bg-[var(--muted)]" />
              <StatPill label="Actief" value={tenders.filter(t => !['opgeleverd', 'niet_gegund'].includes(getCardData(t).column)).length} color="bg-blue-50" textColor="text-blue-700" />
              <StatPill label="Gewonnen" value={totalValue} color="bg-emerald-50" textColor="text-emerald-700" />
            </div>
          </div>
        </div>

        {/* Flow indicator */}
        <div className="mt-4 hidden lg:flex items-center gap-1 overflow-x-auto pb-1">
          {COLUMNS.map((col, i) => (
            <div key={col.id} className="flex items-center gap-1 flex-shrink-0">
              <div className={cn('flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium', col.badgeBg, col.badgeText)}>
                <col.icon className="h-3 w-3" />
                {col.label}
                {columnCounts[col.id] > 0 && (
                  <span className="font-bold">({columnCounts[col.id]})</span>
                )}
              </div>
              {i < COLUMNS.length - 1 && i !== 5 && (
                <ChevronRight className="h-3 w-3 text-[var(--muted-foreground)] flex-shrink-0" />
              )}
              {i === 5 && (
                <div className="flex items-center gap-1 mx-2">
                  <div className="w-px h-4 bg-[var(--border)]" />
                  <span className="text-[10px] text-[var(--muted-foreground)]">of</span>
                  <div className="w-px h-4 bg-[var(--border)]" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 p-6 h-full min-w-max">
          {/* Main pipeline columns */}
          <div className="flex gap-4 h-full">
            {mainColumns.map(col => (
              <KanbanColumn
                key={col.id}
                column={col}
                cards={tenders
                  .filter(t => getCardData(t).column === col.id)
                  .map(t => ({ tender: t, cardData: getCardData(t) }))}
                draggingId={draggingId}
                isDragOver={dragOverCol === col.id}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onCardClick={setSelectedTender}
              />
            ))}
          </div>

          {/* Divider */}
          <div className="flex flex-col items-center justify-center px-1 flex-shrink-0">
            <div className="h-24 w-px bg-[var(--border)]" />
            <span className="text-[10px] text-[var(--muted-foreground)] rotate-90 my-2 whitespace-nowrap">of</span>
            <div className="h-24 w-px bg-[var(--border)]" />
          </div>

          {/* Niet gegund column */}
          <KanbanColumn
            column={lostColumn}
            cards={tenders
              .filter(t => getCardData(t).column === lostColumn.id)
              .map(t => ({ tender: t, cardData: getCardData(t) }))}
            draggingId={draggingId}
            isDragOver={dragOverCol === lostColumn.id}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onCardClick={setSelectedTender}
          />
        </div>
      </div>

      {/* Legend bar */}
      <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--card)] px-6 py-2">
        <div className="flex items-center gap-4 overflow-x-auto">
          <span className="text-[11px] text-[var(--muted-foreground)] flex-shrink-0">Sluitingsdatum:</span>
          {[
            { label: '≤ 7 dagen', bg: 'bg-rose-100', text: 'text-rose-600' },
            { label: '≤ 21 dagen', bg: 'bg-amber-100', text: 'text-amber-700' },
            { label: '> 21 dagen', bg: 'bg-blue-50', text: 'text-blue-600' },
            { label: 'Verlopen', bg: 'bg-gray-100', text: 'text-gray-500' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-1.5 flex-shrink-0">
              <span className={cn('flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', item.bg, item.text)}>
                <Clock className="h-2.5 w-2.5" />
                {item.label}
              </span>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
            <AlertTriangle className="h-3 w-3" />
            Sleep kaarten om status te wijzigen · Klik voor details
          </div>
        </div>
      </div>

      {/* Modal */}
      {selectedTender && (
        <ProjectModal
          tender={selectedTender}
          column={COLUMNS.find(c => c.id === getCardData(selectedTender).column) ?? COLUMNS[0]}
          cardData={getCardData(selectedTender)}
          vraagMap={vraagMap}
          onClose={() => setSelectedTender(null)}
          onUpdateCard={updateCardData}
          onNavigate={() => {
            navigate(`/aanbestedingen/${selectedTender.id}`)
            setSelectedTender(null)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helper: stat pill
// ---------------------------------------------------------------------------
function StatPill({
  label, value, color = 'bg-[var(--muted)]', textColor = 'text-[var(--foreground)]',
}: {
  label: string
  value: number
  color?: string
  textColor?: string
}) {
  return (
    <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-xl', color)}>
      <span className="text-xs text-[var(--muted-foreground)]">{label}</span>
      <span className={cn('text-sm font-bold', textColor)}>{value}</span>
    </div>
  )
}
