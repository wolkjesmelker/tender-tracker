import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTender, useAsyncData } from '../hooks/use-ipc'
import { api, isElectron } from '../lib/ipc-client'
import { formatDate, getScoreColor, getStatusLabel, getStatusColor } from '../lib/utils'
import {
  ArrowLeft, Brain, Download, ExternalLink, Building2, MapPin,
  CalendarDays, FileText, AlertTriangle, CheckCircle2, Loader2, ScrollText,
  CircleCheck, CircleMinus, CircleX, CircleDot, Info,
  File, FileSpreadsheet, FileImage, FileArchive, FileCode, Eye, Trash2,
  Pause, Square, Play, Sparkles, RefreshCw, ChevronDown,
  ShieldAlert, Clock, ClipboardList, Search, ArrowUpDown, Plus, FileEdit, Zap,
} from 'lucide-react'
import { DeleteConfirmationModal } from '../components/delete-confirmation-modal'
import { LocalDocumentPreviewModal } from '../components/local-document-preview-modal'
import { BronPageEmbedModal } from '../components/bron-page-embed'
import { useAiActivityPanelStore } from '../stores/ai-activity-panel-store'
import { useAnalysisActiveStore } from '../stores/analysis-active-store'
import { useThemeStore } from '../stores/theme-store'
import { ProcedureOverviewCard } from '../components/procedure-timeline'
import { RisicoTab } from '../components/RisicoTab'
import { InschrijvingTab } from '../components/InschrijvingTab'
import { TenderSummaryModal } from '../components/tender-summary-modal'
import { RisicoModelPickerModal } from '../components/risico-model-picker-modal'
import { isFillableCatalogEntry } from '../../shared/fillable-document'
import { FillStatusBadge } from '../components/agent/FillStatusBadge'
import { useAgentStore } from '../stores/agent-store'
import type {
  AgentDocumentFillSummary,
  AiExtractedTenderFields,
  BijlageAnalyse,
  BronNavigatieLink,
  StoredDocumentEntry,
  TenderProcedureContext,
  TenderSummaryExportPayload,
  TenderUpdate,
} from '../../shared/types'
import { hideZipRowIfContentsExpanded } from '../../shared/document-entry'
import { isFormulierBronNavLink } from '../../shared/bron-embed'
import {
  bronFileLinkStableKey,
  catalogDocumentStableKey,
  parseCatalogSelectedKeys,
} from '../../shared/catalog-document-key'
import { FEATURE_DOCUMENT_FORM_FILL } from '../../shared/feature-flags'

/**
 * JSON-objectkolommen (ai_antwoorden, criteria_scores): soms dubbel geëncodeerd na sync,
 * of al een plat object na tussenlagen — anders blijft de UI leeg terwijl data wel in SQLite staat.
 */
function parseStoredJsonRecord(raw: unknown): Record<string, unknown> | null {
  if (raw == null || raw === '') return null
  let v: unknown = raw
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  if (typeof v !== 'string') return null
  const s0 = v.trim()
  if (!s0) return null
  try {
    v = JSON.parse(s0)
  } catch {
    return null
  }
  if (typeof v === 'string') {
    const inner = v.trim()
    if (
      (inner.startsWith('{') && inner.endsWith('}')) ||
      (inner.startsWith('[') && inner.endsWith(']'))
    ) {
      try {
        v = JSON.parse(inner)
      } catch {
        return null
      }
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function parseStoredJsonArray(raw: unknown): unknown[] {
  if (raw == null || raw === '') return []
  let v: unknown = raw
  if (Array.isArray(v)) return v
  if (typeof v !== 'string') return []
  const s0 = v.trim()
  if (!s0) return []
  try {
    v = JSON.parse(s0)
  } catch {
    return []
  }
  if (typeof v === 'string') {
    const inner = v.trim()
    if (inner.startsWith('[')) {
      try {
        v = JSON.parse(inner)
      } catch {
        return []
      }
    }
  }
  return Array.isArray(v) ? v : []
}

function analysisCheckpointStageLabel(stage: string | null): string {
  if (!stage) return ''
  if (stage === 'bron_docs') return 'bron-documenten ophalen'
  if (stage === 'db_docs') return 'bijlagen verwerken'
  if (stage === 'ai') return 'AI-beoordeling'
  return stage
}

/** Voortgangsindicator: 0% navy-blauw → 100% groen. */
function mainAnalyseProgressAccentColor(pct: number): string {
  const t = Math.min(1, Math.max(0, pct / 100))
  const from = { r: 0x1a, g: 0x3e, b: 0x5c }
  const to = { r: 0x16, g: 0x80, b: 0x3d }
  return `rgb(${Math.round(from.r + (to.r - from.r) * t)}, ${Math.round(from.g + (to.g - from.g) * t)}, ${Math.round(from.b + (to.b - from.b) * t)})`
}

/** Renders plain text with smart formatting: detects headings, bullets, numbered lists, and key-value pairs */
// ---------------------------------------------------------------------------
// Token-based description formatter
// ---------------------------------------------------------------------------
type DescToken =
  | { type: 'h1'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; num: string; text: string }
  | { type: 'lettered'; letter: string; text: string }
  | { type: 'kv'; key: string; value: string }
  | { type: 'paragraph'; text: string }

/**
 * Splits a single paragraph that contains inline lettered items like:
 * "a. blah; b. blah c. blah d. blah"
 */
function splitInlineLetteredList(paragraph: string): Array<{ letter: string; text: string }> | null {
  if (!/^[a-z]\.\s/i.test(paragraph)) return null
  const parts = paragraph.split(/(?:;\s*|\.\s+)(?=[a-z]\.\s)/i)
  const items: Array<{ letter: string; text: string }> = []
  for (const part of parts) {
    const m = part.trim().match(/^([a-z])\.\s+([\s\S]+)/i)
    if (m) items.push({ letter: m[1].toLowerCase(), text: m[2].trim() })
  }
  return items.length >= 2 ? items : null
}

/** Veelvoorkomende encoding/tekstfouten uit tracking (apostroffen als '?'). */
function repairDescriptionEncoding(s: string): string {
  let t = s
  t = t.replace(/(\w)\?s(\b|[ ,.;:!?)])/gi, "$1's$2")
  t = t.replace(/co\?rdinerende/gi, 'coördinerende')
  t = t.replace(/co\?rdinatie/gi, 'coördinatie')
  t = t.replace(/co\?rdin/gi, 'coördin')
  return t
}

/**
 * Maakt van één lange regel (geen regeleinden) een tekst met alinea's en herkenbare koppen,
 * zodat FormattedDescription de bestaande logica kan gebruiken.
 */
function expandWallOfTextToMultiline(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ')
  const newlineCount = (t.match(/\n/g) || []).length
  const isDense = newlineCount < 2 && t.length > 400

  if (isDense) {
    t = t.replace(/\s+/g, ' ').trim()
    // Bekende sectiekoppen (vacatures / gemeentelijke teksten)
    const sectionBreaks: [RegExp, string][] = [
      [/\s+(Wat ga je (?:doen|worden)\?)\s+/gi, '\n\n$1\n\n'],
      [/\s+(Wie zoeken wij\?)\s+/gi, '\n\n$1\n\n'],
      [/\s+(Wat breng je mee\?)\s+/gi, '\n\n$1\n\n'],
      [/\s+(Wat bieden wij\?)\s+/gi, '\n\n$1\n\n'],
      [/\s+(Wat verwachten wij\?)\s+/gi, '\n\n$1\n\n'],
      [/\s+(Functieomschrijving|Functie omschrijving)\s*:?\s+/gi, '\n\n$1\n\n'],
      [/\s+(Taken en verantwoordelijkheden)\s*:?\s+/gi, '\n\n$1\n\n'],
      [/\s+(Profiel|Functie-eisen|Functie eisen)\s*:?\s+/gi, '\n\n$1\n\n'],
      [/\s+(Arbeidsvoorwaarden)\s*:?\s+/gi, '\n\n$1\n\n'],
    ]
    for (const [re, rep] of sectionBreaks) {
      t = t.replace(re, rep)
    }
    // Nieuwe alinea vóór typische openingszinnen van een sectie-vraag
    t = t.replace(
      /\s+((?:Wat|Hoe|Waar|Wie|Waarom|Welke|Kun|Kan|Heb|Ben) [^.?!]{8,140}\?)\s+(?=[A-ZÁÉËÏÍÓÖÚÄÖÜ]) /gi,
      '\n\n$1\n\n',
    )
    // Nog steeds weinig structuur: splitsen op zinsgrenzen (Nederlandse zin-start)
    if ((t.match(/\n/g) || []).length < 3 && t.length > 600) {
      t = t
        .split(/(?<=[.!?])\s+(?=[A-ZÁÉËÏÍÓÖÚÄÖÜÆ][a-záéëïíóöúæœåäöüßàèìòùç])/)
        .map((p) => p.trim())
        .filter(Boolean)
        .join('\n\n')
    }
  } else {
    t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  }
  return t.trim()
}

function preprocessDescriptionForFormatting(text: string): string {
  return expandWallOfTextToMultiline(repairDescriptionEncoding(text))
}

/** Lange alinea met veel puntkomma's → opsplitsen in bullets (takenlijsten). */
function expandSemicolonParagraphToBullets(text: string): DescToken[] | null {
  const trimmed = text.trim()
  if (trimmed.length < 120) return null
  const parts = trimmed.split(/;\s+/)
  if (parts.length < 4) return null
  const avgLen = trimmed.length / parts.length
  if (avgLen < 20) return null
  const bullets: DescToken[] = []
  for (const p of parts) {
    const x = p.trim()
    if (x) bullets.push({ type: 'bullet', text: x })
  }
  return bullets.length >= 4 ? bullets : null
}

// ---------------------------------------------------------------------------
// AI Samenvatting formatter — splits plain text into readable paragraphs
// ---------------------------------------------------------------------------
function FormattedSamenvatting({ text }: { text: string }) {
  // Split on sentence boundaries, keeping the delimiter
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÀÈÌÒÙÄËÏÖÜ\u2022\u2013\u2014–—])/)
    .map(s => s.trim())
    .filter(Boolean)

  if (sentences.length === 0) return null

  // Group into paragraphs of ~2 sentences each
  const paragraphs: string[][] = []
  for (let i = 0; i < sentences.length; i += 2) {
    paragraphs.push(sentences.slice(i, i + 2))
  }

  const lead = paragraphs[0]
  const rest = paragraphs.slice(1)

  // Detect if a paragraph mentions risk/concern keywords
  const isRisk = (p: string[]) =>
    /risico|ontbreekt|mist|onduidelijk|zal meer informatie|niet in|niet bekend|let op/i.test(p.join(' '))
  const isPositive = (p: string[]) =>
    /kans|opportun|voordeel|relevant|passend|sterk|ruime|waardevolle/i.test(p.join(' '))

  return (
    <div className="space-y-3">
      {/* Lead paragraph – slightly emphasised */}
      <p className="text-sm font-medium text-[var(--foreground)] leading-relaxed">
        {lead.join(' ')}
      </p>

      {rest.map((para, i) => {
        const text = para.join(' ')
        const risk = isRisk(para)
        const positive = isPositive(para)
        return (
          <div
            key={i}
            className={`flex gap-3 rounded-lg px-3 py-2.5 text-sm leading-relaxed ${
              risk
                ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/30'
                : positive
                  ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/30'
                  : 'bg-[var(--muted)]/40'
            }`}
          >
            <span className="mt-0.5 shrink-0 text-base leading-none">
              {risk ? '⚠️' : positive ? '✓' : '›'}
            </span>
            <span className="text-[var(--foreground)]">
              {text}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function FormattedDescription({ text }: { text: string }) {
  const normalizedText = useMemo(() => preprocessDescriptionForFormatting(text), [text])

  // ── Step 1: tokenise ──────────────────────────────────────────────────────
  const tokens: DescToken[] = []
  const lines = normalizedText.split('\n')
  let pendingParagraph: string[] = []

  const flushPending = () => {
    if (pendingParagraph.length === 0) return
    const content = pendingParagraph.join(' ').trim()
    pendingParagraph = []
    if (!content) return

    // Inline lettered list (a. ... b. ... c. ...)
    const inlineLettered = splitInlineLetteredList(content)
    if (inlineLettered) {
      for (const item of inlineLettered) tokens.push({ type: 'lettered', ...item })
      return
    }
    const semiBullets = expandSemicolonParagraphToBullets(content)
    if (semiBullets) {
      for (const b of semiBullets) tokens.push(b)
      return
    }
    tokens.push({ type: 'paragraph', text: content })
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) { flushPending(); continue }

    // ALL CAPS header
    const isAllCaps = line.length > 3 && line.length < 120 && line === line.toUpperCase() && /[A-Z]/.test(line) && !/^\d/.test(line)
    if (isAllCaps) { flushPending(); tokens.push({ type: 'h1', text: line }); continue }

    // Header ending with ":"
    const isHeaderColon = line.endsWith(':') && line.length < 120 && !/^\d+\./.test(line)
    if (isHeaderColon) { flushPending(); tokens.push({ type: 'h2', text: line }); continue }

    // Sectiekop als vraag (bijv. "Wat ga je doen?")
    const isHeaderQuestion =
      line.endsWith('?') &&
      line.length >= 8 &&
      line.length < 180 &&
      /^(Wat|Wie|Hoe|Waar|Waarom|Welke|Kun|Kan|Heb|Ben|Mag|Moet)\b/i.test(line) &&
      !line.slice(0, -1).includes('?')
    if (isHeaderQuestion) { flushPending(); tokens.push({ type: 'h2', text: line }); continue }

    // Bullet (-  •  ▪ etc.)
    const bulletM = line.match(/^[-•·▪▸►]\s+(.+)/)
    if (bulletM) { flushPending(); tokens.push({ type: 'bullet', text: bulletM[1] }); continue }

    // Numbered list (1. or 1))
    const numM = line.match(/^(\d+)[.)]\s+(.+)/)
    if (numM) { flushPending(); tokens.push({ type: 'numbered', num: numM[1], text: numM[2] }); continue }

    // Lettered list on its own line  (a. blah)
    const letM = line.match(/^([a-z])\.\s+(.+)/i)
    if (letM) { flushPending(); tokens.push({ type: 'lettered', letter: letM[1].toLowerCase(), text: letM[2] }); continue }

    // Key: value pair
    const kvM = line.match(/^([A-Za-zÀ-ÿ\s/&()-]{2,45}):\s+(.+)/)
    if (kvM && !line.startsWith('http')) { flushPending(); tokens.push({ type: 'kv', key: kvM[1], value: kvM[2] }); continue }

    pendingParagraph.push(line)
  }
  flushPending()

  // ── Step 2: merge orphaned paragraphs into the preceding lettered item ────
  // A "paragraph" token that immediately follows a "lettered" token is a
  // continuation of that item (e.g. "(buizen en putten)" after item f).
  const merged: DescToken[] = []
  for (const tok of tokens) {
    if (
      tok.type === 'paragraph' &&
      merged.length > 0 &&
      merged[merged.length - 1].type === 'lettered'
    ) {
      const prev = merged[merged.length - 1] as Extract<DescToken, { type: 'lettered' }>
      merged[merged.length - 1] = { ...prev, text: `${prev.text} ${tok.text}` }
    } else {
      merged.push(tok)
    }
  }

  const expanded: DescToken[] = []
  for (const tok of merged) {
    if (tok.type === 'paragraph') {
      const semi = expandSemicolonParagraphToBullets(tok.text)
      if (semi) expanded.push(...semi)
      else expanded.push(tok)
    } else {
      expanded.push(tok)
    }
  }

  // ── Step 3: render ────────────────────────────────────────────────────────
  if (expanded.length === 0) {
    return (
      <p className="text-sm text-[var(--foreground)] leading-relaxed whitespace-pre-wrap">
        {normalizedText}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {expanded.map((tok, idx) => {
        switch (tok.type) {
          case 'h1':
            return (
              <h3 key={idx} className="mt-5 mb-2 text-xs font-bold uppercase tracking-widest text-[var(--primary)] first:mt-0 border-b border-[var(--border)] pb-1">
                {tok.text}
              </h3>
            )
          case 'h2':
            return (
              <h4 key={idx} className="mt-4 mb-1.5 text-sm font-bold text-[var(--foreground)] first:mt-0">
                {tok.text}
              </h4>
            )
          case 'bullet':
            return (
              <div key={idx} className="flex items-start gap-2 ml-2 my-0.5">
                <span className="text-[var(--primary)] mt-2 flex-shrink-0">
                  <svg className="h-1.5 w-1.5" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" /></svg>
                </span>
                <span className="text-sm text-[var(--foreground)] leading-relaxed">{highlightKeyValues(tok.text)}</span>
              </div>
            )
          case 'numbered':
            return (
              <div key={idx} className="flex items-start gap-2.5 ml-1 my-0.5">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/10 text-[10px] font-bold text-[var(--primary)] mt-0.5">
                  {tok.num}
                </span>
                <span className="text-sm text-[var(--foreground)] leading-relaxed">{highlightKeyValues(tok.text)}</span>
              </div>
            )
          case 'lettered':
            return (
              <div key={idx} className="flex items-start gap-2.5 ml-1 my-0.5">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-[var(--primary)]/10 text-[11px] font-bold text-[var(--primary)] mt-0.5 uppercase">
                  {tok.letter}
                </span>
                <span className="text-sm text-[var(--foreground)] leading-relaxed">{highlightKeyValues(tok.text)}</span>
              </div>
            )
          case 'kv':
            return (
              <div key={idx} className="flex flex-wrap items-baseline gap-x-1.5 my-0.5 text-sm">
                <span className="font-semibold text-[var(--foreground)] whitespace-nowrap">{tok.key}:</span>
                <span className="text-[var(--muted-foreground)]">{tok.value}</span>
              </div>
            )
          case 'paragraph':
          default:
            return (
              <p key={idx} className="text-sm text-[var(--foreground)] leading-relaxed">
                {highlightKeyValues(tok.text)}
              </p>
            )
        }
      })}
    </div>
  )
}

/** Highlights important keywords in text */
function highlightKeyValues(text: string): React.ReactElement {
  // Highlight euro amounts
  const parts = text.split(/(€[\s]?[\d.,]+(?:\s?(?:miljoen|mln|k|M))?)/g)
  if (parts.length <= 1) return <>{text}</>

  return (
    <>
      {parts.map((part, i) =>
        part.match(/^€/) ? (
          <span key={i} className="font-semibold text-[var(--foreground)] bg-green-50 dark:bg-green-900/30 rounded px-0.5">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

type AnalysisBatchStatusPayload = {
  running?: boolean
  singleRunning?: boolean
  singleAnalysisId?: string | null
  currentId?: string
  current?: number
  total?: number
  currentTitle?: string
  risico?: { running?: boolean; aanbestedingId?: string | null; queuedIds?: string[] }
  singleAnalysisQueuedIds?: string[]
}

const analyseButtonTitle = (step: string, agent: string) => {
  const parts = [step, agent ? `Agent: ${agent}` : ''].filter(Boolean)
  return parts.join(' — ') || undefined
}

function PdfIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="2" y="1" width="18" height="23" rx="2" fill="#fff" stroke="#e5e7eb" strokeWidth="1" />
      <path d="M2 3a2 2 0 012-2h10l6 6v15a2 2 0 01-2 2H4a2 2 0 01-2-2V3z" fill="#fff" stroke="#d1d5db" strokeWidth="1" />
      <path d="M14 1l6 6h-4a2 2 0 01-2-2V1z" fill="#e5e7eb" stroke="#d1d5db" strokeWidth="1" />
      <rect x="0" y="14" width="22" height="9" rx="1.5" fill="#dc2626" />
      <text x="11" y="21" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold" fontFamily="system-ui,sans-serif" letterSpacing="0.5">PDF</text>
    </svg>
  )
}

function getFileIcon(name: string, docType?: string) {
  const lower = (name || '').toLowerCase()
  const typeLower = (docType || '').toLowerCase()
  const ic = 'h-7 w-7 flex-shrink-0'
  const isPdf = lower.endsWith('.pdf') || typeLower === 'pdf'
  if (isPdf) return <PdfIcon className={ic} />
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return <FileText className={`${ic} text-blue-600`} />
  if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) return <FileSpreadsheet className={`${ic} text-green-600`} />
  if (lower.endsWith('.zip') || lower.endsWith('.rar')) return <FileArchive className={`${ic} text-yellow-600`} />
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return <FileImage className={`${ic} text-purple-500`} />
  if (lower.endsWith('.xml') || lower.endsWith('.json')) return <FileCode className={`${ic} text-orange-500`} />
  return <File className={`${ic} text-[var(--muted-foreground)]`} />
}

/** Vaste sRGB in lichte modus (Tailwind v4 OKLCH oogt vaak flets/grijsachtig). */
const RELEVANCE_ROW_LIGHT: Record<
  string,
  { bg: string; border: string; label: string; icon: string; pillBg: string; pillBorder: string }
> = {
  match: {
    bg: '#dcfce7',
    border: '#22c55e',
    label: '#14532d',
    icon: '#15803d',
    pillBg: '#bbf7d0',
    pillBorder: '#4ade80',
  },
  gedeeltelijk: {
    bg: '#fef08a',
    border: '#eab308',
    label: '#713f12',
    icon: '#a16207',
    pillBg: '#fde047',
    pillBorder: '#ca8a04',
  },
  niet_aanwezig: {
    bg: '#e2e8f0',
    border: '#64748b',
    label: '#1e293b',
    icon: '#475569',
    pillBg: '#f1f5f9',
    pillBorder: '#94a3b8',
  },
  risico: {
    bg: '#fecaca',
    border: '#ef4444',
    label: '#7f1d1d',
    icon: '#b91c1c',
    pillBg: '#fca5a5',
    pillBorder: '#dc2626',
  },
}

export function TenderDetailPage() {
  const isDark = useThemeStore((s) => s.dark)
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as 'overzicht' | 'inschrijving' | 'risico' | null
  const { data: tender, loading, refresh } = useTender(id!)
  const { data: questions } = useAsyncData(() => api.getAIVragen(), [])
  const [analyzing, setAnalyzing] = useState(false)
  const [globalAnalysisBusy, setGlobalAnalysisBusy] = useState(false)
  /** Laatste pipeline-stap (bron, bijlagen, AI) — ook bij batch elders, zodat de knop actie toont */
  const [liveAnalysisStep, setLiveAnalysisStep] = useState('')
  const [liveAnalysisTenderId, setLiveAnalysisTenderId] = useState('')
  const [hasAnalysisCheckpoint, setHasAnalysisCheckpoint] = useState(false)
  const [analysisCheckpointModalOpen, setAnalysisCheckpointModalOpen] = useState(false)
  const [checkpointModalStage, setCheckpointModalStage] = useState<string | null>(null)
  const [checkpointConfigMismatch, setCheckpointConfigMismatch] = useState(false)
  const [discoveringDocs, setDiscoveringDocs] = useState(false)
  const [discoverStep, setDiscoverStep] = useState('')
  const [analysisError, setAnalysisError] = useState('')
  const [expandedCriteria, setExpandedCriteria] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [summaryModalOpen, setSummaryModalOpen] = useState(false)
  const [risicoModelPickerOpen, setRisicoModelPickerOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [fillRefreshKey, setFillRefreshKey] = useState(0)
  const wizardOpen = useAgentStore((s) => s.wizard.open)
  const prevWizardOpenRef = useRef(wizardOpen)
  useEffect(() => {
    if (prevWizardOpenRef.current && !wizardOpen) {
      setFillRefreshKey((k) => k + 1)
    }
    prevWizardOpenRef.current = wizardOpen
  }, [wizardOpen])

  const [fillSummariesByDoc, setFillSummariesByDoc] = useState<Map<string, AgentDocumentFillSummary>>(() => new Map())
  useEffect(() => {
    if (!FEATURE_DOCUMENT_FORM_FILL || !id) return
    let cancelled = false
    void (async () => {
      try {
        const rows = (await api.agentGetFillSummary?.({ tenderId: id })) as AgentDocumentFillSummary[] | null
        if (cancelled) return
        const m = new Map<string, AgentDocumentFillSummary>()
        for (const r of rows || []) {
          if (r.document_naam) m.set(r.document_naam, r)
        }
        setFillSummariesByDoc(m)
      } catch {
        if (!cancelled) setFillSummariesByDoc(new Map())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, fillRefreshKey, tender?.updated_at, tender?.risico_analyse_at])
  const [localPreviewFile, setLocalPreviewFile] = useState<{ naam: string; size: number } | null>(null)
  /** Bron-URL uit document_urls — zelfde preview-modal als lokale bestanden */
  const [bronPreview, setBronPreview] = useState<{ url: string; naam: string } | null>(null)
  /** Keys of documents that failed both in-app preview and external open; filtered from lists. */
  const [unavailableDocKeys, setUnavailableDocKeys] = useState<Set<string>>(new Set())
  const [bronPageEmbed, setBronPageEmbed] = useState<{ url: string; title: string } | null>(null)
  const [localDocSaving, setLocalDocSaving] = useState<string | null>(null)
  const [localOpenError, setLocalOpenError] = useState('')
  const [localAnalysePanelOpen, setLocalAnalysePanelOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'overzicht' | 'inschrijving' | 'risico'>(
    tabParam === 'inschrijving' || tabParam === 'risico' ? tabParam : 'overzicht'
  )
  const [docSearch, setDocSearch] = useState('')
  const [docSortBy, setDocSortBy] = useState<'naam' | 'type'>('naam')
  const [docTypeFilter, setDocTypeFilter] = useState<string | null>(null)
  /** Alleen aangevinkte catalogus-/bronlinks tonen */
  const [docSelectionFilter, setDocSelectionFilter] = useState<'all' | 'selected'>('all')
  /** Catalogus in documentenpaneel: alles, alleen invuldocumenten, of alleen inlichtingsdocumenten (+ bronlinks) */
  const [docCatalogWeergave, setDocCatalogWeergave] = useState<'all' | 'invul' | 'inlichting'>('all')
  useEffect(() => {
    if (!FEATURE_DOCUMENT_FORM_FILL && docCatalogWeergave === 'invul') {
      setDocCatalogWeergave('all')
    }
  }, [docCatalogWeergave])
  const [manualDocAdding, setManualDocAdding] = useState(false)
  const [removeCatalogBusy, setRemoveCatalogBusy] = useState(false)
  const [manualUploadHint, setManualUploadHint] = useState<string | null>(null)
  const [notities, setNotities] = useState('')
  const [notitiesSaved, setNotitiesSaved] = useState(false)
  const notitiesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [analysisRuntime, setAnalysisRuntime] = useState({
    batchRunning: false,
    batchCurrent: 0,
    batchTotal: 0,
    currentTitle: '',
    currentId: '',
    singleRunning: false,
    singleAnalysisId: null as string | null,
    risicoRunning: false,
    risicoAanbestedingId: null as string | null,
    risicoQueuedIds: [] as string[],
    singleQueuedIds: [] as string[],
  })
  const [liveAnalysisPct, setLiveAnalysisPct] = useState<number | null>(null)

  // ── Nieuwe documenten: welke docs zijn nieuw na laatste scrape? ──
  const [nieuweDocNamen, setNieuweDocNamen] = useState<Set<string>>(new Set())
  const [tenderUpdateIds, setTenderUpdateIds] = useState<string[]>([])
  const [filterNieuweDocs, setFilterNieuweDocs] = useState(false)

  useEffect(() => {
    if (!id || !isElectron) return
    let cancelled = false
    void (async () => {
      try {
        const updates = (await (api as any).getTenderUpdatesForTender?.(id)) as TenderUpdate[] | undefined
        if (cancelled || !updates?.length) {
          setNieuweDocNamen(new Set())
          setTenderUpdateIds([])
          return
        }
        const namen = new Set<string>()
        const ids: string[] = []
        for (const u of updates) {
          ids.push(u.id)
          if (u.nieuwe_document_namen) {
            try {
              const arr = JSON.parse(u.nieuwe_document_namen) as string[]
              arr.forEach((n) => namen.add(n))
            } catch { /* skip */ }
          }
        }
        if (!cancelled) {
          setNieuweDocNamen(namen)
          setTenderUpdateIds(ids)
        }
      } catch { /* stil falen */ }
    })()
    return () => { cancelled = true }
  }, [id, tender?.updated_at])

  const toggleCatalogDocKey = useCallback(
    async (key: string, checked: boolean) => {
      if (!id) return
      const raw = (tender as { document_catalog_selected_keys?: string } | null)?.document_catalog_selected_keys
      const next = parseCatalogSelectedKeys(typeof raw === 'string' ? raw : undefined)
      if (checked) next.add(key)
      else next.delete(key)
      await api.updateTender(id, { document_catalog_selected_keys: JSON.stringify([...next]) })
      await refresh()
    },
    [id, tender, refresh],
  )

  const removeSelectedCatalogEntries = useCallback(
    async (keys: string[]) => {
      if (!id || keys.length === 0) return
      const removeFn = (
        api as {
          removeTenderCatalogEntries?: (tid: string, k: string[]) => Promise<{
            success?: boolean
            error?: string
          }>
        }
      ).removeTenderCatalogEntries
      if (typeof removeFn !== 'function') return
      if (
        !window.confirm(
          `Weet je zeker dat je ${keys.length} item(s) uit de documentenlijst wilt halen? Lokaal opgeslagen bestanden worden permanent gewist. Dit kan niet ongedaan worden gemaakt.`,
        )
      ) {
        return
      }
      setRemoveCatalogBusy(true)
      try {
        const r = await removeFn(id, keys)
        if (!r?.success) {
          window.alert(r?.error || 'Verwijderen mislukt.')
          return
        }
        await refresh()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'Verwijderen mislukt.')
      } finally {
        setRemoveCatalogBusy(false)
      }
    },
    [id, refresh],
  )

  const handleAddManualDocuments = useCallback(async () => {
    if (!id || !isElectron) return
    const addFn = (api as { addManualTenderDocuments?: (tenderId: string) => Promise<unknown> })
      .addManualTenderDocuments
    if (typeof addFn !== 'function') return
    setManualDocAdding(true)
    setManualUploadHint(null)
    try {
      const r = (await addFn(id)) as {
        success?: boolean
        cancelled?: boolean
        error?: string
        added?: string[]
      }
      if (r?.cancelled) return
      if (!r?.success) {
        setManualUploadHint(r?.error || 'Toevoegen mislukt.')
        return
      }
      const n = r.added?.length ?? 0
      setManualUploadHint(
        n > 0
          ? `${n} bestand(en) toegevoegd. Aanvullende AI-analyse start automatisch (alleen op deze bestanden); voortgang zie je bij de AI-analyse hierboven.`
          : 'Klaar.',
      )
      await refresh()
    } catch (e: unknown) {
      setManualUploadHint(e instanceof Error ? e.message : 'Toevoegen mislukt.')
    } finally {
      setManualDocAdding(false)
    }
  }, [id, refresh])

  const refreshAnalysisCheckpoint = React.useCallback(async () => {
    const r = (await api.getAnalysisCheckpoint?.(id!)) as
      | { hasCheckpoint?: boolean; configMismatch?: boolean; stage?: string | null }
      | undefined
    setHasAnalysisCheckpoint(Boolean(r?.hasCheckpoint))
  }, [id])

  useEffect(() => {
    void refreshAnalysisCheckpoint()
  }, [refreshAnalysisCheckpoint])

  /** ZIP’s uitpakken + procedure/tijdlijn uit TenderNed TNS als die nog ontbreken */
  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const normalize = (
          api as { normalizeTenderOnOpen?: (tenderId: string) => Promise<{ updated?: boolean }> }
        ).normalizeTenderOnOpen
        if (!normalize) return
        const r = await normalize(id)
        if (!cancelled && r?.updated) await refresh()
      } catch {
        /* stil falen — detail blijft bruikbaar */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, refresh])

  useEffect(() => {
    const unsub = api.onDocumentsDiscoverProgress?.((data: unknown) => {
      const d = data as { aanbestedingId?: string; step?: string; percentage?: number }
      if (d.aanbestedingId !== id) return
      if (typeof d.step === 'string' && d.step.trim()) setDiscoverStep(d.step.trim())
    })
    return () => {
      unsub?.()
    }
  }, [id])

  useEffect(() => {
    setLocalAnalysePanelOpen(false)
  }, [id])

  useEffect(() => {
    if (tender) {
      setNotities((tender as any).notities || '')
    }
  }, [(tender as any)?.notities])

  const handleNotitiesChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setNotities(value)
    setNotitiesSaved(false)
    if (notitiesTimerRef.current) clearTimeout(notitiesTimerRef.current)
    notitiesTimerRef.current = setTimeout(async () => {
      await api.updateTender(id!, { notities: value })
      setNotitiesSaved(true)
      setTimeout(() => setNotitiesSaved(false), 2000)
    }, 800)
  }, [id])

  useEffect(() => {
    let cancelled = false
    const syncBusy = async () => {
      const s = (await api.getBatchStatus?.()) as AnalysisBatchStatusPayload | undefined
      if (cancelled || !s) return
      const risicoBusy = Boolean(s.risico?.running)
      const busy = Boolean(s.running || s.singleRunning || risicoBusy)
      setGlobalAnalysisBusy(busy)
      const risicoQ = Array.isArray(s.risico?.queuedIds) ? s.risico!.queuedIds! : []
      const singleQ = Array.isArray(s.singleAnalysisQueuedIds) ? s.singleAnalysisQueuedIds : []
      setAnalysisRuntime({
        batchRunning: Boolean(s.running),
        batchCurrent: typeof s.current === 'number' ? s.current : 0,
        batchTotal: typeof s.total === 'number' ? s.total : 0,
        currentTitle: typeof s.currentTitle === 'string' ? s.currentTitle : '',
        currentId: typeof s.currentId === 'string' ? s.currentId : '',
        singleRunning: Boolean(s.singleRunning),
        singleAnalysisId: s.singleAnalysisId ?? null,
        risicoRunning: risicoBusy,
        risicoAanbestedingId: s.risico?.aanbestedingId ?? null,
        risicoQueuedIds: risicoQ,
        singleQueuedIds: singleQ,
      })
      if (!busy) {
        setLiveAnalysisStep('')
        setLiveAnalysisTenderId('')
        setLiveAnalysisPct(null)
        void refreshAnalysisCheckpoint()
      }
    }
    void syncBusy()
    const interval = setInterval(() => void syncBusy(), 700)
    const unsub = api.onAnalysisProgress?.((data: unknown) => {
      const d = data as {
        step?: string
        aanbestedingId?: string
        batch?: boolean
        done?: boolean
        percentage?: number
        agent?: string
      }
      const forThisTender = typeof d.aanbestedingId === 'string' && d.aanbestedingId === id
      if (forThisTender) {
        setLiveAnalysisTenderId(id!)
        if (typeof d.percentage === 'number' && Number.isFinite(d.percentage)) {
          setLiveAnalysisPct(Math.round(Math.max(0, Math.min(100, d.percentage))))
        }
      }
      if (forThisTender && typeof d.step === 'string' && d.step.trim()) {
        setLiveAnalysisStep(d.step.trim())
      }
      if (d.batch && d.done) {
        void refresh()
      }
      void syncBusy()
    })
    return () => {
      cancelled = true
      clearInterval(interval)
      unsub?.()
    }
  }, [id, refresh, refreshAnalysisCheckpoint])

  const tenderActive = useAnalysisActiveStore((s) => (id ? s.active[id] : undefined))

  const t = tender as any
  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" /></div>
  if (!t) return <div className="py-20 text-center text-[var(--muted-foreground)]">Aanbesteding niet gevonden</div>

  const analyseEntry = tenderActive?.type === 'analyse' ? tenderActive : null
  const aiAnalyseInWachtrij = Boolean(id && analysisRuntime.singleQueuedIds.includes(id))

  const thisTenderMainAnalyseRunning =
    !!id &&
    (analyseEntry != null ||
      (analyzing && (!liveAnalysisTenderId || liveAnalysisTenderId === id)) ||
      (!analyzing &&
        globalAnalysisBusy &&
        (liveAnalysisTenderId === id ||
          (analysisRuntime.singleRunning && analysisRuntime.singleAnalysisId === id) ||
          (analysisRuntime.batchRunning && analysisRuntime.currentId === id))))

  const analysisButtonDisabled = analyzing || thisTenderMainAnalyseRunning || aiAnalyseInWachtrij

  const thisTenderAnalysisRunning = thisTenderMainAnalyseRunning

  const thisTenderSingleAnalyseForPause =
    !analyzing &&
    !analysisRuntime.batchRunning &&
    (analyseEntry?.type === 'analyse' ||
      (analysisRuntime.singleRunning && analysisRuntime.singleAnalysisId === id) ||
      liveAnalysisTenderId === id)

  const showPauseStop =
    (analyzing && (!liveAnalysisTenderId || liveAnalysisTenderId === id)) ||
    (thisTenderSingleAnalyseForPause && globalAnalysisBusy)

  const mainAnalyseProgressStep =
    analyseEntry?.step ||
    (thisTenderMainAnalyseRunning ? liveAnalysisStep : '') ||
    ''
  const mainAnalyseProgressPct =
    analyseEntry != null
      ? Math.min(100, Math.max(0, analyseEntry.percentage))
      : liveAnalysisPct != null
        ? liveAnalysisPct
        : 0
  const mainAnalyseAgent = analyseEntry?.agent?.trim() || ''
  const risicoOnlyBusyHere =
    tenderActive?.type === 'risico' &&
    analysisRuntime.risicoAanbestedingId === id &&
    !analyseEntry
  const risicoTabBusy =
    !!id &&
    (tenderActive?.type === 'risico' ||
      (analysisRuntime.risicoRunning && analysisRuntime.risicoAanbestedingId === id))
  const showMainAnalyseProgressBanner =
    !!id &&
    !analyzing &&
    !risicoTabBusy &&
    (analyseEntry != null ||
      (analysisRuntime.batchRunning && analysisRuntime.currentId === id) ||
      (analysisRuntime.singleRunning && analysisRuntime.singleAnalysisId === id))

  const mainAnalyseBannerStep =
    mainAnalyseProgressStep ||
    (analysisRuntime.batchRunning && analysisRuntime.currentId === id
      ? `Batch ${analysisRuntime.batchCurrent}/${analysisRuntime.batchTotal}${
          analysisRuntime.currentTitle ? `: ${analysisRuntime.currentTitle.slice(0, 72)}` : ''
        }`
      : 'AI-analyse bezig…')

  const risicoWachtrijPositie =
    id && analysisRuntime.risicoQueuedIds.includes(id)
      ? analysisRuntime.risicoQueuedIds.indexOf(id) + 1
      : null

  const overzichtTabBusy = !!id && thisTenderMainAnalyseRunning

  const antwoorden: Record<string, string> = {}
  const rawAntwoorden = parseStoredJsonRecord(t.ai_antwoorden)
  if (rawAntwoorden) {
    for (const [k, v] of Object.entries(rawAntwoorden)) {
      if (v == null) continue
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      if (s.trim()) antwoorden[k] = s
    }
  }

  const criteriaScores = parseStoredJsonRecord(t.criteria_scores) ?? {}

  const bijlageRaw = parseStoredJsonArray(t.bijlage_analyses)
  const bijlageAnalysesList = bijlageRaw as BijlageAnalyse[]

  const hasRelevancePanel =
    t.totaal_score != null ||
    t.relevantie_score != null ||
    Object.keys(criteriaScores).length > 0 ||
    bijlageAnalysesList.length > 0 ||
    Boolean(typeof t.match_uitleg === 'string' && t.match_uitleg.trim())

  const aiAntwoordEntries = (() => {
    const qList = ((questions as any[]) || []) as { id: string; vraag?: string; volgorde?: number }[]
    const byId = new Map(qList.map((q) => [q.id, q]))
    const entries = Object.entries(antwoorden).filter(([, a]) => a != null && String(a).trim() !== '')
    entries.sort((a, b) => {
      const qa = byId.get(a[0])
      const qb = byId.get(b[0])
      const oa = qa?.volgorde ?? 999999
      const ob = qb?.volgorde ?? 999999
      if (oa !== ob) return oa - ob
      return a[0].localeCompare(b[0])
    })
    return entries.map(([qid, answer]) => ({
      qid,
      answer,
      vraag: byId.get(qid)?.vraag,
    }))
  })()

  let documenten: StoredDocumentEntry[] = []
  try {
    if (t.document_urls) {
      const raw = JSON.parse(t.document_urls)
      if (Array.isArray(raw)) {
        documenten = raw
          .map((x: any) => ({
            url: x.url ? String(x.url) : undefined,
            localNaam: x.localNaam ? String(x.localNaam) : undefined,
            naam: String(x.naam || 'Document'),
            type: String(x.type || ''),
            bronZipLabel: x.bronZipLabel ? String(x.bronZipLabel) : undefined,
            addedByUser: Boolean(x.addedByUser),
          }))
          .filter((d: StoredDocumentEntry) => Boolean(d.url?.trim() || d.localNaam?.trim()))
      }
    }
  } catch {
    documenten = []
  }
  documenten = hideZipRowIfContentsExpanded(documenten)
    .filter((d) => !unavailableDocKeys.has(d.url ?? '') && !unavailableDocKeys.has(d.localNaam ?? ''))

  const catalogSelectedKeysSet = parseCatalogSelectedKeys(
    typeof t.document_catalog_selected_keys === 'string' ? t.document_catalog_selected_keys : undefined,
  )
  const documentenForCatalog =
    docSelectionFilter === 'selected'
      ? documenten.filter((d) => catalogSelectedKeysSet.has(catalogDocumentStableKey(d)))
      : documenten

  const _getDocExt = (naam: string, type?: string) =>
    (type || naam.split('.').pop() || '').toUpperCase()

  const _sortDocsByType = (a: StoredDocumentEntry, b: StoredDocumentEntry) => {
    const extA = _getDocExt(a.naam, a.type).toLowerCase()
    const extB = _getDocExt(b.naam, b.type).toLowerCase()
    if (extA !== extB) return extA.localeCompare(extB)
    return a.naam.localeCompare(b.naam)
  }

  const _applyDocSortAndSearch = (docs: StoredDocumentEntry[]): StoredDocumentEntry[] => {
    const q = docSearch.trim().toLowerCase()
    let filtered = q ? docs.filter(d => d.naam.toLowerCase().includes(q)) : docs
    if (docTypeFilter) filtered = filtered.filter(d => _getDocExt(d.naam, d.type) === docTypeFilter)
    if (filterNieuweDocs && nieuweDocNamen.size > 0) {
      filtered = filtered.filter(d => nieuweDocNamen.has(d.naam))
    }
    // Nieuwe documenten altijd bovenaan sorteren
    const isNieuw = (d: StoredDocumentEntry) => nieuweDocNamen.has(d.naam)
    if (docSortBy === 'type') {
      return [...filtered].sort((a, b) => {
        const nA = isNieuw(a) ? 0 : 1
        const nB = isNieuw(b) ? 0 : 1
        if (nA !== nB) return nA - nB
        return _sortDocsByType(a, b)
      })
    }
    return [...filtered].sort((a, b) => {
      const nA = isNieuw(a) ? 0 : 1
      const nB = isNieuw(b) ? 0 : 1
      if (nA !== nB) return nA - nB
      return a.naam.localeCompare(b.naam)
    })
  }

  const docHasAgentFillWork = (naam: string) => {
    const s = fillSummariesByDoc.get(naam)
    return Boolean(s && (s.total_fields > 0 || s.checklist_total > 0))
  }
  const docShowsInvulUi = (d: StoredDocumentEntry) =>
    isFillableCatalogEntry(d.naam, d.type) || docHasAgentFillWork(d.naam)

  const invulDocumenten = _applyDocSortAndSearch(documentenForCatalog.filter((d) => docShowsInvulUi(d)))
  const informatieDocumenten = _applyDocSortAndSearch(documentenForCatalog.filter((d) => !docShowsInvulUi(d)))

  const localFiles: { naam: string, size: number }[] = Array.isArray(t.local_document_files) ? t.local_document_files : []
  const catalogLocalNames = new Set(
    documenten.map((d) => d.localNaam).filter((n): n is string => Boolean(n?.trim()))
  )
  const orphanLocalFiles = localFiles.filter((f) => !catalogLocalNames.has(f.naam) && !unavailableDocKeys.has(f.naam))

  let procedureContext: TenderProcedureContext | null = null
  try {
    if (t.tender_procedure_context) {
      const raw = JSON.parse(t.tender_procedure_context)
      if (raw && typeof raw === 'object') {
        const timeline = Array.isArray(raw.timeline)
          ? raw.timeline
          : [
              {
                id: 'legacy',
                label: 'Procedure',
                detail:
                  'Geen tijdslijn in opgeslagen gegevens. Kies «Documenten zoeken» of start de AI-analyse opnieuw om de procedure bij te werken.',
              },
            ]
        procedureContext = { ...raw, timeline } as TenderProcedureContext
      }
    }
  } catch {
    procedureContext = null
  }

  let bronNavLinks: BronNavigatieLink[] = []
  try {
    if (t.bron_navigatie_links) {
      const raw = JSON.parse(t.bron_navigatie_links)
      if (Array.isArray(raw)) {
        bronNavLinks = raw.filter(
          (x: unknown) =>
            x &&
            typeof x === 'object' &&
            typeof (x as BronNavigatieLink).url === 'string' &&
            (x as BronNavigatieLink).url.length > 5
        ) as BronNavigatieLink[]
      }
    }
  } catch {
    bronNavLinks = []
  }

  /** Extensies die als downloadbaar bestand worden beschouwd */
  const FILE_EXTS = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|tar|gz|xml|csv|odt|ods|odp|dwg|dxf|ifc|jpg|jpeg|png|tiff?)(\?.*)?$/i
  const isFileUrl = (url: string) => FILE_EXTS.test(url.split('?')[0].split('#')[0])

  /** Splits bronNavLinks in bestandslinks (→ documentenpaneel) en paginalinks (→ beschrijving) */
  const bronFileLinks = bronNavLinks.filter(l => isFileUrl(l.url) && !unavailableDocKeys.has(l.url))
  const bronPageLinks = bronNavLinks.filter(l => !isFileUrl(l.url))
  const bronFileLinksForCatalog =
    docSelectionFilter === 'selected'
      ? bronFileLinks.filter((l) => catalogSelectedKeysSet.has(bronFileLinkStableKey(l.url)))
      : bronFileLinks

  const _docSearchQ = docSearch.trim().toLowerCase()
  const _bronLinkExt = (url: string) => (url.split('.').pop()?.split('?')[0] || '').toUpperCase()
  const filteredBronFileLinks = bronFileLinksForCatalog
    .filter(l => !_docSearchQ || (l.titel || l.url).toLowerCase().includes(_docSearchQ))
    .filter(l => !docTypeFilter || _bronLinkExt(l.url) === docTypeFilter)

  const catalogShowsInvul = docCatalogWeergave === 'all' || docCatalogWeergave === 'invul'
  const catalogShowsInlichting = docCatalogWeergave === 'all' || docCatalogWeergave === 'inlichting'
  /** Bij filter «Invul» geen bronpagina-links (meestal geen inschrijfformulieren). */
  const showBronFilesInCatalog = docCatalogWeergave !== 'invul'
  const visibleCatalogDocsCount =
    (catalogShowsInlichting ? informatieDocumenten.length : 0) +
    (catalogShowsInvul ? invulDocumenten.length : 0)

  const uniqueDocTypes: string[] = Array.from(new Set([
    ...documentenForCatalog.map(d => _getDocExt(d.naam, d.type)).filter(Boolean),
    ...bronFileLinksForCatalog.map(l => _bronLinkExt(l.url)).filter(Boolean),
  ])).sort()

  let aiExtracted: Partial<AiExtractedTenderFields> = {}
  try {
    if (t.ai_extracted_fields) {
      const raw = JSON.parse(t.ai_extracted_fields)
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) aiExtracted = raw as Partial<AiExtractedTenderFields>
    }
  } catch {
    aiExtracted = {}
  }

  const dispOpdrachtgever = t.opdrachtgever || aiExtracted.opdrachtgever
  const dispRegio = t.regio || aiExtracted.locatie_of_regio
  const dispPublicatie = t.publicatiedatum || aiExtracted.publicatiedatum
  const dispSluiting = t.sluitingsdatum || aiExtracted.sluitingsdatum_inschrijving
  const dispWaarde = t.geraamde_waarde || aiExtracted.geraamde_waarde
  const dispType = t.type_opdracht || aiExtracted.type_opdracht
  const dispRef = t.referentienummer || aiExtracted.referentienummer

  const apiH = procedureContext?.apiHighlights
  const fmtSummaryDate = (d?: string) => {
    if (!d?.trim()) return undefined
    const x = formatDate(d)
    return x === '-' ? undefined : x
  }
  const sluitingSamenvatting = dispSluiting || apiH?.sluitingsDatum
  const publicatieSamenvatting = dispPublicatie || apiH?.publicatieDatum
  const samenvattingTxt = (t.ai_samenvatting || '').trim()
  const beschrijvingTxt = (t.beschrijving || '').trim()
  const inhoudStukken: string[] = []
  if (samenvattingTxt) inhoudStukken.push(samenvattingTxt)
  if (beschrijvingTxt && beschrijvingTxt !== samenvattingTxt) {
    const frag =
      beschrijvingTxt.length > 2800 ? `${beschrijvingTxt.slice(0, 2800)}\u2026` : beschrijvingTxt
    inhoudStukken.push(samenvattingTxt ? `\u2014\nOmschrijving (fragment)\n${frag}` : frag)
  }
  if (aiExtracted.cpv_of_werkzaamheden?.trim()) {
    inhoudStukken.push(`CPV / werkzaamheden: ${aiExtracted.cpv_of_werkzaamheden.trim()}`)
  }
  const inhoudSamenvatting = inhoudStukken.join('\n\n').trim()
  const bronSamenvatting =
    (t.bron_website_naam && String(t.bron_website_naam).trim()) ||
    (t.bron_url && String(t.bron_url).replace(/^https?:\/\//i, '').split('/')[0]) ||
    undefined
  const tenderSummaryPayload: TenderSummaryExportPayload = {
    titel: (t.titel && String(t.titel).trim()) || 'Aanbesteding',
    inhoud: inhoudSamenvatting || undefined,
    locatie: dispRegio?.trim() || undefined,
    opdrachtgever: dispOpdrachtgever?.trim() || undefined,
    startUitvoering: fmtSummaryDate(aiExtracted.datum_start_uitvoering),
    eindeUitvoering: fmtSummaryDate(aiExtracted.datum_einde_uitvoering),
    uiterlijkIndienen: fmtSummaryDate(sluitingSamenvatting),
    budget: dispWaarde?.trim() || undefined,
    typeOpdracht: dispType?.trim() || undefined,
    referentie: dispRef?.trim() || undefined,
    procedure: aiExtracted.procedure_type?.trim() || apiH?.typePublicatie?.trim() || undefined,
    publicatie: fmtSummaryDate(publicatieSamenvatting),
    bron: bronSamenvatting,
    indiening: aiExtracted.indiening_adres?.trim() || undefined,
  }

  const runStartAnalysisFlow = async (opts?: { discardCheckpoint?: boolean }) => {
    if (analyzing || thisTenderMainAnalyseRunning || aiAnalyseInWachtrij) return
    useAiActivityPanelStore.getState().startActivitySession(id!, [
      { step: 'Analyse starten…', percentage: 0, at: Date.now() },
    ])
    setAnalyzing(true)
    setAnalysisError('')
    setLiveAnalysisStep('Analyse starten...')
    setLiveAnalysisTenderId(id!)

    try {
      const result = (await api.startAnalysis(id!, opts)) as
        | {
            success?: boolean
            error?: string
            paused?: boolean
            stopped?: boolean
            queued?: boolean
            position?: number
            duplicateInQueue?: boolean
            alreadyRunning?: boolean
            conflict?: boolean
          }
        | null
      if (result?.conflict) {
        setAnalysisCheckpointModalOpen(true)
        try {
          const ck = (await api.getAnalysisCheckpoint?.(id!)) as
            | { stage?: string | null; configMismatch?: boolean }
            | undefined
          setCheckpointModalStage(ck?.stage != null ? String(ck.stage) : null)
          setCheckpointConfigMismatch(Boolean(ck?.configMismatch))
        } catch {
          setCheckpointModalStage(null)
          setCheckpointConfigMismatch(false)
        }
        return
      }
      if (result?.queued) {
        /* Positie via batch-status poll */
      } else if (result && !result.success && !result.stopped) {
        setAnalysisError(result.error || 'Analyse mislukt')
      } else {
        await refresh()
      }
      await refreshAnalysisCheckpoint()
    } catch (err: any) {
      setAnalysisError(err.message || 'Onbekende fout bij analyse')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleAnalyze = async () => {
    if (analyzing || thisTenderMainAnalyseRunning || aiAnalyseInWachtrij) return
    if (t?.totaal_score != null) {
      const proceed = window.confirm(
        `Waarschuwing: deze aanbesteding is al volledig geanalyseerd (score ${Math.round(t.totaal_score)}).\n` +
          'Opnieuw analyseren verbruikt extra tokens.\n\n' +
          'Toch opnieuw analyseren?',
      )
      if (!proceed) return
    }
    try {
      const ck = (await api.getAnalysisCheckpoint?.(id!)) as
        | { hasCheckpoint?: boolean; configMismatch?: boolean; stage?: string | null }
        | undefined
      if (ck?.hasCheckpoint) {
        setCheckpointModalStage(ck.stage != null ? String(ck.stage) : null)
        setCheckpointConfigMismatch(Boolean(ck.configMismatch))
        setAnalysisCheckpointModalOpen(true)
        return
      }
    } catch {
      /* geen checkpoint-info: start normaal */
    }
    await runStartAnalysisFlow()
  }

  const handleResumeAnalysis = async () => {
    if (analyzing || globalAnalysisBusy) return
    useAiActivityPanelStore.getState().startActivitySession(id!, [
      { step: 'Analyse hervatten…', percentage: 0, at: Date.now() },
    ])
    setAnalyzing(true)
    setAnalysisError('')
    setLiveAnalysisStep('Analyse hervatten...')
    setLiveAnalysisTenderId(id!)

    try {
      const result = (await api.resumeAnalysis?.(id!)) as
        | { success?: boolean; error?: string; paused?: boolean; stopped?: boolean }
        | null
      if (result && !result.success && !result.stopped) {
        setAnalysisError(result.error || 'Hervatten mislukt')
      } else {
        await refresh()
      }
      await refreshAnalysisCheckpoint()
    } catch (err: any) {
      setAnalysisError(err.message || 'Onbekende fout bij hervatten')
    } finally {
      setAnalyzing(false)
    }
  }

  const handlePauseAnalysis = async () => {
    try {
      await api.pauseAnalysis?.()
    } catch (err: any) {
      setAnalysisError(err.message || 'Pauzeren mislukt')
    }
  }

  const handleStopAnalysis = async () => {
    try {
      await api.stopAnalysis?.(id!)
      setLiveAnalysisStep('')
      await refreshAnalysisCheckpoint()
    } catch (err: any) {
      setAnalysisError(err.message || 'Stoppen mislukt')
    }
  }

  const handleStartRisicoHeranalyse = async () => {
    if (!id || risicoTabBusy) return
    setRisicoModelPickerOpen(true)
  }

  const handleRisicoModelSelected = async (modelId: string) => {
    setRisicoModelPickerOpen(false)
    if (!id) return
    try {
      let result: { success: boolean; error?: string } | undefined
      if (modelId === 'agentic') {
        result = await (api as any).startRisicoAnalyseV2(id) as { success: boolean; error?: string }
      } else if (modelId === 'default') {
        await (api as any).startRisicoAnalyse(id)
      } else {
        await (api as any).startRisicoAnalyseWithModel(id, modelId)
      }
      if (result && !result.success && result.error) {
        setAnalysisError(`Agentic analyse mislukt: ${result.error}`)
        return
      }
      setActiveTab('risico')
    } catch (err: any) {
      setAnalysisError(err.message || 'Risico-heranalyse starten mislukt')
    }
  }

  const handleDiscoverDocuments = async () => {
    if (!id || !t?.bron_url || discoveringDocs || globalAnalysisBusy || analyzing) return
    setDiscoveringDocs(true)
    setDiscoverStep('Documenten zoeken starten…')
    setAnalysisError('')
    try {
      const r = (await api.discoverTenderDocuments?.(id)) as
        | { success?: boolean; error?: string; documentCount?: number }
        | null
      if (r && !r.success) {
        setAnalysisError(r.error || 'Documenten zoeken mislukt')
      }
      await refresh()
    } catch (err: any) {
      setAnalysisError(err.message || 'Documenten zoeken mislukt')
    } finally {
      setDiscoveringDocs(false)
      setDiscoverStep('')
    }
  }

  const handleExport = async (format: 'pdf' | 'word') => {
    await api.exportData({ format, aanbestedingIds: [id!], includeAnalysis: true, includeScores: true })
  }

  const handleStatusChange = async (status: string) => {
    await api.updateTender(id!, { status })
    refresh()
  }

  const handleConfirmDelete = async () => {
    setDeleteLoading(true)
    try {
      await api.deleteTender(id!)
      navigate('/aanbestedingen')
    } finally {
      setDeleteLoading(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleQuickSaveLocalDoc = async (f: { naam: string; size: number }, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!id) return
    setLocalDocSaving(f.naam)
    try {
      await api.saveLocalTenderDocumentAs(id, f.naam)
    } finally {
      setLocalDocSaving(null)
    }
  }

  const handleLocalFileClick = (f: { naam: string; size: number }) => {
    setLocalOpenError('')
    setBronPreview(null)
    if (!id) return
    setLocalPreviewFile(f)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <LocalDocumentPreviewModal
        open={Boolean(localPreviewFile) || Boolean(bronPreview)}
        tenderId={id!}
        file={bronPreview ? null : localPreviewFile}
        bronSource={
          bronPreview && id
            ? { url: bronPreview.url, fileName: bronPreview.naam, tenderId: id }
            : null
        }
        onClose={() => {
          setLocalPreviewFile(null)
          setBronPreview(null)
        }}
        onUnavailable={() => {
          const key = bronPreview?.url ?? localPreviewFile?.naam
          if (key) setUnavailableDocKeys((prev) => new Set([...prev, key]))
          setLocalPreviewFile(null)
          setBronPreview(null)
        }}
      />
      <BronPageEmbedModal
        open={Boolean(bronPageEmbed)}
        url={bronPageEmbed?.url ?? ''}
        title={bronPageEmbed?.title ?? ''}
        tenderId={id!}
        onClose={() => setBronPageEmbed(null)}
      />
      <TenderSummaryModal
        open={summaryModalOpen && !risicoTabBusy}
        onClose={() => setSummaryModalOpen(false)}
        data={tenderSummaryPayload}
      />
      <RisicoModelPickerModal
        open={risicoModelPickerOpen}
        onClose={() => setRisicoModelPickerOpen(false)}
        onSelect={handleRisicoModelSelected}
      />
      <DeleteConfirmationModal
        open={showDeleteConfirm}
        title="Aanbesteding verwijderen?"
        description="Weet je zeker dat je deze aanbesteding wilt verwijderen? Alle bijbehorende lokaal opgeslagen documenten (interne opslag) worden ook gewist. Dit kan niet ongedaan worden gemaakt."
        loading={deleteLoading}
        onCancel={() => !deleteLoading && setShowDeleteConfirm(false)}
        onConfirm={handleConfirmDelete}
      />

      {analysisCheckpointModalOpen ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkpoint-choice-title"
          onClick={(e) => e.target === e.currentTarget && setAnalysisCheckpointModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border bg-[var(--card)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--muted)]">
                <Info className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="checkpoint-choice-title" className="text-base font-semibold text-[var(--foreground)]">
                  Opgeslagen analysevoortgang
                </h2>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                  Er is nog tussenopgeslagen voortgang van een eerdere analyse
                  {checkpointModalStage
                    ? ` (${analysisCheckpointStageLabel(checkpointModalStage)})`
                    : ''}
                  . Wil je die hervatten of opnieuw beginnen? Opnieuw beginnen wist de opgeslagen voortgang.
                </p>
                {checkpointConfigMismatch ? (
                  <p className="mt-2 rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                    Let op: je criteria, vragen of prompts zijn gewijzigd sinds deze voortgang. Hervatten kan een
                    mengeling van oude en nieuwe instellingen geven.
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={() => setAnalysisCheckpointModalOpen(false)}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm hover:bg-[var(--muted)]"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={() => {
                  setAnalysisCheckpointModalOpen(false)
                  void runStartAnalysisFlow({ discardCheckpoint: true })
                }}
                className="rounded-lg border border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-950/30 px-4 py-2 text-sm text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/50"
              >
                Opnieuw beginnen
              </button>
              <button
                type="button"
                onClick={() => {
                  setAnalysisCheckpointModalOpen(false)
                  void handleResumeAnalysis()
                }}
                className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
              >
                Hervatten
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Back button & actions */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
          <ArrowLeft className="h-4 w-4" /> Terug
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 px-3 py-2 text-sm font-medium text-white transition-colors"
          >
            <Trash2 className="h-4 w-4" /> Verwijderen
          </button>
          {hasAnalysisCheckpoint && !globalAnalysisBusy && !analyzing && (
            <button
              type="button"
              onClick={handleResumeAnalysis}
              className="flex max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 px-3 py-2 text-sm font-medium text-[var(--primary)] hover:bg-[var(--primary)]/15 transition-colors"
            >
              <Play className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">Hervatten</span>
            </button>
          )}
          {showPauseStop && (
            <>
              <button
                type="button"
                onClick={handlePauseAnalysis}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-[var(--muted)] transition-colors"
              >
                <Pause className="h-4 w-4 shrink-0" /> Pauze
              </button>
              <button
                type="button"
                onClick={handleStopAnalysis}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
              >
                <Square className="h-4 w-4 shrink-0" /> Stop
              </button>
            </>
          )}
          <button
            onClick={handleAnalyze}
            disabled={analysisButtonDisabled}
            title={
              analysisButtonDisabled
                ? analyseButtonTitle(
                    thisTenderMainAnalyseRunning ? mainAnalyseProgressStep : liveAnalysisStep,
                    thisTenderMainAnalyseRunning ? mainAnalyseAgent : ''
                  )
                : undefined
            }
            className="flex max-w-full min-w-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {analyzing || thisTenderMainAnalyseRunning ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : aiAnalyseInWachtrij ? (
              <Clock className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            ) : (
              <Brain className="h-4 w-4 shrink-0" />
            )}
            <span className="min-w-0 truncate text-left">
              {analyzing || thisTenderMainAnalyseRunning
                ? mainAnalyseProgressStep || (analyzing ? 'Analyseren…' : 'Analyse bezig…')
                : aiAnalyseInWachtrij
                  ? `In wachtrij (nr. ${analysisRuntime.singleQueuedIds.indexOf(id!) + 1})`
                  : 'AI Analyse'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSummaryModalOpen(true)}
            title="Korte samenvatting: inhoud, locatie, opdrachtgever, planning, deadline, budget"
            className="flex items-center gap-1.5 rounded-lg border border-[var(--primary)]/35 bg-[var(--primary)]/8 px-3 py-2 text-sm font-medium text-[var(--primary)] hover:bg-[var(--primary)]/14 transition-colors"
          >
            <ScrollText className="h-4 w-4 shrink-0" />
            Samenvatting
          </button>
          <button onClick={() => handleExport('pdf')} className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-[var(--muted)] transition-colors">
            <Download className="h-4 w-4" /> PDF
          </button>
          <button onClick={() => handleExport('word')} className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-[var(--muted)] transition-colors">
            <Download className="h-4 w-4" /> Word
          </button>
        </div>
      </div>

      {/* Analysis error */}
      {analysisError && (
        <div className="rounded-lg border border-red-300 dark:border-red-700/50 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-300">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <strong>Analyse fout:</strong> {analysisError}
              {analysisError.includes('API-sleutel') && (
                <p className="mt-1 text-xs">Ga naar <strong>Instellingen</strong> om je API-sleutel in te voeren.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showMainAnalyseProgressBanner && (
        <div className="self-start w-full max-w-[430px] rounded-md border bg-[var(--card)] px-2.5 py-1.5 shadow-sm">
          <div className="mb-1 flex items-center gap-1.5">
            <Loader2
              className="h-3.5 w-3.5 shrink-0 animate-spin"
              style={{ color: mainAnalyseProgressAccentColor(mainAnalyseProgressPct) }}
              aria-hidden
            />
            <span className="text-[11px] font-semibold text-[var(--foreground)]">AI-analyse</span>
            {mainAnalyseAgent ? (
              <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                {mainAnalyseAgent}
              </span>
            ) : null}
            <span className="ml-auto text-[10px] font-semibold tabular-nums text-[var(--muted-foreground)]">
              {mainAnalyseProgressPct}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[var(--muted)]">
            <div
              className="h-1.5 rounded-full transition-[width,background-color] duration-500 ease-out"
              style={{
                width: `${mainAnalyseProgressPct}%`,
                backgroundColor: mainAnalyseProgressAccentColor(mainAnalyseProgressPct),
              }}
            />
          </div>
        </div>
      )}

      {/* =================== TABS =================== */}
      <div className="inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 self-start rounded-xl border bg-[var(--card)] p-0.5 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab('overzicht')}
          aria-busy={overzichtTabBusy}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${activeTab === 'overzicht' ? 'bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'}`}
        >
          {overzichtTabBusy ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <Brain className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          Overzicht & Analyse
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('inschrijving')}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${activeTab === 'inschrijving' ? 'bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'}`}
        >
          <ClipboardList className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Inschrijving & Procedure
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('risico')}
          aria-busy={risicoTabBusy}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${activeTab === 'risico' ? 'bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'}`}
        >
          {risicoTabBusy ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          Risico Inventarisatie
          {t.risico_analyse && (
            <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              (() => { try { const r = JSON.parse(t.risico_analyse); return r.overall_score === 'Hoog' ? 'bg-red-200 dark:bg-red-900/60 text-red-800 dark:text-red-200' : r.overall_score === 'Middel' ? 'bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200' : 'bg-green-200 dark:bg-green-900/60 text-green-800 dark:text-green-200' } catch { return 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300' } })()
            }`}>
              {(() => { try { return JSON.parse(t.risico_analyse).overall_score } catch { return '•' } })()}
            </span>
          )}
        </button>
        {/* Handmatige heranalyse-knop — alleen zichtbaar als er al een risico-analyse is */}
        {t.risico_analyse && (
          <button
            type="button"
            onClick={handleStartRisicoHeranalyse}
            disabled={risicoTabBusy || thisTenderAnalysisRunning}
            title="Nieuwe risico: volledige risico-inventarisatie opnieuw (alleen op jouw actie; geen automatische herstart na AI-analyse)"
            className="ml-1 flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-40 transition-colors"
          >
            {risicoTabBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            <span className="whitespace-nowrap">Nieuwe risico</span>
          </button>
        )}
      </div>

      {/* Overzicht: twee kolommen; links scrollt, documentenpaneel vult de rij (geen dvh buiten main) */}
      {activeTab === 'overzicht' ? (
        <div className="flex min-h-0 flex-1 gap-6 items-stretch">
          <div className="min-h-0 flex-1 min-w-0 overflow-y-auto space-y-6">

          {/* ── Overzicht Tab content ── */}
          {/* Title & status */}
          <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-xl font-bold text-[var(--foreground)]">{t.titel}</h1>
              <select
                value={t.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium border-0 focus:ring-2 focus:ring-[var(--ring)] ${getStatusColor(t.status)}`}
              >
                <option value="gevonden">Gevonden</option>
                <option value="gekwalificeerd">Gekwalificeerd</option>
                <option value="in_aanbieding">In aanbieding</option>
                <option value="afgewezen">Afgewezen</option>
                <option value="gearchiveerd">Gearchiveerd</option>
              </select>
            </div>

            {/* Info grid (database + door AI aangevulde velden) */}
            <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {dispOpdrachtgever && (
                <div className="flex items-center gap-2 text-sm"><Building2 className="h-4 w-4 text-[var(--muted-foreground)]" /><div><p className="text-[10px] text-[var(--muted-foreground)]">Opdrachtgever{!t.opdrachtgever && aiExtracted.opdrachtgever ? ' (AI)' : ''}</p><p className="font-medium">{dispOpdrachtgever}</p></div></div>
              )}
              {dispRegio && (
                <div className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4 text-[var(--muted-foreground)]" /><div><p className="text-[10px] text-[var(--muted-foreground)]">Regio{!t.regio && aiExtracted.locatie_of_regio ? ' (AI)' : ''}</p><p className="font-medium">{dispRegio}</p></div></div>
              )}
              {dispPublicatie && (
                <div className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4 text-[var(--muted-foreground)]" /><div><p className="text-[10px] text-[var(--muted-foreground)]">Publicatie{!t.publicatiedatum && aiExtracted.publicatiedatum ? ' (AI)' : ''}</p><p className="font-medium">{formatDate(dispPublicatie)}</p></div></div>
              )}
              {dispSluiting && (
                <div className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4 text-red-400" /><div><p className="text-[10px] text-[var(--muted-foreground)]">Sluiting{!t.sluitingsdatum && aiExtracted.sluitingsdatum_inschrijving ? ' (AI)' : ''}</p><p className="font-medium text-red-600">{formatDate(dispSluiting)}</p></div></div>
              )}
              {dispWaarde && (
                <div className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4 text-[var(--muted-foreground)]" /><div><p className="text-[10px] text-[var(--muted-foreground)]">Geraamde waarde{!t.geraamde_waarde && aiExtracted.geraamde_waarde ? ' (AI)' : ''}</p><p className="font-medium">{dispWaarde}</p></div></div>
              )}
              {dispType && (
                <div className="text-sm"><p className="text-[10px] text-[var(--muted-foreground)]">Type{!t.type_opdracht && aiExtracted.type_opdracht ? ' (AI)' : ''}</p><p className="font-medium">{dispType}</p></div>
              )}
              {dispRef && (
                <div className="text-sm"><p className="text-[10px] text-[var(--muted-foreground)]">Referentie{!t.referentienummer && aiExtracted.referentienummer ? ' (AI)' : ''}</p><p className="font-medium">{dispRef}</p></div>
              )}
              {aiExtracted.procedure_type && (
                <div className="text-sm"><p className="text-[10px] text-[var(--muted-foreground)]">Procedure (AI)</p><p className="font-medium">{aiExtracted.procedure_type}</p></div>
              )}
              {(aiExtracted.datum_start_uitvoering || aiExtracted.datum_einde_uitvoering) && (
                <div className="text-sm col-span-2 lg:col-span-2">
                  <p className="text-[10px] text-[var(--muted-foreground)]">Uitvoering (AI)</p>
                  <p className="font-medium">
                    {[aiExtracted.datum_start_uitvoering, aiExtracted.datum_einde_uitvoering]
                      .filter(Boolean)
                      .map((x) => formatDate(String(x)))
                      .join(' — ')}
                  </p>
                </div>
              )}
              {aiExtracted.cpv_of_werkzaamheden && (
                <div className="text-sm col-span-2 lg:col-span-4"><p className="text-[10px] text-[var(--muted-foreground)]">CPV / werkzaamheden (AI)</p><p className="font-medium leading-snug">{aiExtracted.cpv_of_werkzaamheden}</p></div>
              )}
              {t.bron_website_naam && (
                <div className="text-sm"><p className="text-[10px] text-[var(--muted-foreground)]">Bron</p><p className="font-medium">{t.bron_website_naam}</p></div>
              )}
            </div>

            {(aiExtracted.beoordelingscriteria_kort || aiExtracted.opmerkingen) && (
              <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-4 text-sm space-y-3">
                {aiExtracted.beoordelingscriteria_kort && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Beoordelingscriteria (AI)</p>
                    <p className="text-[var(--foreground)] leading-relaxed mt-1">{aiExtracted.beoordelingscriteria_kort}</p>
                  </div>
                )}
                {aiExtracted.opmerkingen && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Feitelijke opmerkingen (AI)</p>
                    <p className="text-[var(--foreground)] leading-relaxed mt-1 whitespace-pre-wrap">{aiExtracted.opmerkingen}</p>
                  </div>
                )}
              </div>
            )}

            {t.bron_url && (
              <div className="mt-3 space-y-1">
                <p className="text-[10px] text-[var(--muted-foreground)]">Officiële detailpagina (alle gegevens en documenten op de bron)</p>
                <a href={t.bron_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-[var(--primary)] hover:underline break-all">
                  Bekijk op bron <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                </a>
              </div>
            )}
          </div>

          {procedureContext && <ProcedureOverviewCard context={procedureContext} />}

          {/* Score card — ook tonen als alleen criteria/bijlage/match_uitleg zijn opgeslagen (totaal_score kan ontbreken) */}
          {hasRelevancePanel && (
            <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">
                  {t.totaal_score != null ? 'Relevantiescore' : 'Criteria & bijlage-analyses'}
                </h2>
                <div className="flex items-center gap-4 text-[10px] text-[var(--muted-foreground)]">
                  <span className="flex items-center gap-1"><CircleCheck className="h-3.5 w-3.5 text-green-500" /> Match</span>
                  <span className="flex items-center gap-1"><CircleDot className="h-3.5 w-3.5 text-yellow-500" /> Gedeeltelijk</span>
                  <span className="flex items-center gap-1"><CircleMinus className="h-3.5 w-3.5 text-gray-400" /> N/A</span>
                  <span className="flex items-center gap-1"><CircleX className="h-3.5 w-3.5 text-red-500" /> Risico</span>
                </div>
              </div>

              <div className="flex items-start gap-6">
                {t.totaal_score != null ? (
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <div className={`flex h-20 w-20 items-center justify-center rounded-full border-4 text-2xl font-bold ${getScoreColor(t.totaal_score)}`}
                      style={{ borderColor: t.totaal_score >= 70 ? '#16a34a' : t.totaal_score >= 40 ? '#ca8a04' : '#dc2626' }}>
                      {Math.round(t.totaal_score)}
                    </div>
                    <span className="text-[10px] text-[var(--muted-foreground)]">van 100</span>
                  </div>
                ) : (
                  <div className="flex max-w-[140px] flex-shrink-0 flex-col gap-1 rounded-lg border border-dashed border-[var(--border)] bg-[var(--muted)]/20 p-3 text-[10px] text-[var(--muted-foreground)]">
                    <span className="font-medium text-[var(--foreground)]">Geen totaalscore</span>
                    <span>Opgeslagen criteria- en bijlage-analyses staan hiernaast / hieronder.</span>
                  </div>
                )}

                <div className="flex-1 space-y-1.5">
                  {Object.keys(criteriaScores).length > 0 && (
                    Object.entries(criteriaScores).map(([key, detail]) => {
                      const isDetailed = typeof detail === 'object' && detail !== null
                      const score = isDetailed ? (detail as any).score ?? 0 : (detail as number) ?? 0
                      // Always derive status from score — the stored status string from the AI can be
                      // inconsistent (e.g. score=40 with status='niet_aanwezig'). The numeric score
                      // is more reliable and was the only source in earlier analyses.
                      const status =
                        score < 0 ? 'risico'
                        : score >= 75 ? 'match'
                        : score >= 25 ? 'gedeeltelijk'
                        : 'niet_aanwezig'
                      const toelichting = isDetailed ? (detail as any).toelichting : ''
                      const brontekst = isDetailed ? (detail as any).brontekst : ''
                      const criteriumLabel =
                        isDetailed && typeof (detail as any).criterium_naam === 'string' && (detail as any).criterium_naam.trim()
                          ? (detail as any).criterium_naam.trim()
                          : key
                      const isExpanded = expandedCriteria.has(key)
                      const hasDetails = toelichting || brontekst

                      const statusConfig: Record<string, { icon: typeof CircleCheck, color: string, bgColor: string, borderColor: string, label: string }> = {
                        match: { icon: CircleCheck, color: 'text-green-800 dark:text-green-400', bgColor: 'bg-[#bbf7d0] dark:bg-green-950/30', borderColor: 'border-[#4ade80] dark:border-green-700/50', label: 'Match' },
                        gedeeltelijk: { icon: CircleDot, color: 'text-amber-800 dark:text-yellow-400', bgColor: 'bg-[#fde68a] dark:bg-yellow-950/30', borderColor: 'border-[#f59e0b] dark:border-yellow-700/50', label: 'Gedeeltelijk' },
                        niet_aanwezig: { icon: CircleMinus, color: 'text-gray-600 dark:text-gray-500', bgColor: 'bg-[#e5e7eb] dark:bg-gray-800/30', borderColor: 'border-[#9ca3af] dark:border-gray-700/50', label: 'Niet aanwezig' },
                        risico: { icon: CircleX, color: 'text-red-700 dark:text-red-400', bgColor: 'bg-[#fecaca] dark:bg-red-950/30', borderColor: 'border-[#f87171] dark:border-red-700/50', label: 'Risico' },
                      }
                      const config = statusConfig[status] || statusConfig.niet_aanwezig
                      const Icon = config.icon
                      const lightUi = RELEVANCE_ROW_LIGHT[status] ?? RELEVANCE_ROW_LIGHT.niet_aanwezig

                      return (
                        <div
                          key={key}
                          className={`rounded-lg border transition-colors ${isDark ? `${config.borderColor} ${config.bgColor}` : ''}`}
                          style={
                            !isDark
                              ? { backgroundColor: lightUi.bg, borderColor: lightUi.border }
                              : undefined
                          }
                        >
                          <button
                            onClick={() => {
                              if (!hasDetails) return
                              setExpandedCriteria(prev => {
                                const next = new Set(prev)
                                if (next.has(key)) next.delete(key)
                                else next.add(key)
                                return next
                              })
                            }}
                            className={`flex items-center gap-3 w-full px-3 py-2.5 text-left ${
                              hasDetails
                                ? 'cursor-pointer hover:bg-black/[0.06] dark:hover:bg-white/5'
                                : 'cursor-default'
                            } transition-colors`}
                          >
                            <Icon
                              className={`h-5 w-5 flex-shrink-0 ${isDark ? config.color : ''}`}
                              style={!isDark ? { color: lightUi.icon } : undefined}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-[var(--foreground)] truncate">{criteriumLabel}</span>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span
                                    className={`text-xs font-semibold ${isDark ? config.color : ''}`}
                                    style={!isDark ? { color: lightUi.label } : undefined}
                                  >
                                    {config.label}
                                  </span>
                                  {score !== 0 && (
                                    <span
                                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                                        isDark ? `${config.bgColor} ${config.color} ${config.borderColor}` : ''
                                      }`}
                                      style={
                                        !isDark
                                          ? {
                                              backgroundColor: lightUi.pillBg,
                                              borderColor: lightUi.pillBorder,
                                              color: lightUi.label,
                                            }
                                          : undefined
                                      }
                                    >
                                      {Math.round(score)}
                                    </span>
                                  )}
                                  {hasDetails && (
                                    <svg className={`h-3.5 w-3.5 text-[var(--muted-foreground)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                              {!isExpanded && toelichting && (
                                <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 line-clamp-1">{toelichting}</p>
                              )}
                            </div>
                          </button>
                          {isExpanded && hasDetails && (
                            <div className="px-3 pb-3 pt-0 space-y-2 border-t border-[var(--border)]/50 mt-0">
                              {toelichting && (
                                <div className="pt-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1">Toelichting</p>
                                  <p className="text-xs text-[var(--foreground)] leading-relaxed">{toelichting}</p>
                                </div>
                              )}
                              {brontekst && (
                                <div className="pt-1">
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1">Brontekst uit document</p>
                                  <div className="rounded-md bg-[var(--background)] border border-[var(--border)] p-2.5">
                                    <p className="text-xs text-[var(--foreground)] leading-relaxed italic whitespace-pre-wrap">"{brontekst}"</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {bijlageAnalysesList.length > 0 && (
                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-4">
                  <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-[var(--primary)]" />
                    Analyse per bijlage
                  </h3>
                  <p className="text-[11px] text-[var(--muted-foreground)] mb-3">
                    Op basis van alle gelezen documenten van de bron (o.a. TenderNed-tabbladen en Mercell waar van toepassing). Per bestand: samenvatting, punten, risico’s en een score.
                  </p>
                  <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                    {bijlageAnalysesList.map((b, idx) => (
                      <div key={`${b.naam}-${idx}`} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-left shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                          <p className="text-xs font-medium text-[var(--foreground)] break-words flex-1 min-w-0 leading-snug">
                            {b.naam}
                          </p>
                          <span
                            className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-full shrink-0 ${getScoreColor(b.score ?? 0)}`}
                            style={{
                              borderWidth: 1,
                              borderStyle: 'solid',
                              borderColor: (b.score ?? 0) >= 70 ? '#16a34a' : (b.score ?? 0) >= 40 ? '#ca8a04' : '#dc2626',
                            }}
                          >
                            {Math.round(b.score ?? 0)}/100
                          </span>
                        </div>
                        {b.bron && (
                          <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                            Bron: {b.bron}
                          </p>
                        )}
                        {b.samenvatting && (
                          <p className="text-xs text-[var(--foreground)] leading-relaxed whitespace-pre-wrap mb-2">
                            {b.samenvatting}
                          </p>
                        )}
                        {Array.isArray(b.belangrijkste_punten) && b.belangrijkste_punten.length > 0 && (
                          <ul className="text-[11px] list-disc pl-4 space-y-0.5 mb-2 text-[var(--muted-foreground)]">
                            {b.belangrijkste_punten.map((p, i) => (
                              <li key={i}>{p}</li>
                            ))}
                          </ul>
                        )}
                        {Array.isArray(b.risicos) && b.risicos.length > 0 && (
                          <p
                            className="text-[11px] mb-1 font-normal !text-red-600 dark:!text-red-400"
                            style={{ color: '#dc2626' }}
                          >
                            <span className="font-semibold" style={{ color: '#dc2626' }}>
                              Risico’s:{' '}
                            </span>
                            <span style={{ color: '#dc2626' }}>{b.risicos.join('; ')}</span>
                          </p>
                        )}
                        {b.uitleg_score && (
                          <p className="text-[11px] text-[var(--muted-foreground)] mt-2 pt-2 border-t border-[var(--border)] leading-relaxed whitespace-pre-wrap">
                            <span className="font-medium text-[var(--foreground)]">Uitleg score: </span>
                            {b.uitleg_score}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {t.match_uitleg && (
                <div className="mt-4 rounded-lg bg-[var(--muted)]/50 p-3">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-[var(--muted-foreground)] mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-[var(--muted-foreground)] whitespace-pre-wrap">{t.match_uitleg}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI Q&A — alle opgeslagen antwoorden, ook als de vraag intussen verwijderd of gewijzigd is */}
          {aiAntwoordEntries.length > 0 && (
            <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
              <h2 className="text-base font-semibold mb-4">Analyse — vragen en antwoorden</h2>
              <div className="space-y-4">
                {aiAntwoordEntries.map(({ qid, answer, vraag }) => (
                  <div key={qid} className="rounded-lg bg-[var(--muted)]/50 p-4">
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {vraag?.trim()
                        ? vraag
                        : 'Eerdere analyse (vraag staat niet meer in de lijst — antwoord wel bewaard)'}
                    </p>
                    <p className="mt-2 text-sm text-[var(--muted-foreground)] whitespace-pre-wrap">{answer}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {t.ai_samenvatting && (
            <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-[var(--primary)]" />
                <h2 className="text-base font-semibold">AI Samenvatting</h2>
              </div>
              <p className="text-xs text-[var(--muted-foreground)] mb-4">Synthese op basis van bronpagina, tabbladen en bijlagen.</p>
              <FormattedSamenvatting text={t.ai_samenvatting} />
            </div>
          )}

          {/* Description - rich formatted */}
          {t.beschrijving && (
            <div className="rounded-xl border bg-[var(--card)] shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-[var(--primary)]/5 to-transparent px-6 py-4 border-b border-[var(--border)]">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <FileText className="h-4.5 w-4.5 text-[var(--primary)]" />
                  Beschrijving aanbesteding
                </h2>
              </div>
              <div className="p-6">
                <FormattedDescription text={t.beschrijving} />
                {bronPageLinks.length > 0 && (
                  <div className="mt-8 border-t border-[var(--border)] pt-6 space-y-3">
                    <h3 className="text-sm font-semibold text-[var(--foreground)]">Gerelateerde links</h3>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      Links uit de bron (procedure, TenderNed, andere platforms). Bestanden staan in het documentenpaneel rechts.
                    </p>
                    <div className="space-y-3">
                      {bronPageLinks.map((link, i) => (
                        <div
                          key={`${link.url}-${i}`}
                          className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-4 py-3"
                        >
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--primary)] mb-1">
                            {link.categorie || 'Link'}
                          </p>
                          {link.titel ? (
                            <p className="text-sm font-medium text-[var(--foreground)] mb-1.5">{link.titel}</p>
                          ) : null}
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              if (isElectron && isFormulierBronNavLink(link)) {
                                e.preventDefault()
                                setBronPageEmbed({
                                  url: link.url,
                                  title: link.titel || link.categorie || 'Formulier',
                                })
                              }
                            }}
                            className="text-xs text-[var(--primary)] hover:underline break-all inline-flex items-center gap-1"
                          >
                            {link.url}
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="rounded-xl border bg-[var(--card)] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold">Notities</h2>
              {notitiesSaved && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Opgeslagen
                </span>
              )}
            </div>
            <textarea
              value={notities}
              onChange={handleNotitiesChange}
              placeholder="Voeg notities toe..."
              className="w-full rounded-lg border bg-[var(--background)] p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] min-h-[100px] resize-y"
            />
          </div>
          </div>

        {/* RIGHT COLUMN - Documenten */}
        <div className="z-10 flex w-72 shrink-0 flex-col overflow-hidden min-h-0 self-stretch">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-[var(--card)] shadow-sm">
            {/* Header */}
            <div className="shrink-0 bg-[var(--primary)] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-[var(--primary-foreground)] flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0" />
                    Documenten
                  </h3>
                  {(() => {
                    const sub = discoverStep
                      ? discoverStep
                      : (documenten.length + bronFileLinks.length) > 0
                        ? `${documenten.length + bronFileLinks.length} document(en)${bronFileLinks.length > 0 ? ` (incl. ${bronFileLinks.length} van bronpagina)` : ''}`
                        : null
                    return sub ? (
                      <p className="mt-0.5 text-[10px] leading-snug text-[var(--primary-foreground)]/70">{sub}</p>
                    ) : null
                  })()}
                </div>
                {t.bron_url ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={handleDiscoverDocuments}
                      disabled={discoveringDocs || globalAnalysisBusy || analyzing}
                      title="AI: opnieuw tracking van TenderNed/Mercell — tabbladen, links uit tekst, aanvullende documenten (configureer OpenAI of Claude onder Instellingen)"
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-white/20 px-2 text-[10px] font-semibold text-[var(--primary-foreground)] hover:bg-white/15 disabled:opacity-40 transition-colors"
                    >
                      {discoveringDocs ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      Zoeken
                    </button>
                    <button
                      type="button"
                      onClick={handleAnalyze}
                      disabled={analysisButtonDisabled}
                      title="Volledige AI-analyse opnieuw — leest alle bijlagen en herberekent score"
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-white/20 px-2 text-[10px] font-semibold text-[var(--primary-foreground)] hover:bg-white/15 disabled:opacity-40 transition-colors"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Analyse
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Search + filter: compact, één flex-wrap-rij (minder hoog = meer ruimte voor de lijst) */}
            <div className="shrink-0 space-y-1 border-b border-[var(--border)] bg-[var(--muted)]/10 px-2 py-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--muted-foreground)]" />
                <input
                  type="text"
                  value={docSearch}
                  onChange={(e) => setDocSearch(e.target.value)}
                  placeholder="Zoeken…"
                  className="h-7 w-full rounded border border-[var(--border)] bg-[var(--background)] py-1 pl-7 pr-6 text-[11px] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                />
                {docSearch && (
                  <button
                    type="button"
                    onClick={() => setDocSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    aria-label="Zoekopdracht wissen"
                  >
                    ×
                  </button>
                )}
              </div>
              {/* Row 1: Sort + Cat filters */}
              <div className="flex items-center gap-2">
                {/* Sort group */}
                <div className="flex items-center gap-1">
                  <span className="flex items-center gap-0.5 text-[var(--muted-foreground)]" title="Sorteren">
                    <ArrowUpDown className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="text-[9px] font-bold uppercase tracking-wide">Sort</span>
                  </span>
                  <div className="flex items-center rounded-md border border-[var(--border)] bg-[var(--muted)] p-0.5 gap-0.5">
                    <button
                      type="button"
                      onClick={() => { setDocSortBy('naam'); setDocTypeFilter(null) }}
                      className={`h-6 rounded px-2 text-[11px] font-semibold leading-none transition-colors ${
                        docSortBy === 'naam'
                          ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      Naam
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocSortBy('type')}
                      className={`h-6 max-w-[6rem] truncate rounded px-2 text-[11px] font-semibold leading-none transition-colors ${
                        docSortBy === 'type'
                          ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      Soort{docTypeFilter ? ` ${docTypeFilter}` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocSelectionFilter((f) => (f === 'selected' ? 'all' : 'selected'))}
                      title="Alleen aangevinkte documenten tonen"
                      className={`h-6 max-w-[7rem] truncate rounded px-2 text-[11px] font-semibold leading-none transition-colors ${
                        docSelectionFilter === 'selected'
                          ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      Geselecteerd{catalogSelectedKeysSet.size > 0 ? ` (${catalogSelectedKeysSet.size})` : ''}
                    </button>
                  </div>
                </div>

                <div className="h-4 w-px shrink-0 bg-[var(--border)]" aria-hidden />

                {/* Cat group */}
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">Cat</span>
                  <div className="flex items-center rounded-md border border-[var(--border)] bg-[var(--muted)] p-0.5 gap-0.5">
                    <button
                      type="button"
                      onClick={() => setDocCatalogWeergave('all')}
                      title="Alle catalogusdocumenten"
                      className={`h-6 rounded px-2 text-[11px] font-semibold leading-none transition-colors ${
                        docCatalogWeergave === 'all'
                          ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      Alles
                    </button>
                    {FEATURE_DOCUMENT_FORM_FILL ? (
                      <button
                        type="button"
                        onClick={() => setDocCatalogWeergave('invul')}
                        title="Alleen invuldocumenten (formulieren, offertes)"
                        className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-semibold leading-none transition-colors ${
                          docCatalogWeergave === 'invul'
                            ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                            : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                        }`}
                      >
                        <FileEdit className="h-3 w-3 shrink-0" aria-hidden />
                        Invul
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setDocCatalogWeergave('inlichting')}
                      title="Alleen inlichtingsdocumenten en links van de bronpagina"
                      className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-semibold leading-none transition-colors ${
                        docCatalogWeergave === 'inlichting'
                          ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      <FileText className="h-3 w-3 shrink-0" aria-hidden />
                      Inlichting
                    </button>
                  </div>
                </div>

                {/* Action buttons — pushed to the right */}
                <div className="ml-auto flex items-center gap-1.5">
                  {/* Knipperende filter-knop voor nieuwe documenten */}
                  {nieuweDocNamen.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setFilterNieuweDocs((f) => !f)}
                      title={filterNieuweDocs ? 'Filter opheffen — alle documenten tonen' : `${nieuweDocNamen.size} nieuwe document(en) — klik om te filteren`}
                      className={`relative inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px] font-semibold transition-colors ${
                        filterNieuweDocs
                          ? 'border-red-400 bg-red-500 text-white'
                          : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300'
                      }`}
                    >
                      {!filterNieuweDocs && (
                        <span className="absolute inset-0 rounded animate-ping bg-red-400 opacity-20 pointer-events-none" />
                      )}
                      <Zap className={`h-3 w-3 shrink-0 ${!filterNieuweDocs ? 'animate-pulse' : ''}`} aria-hidden />
                      Nieuw ({nieuweDocNamen.size})
                    </button>
                  )}
                  {isElectron && id ? (
                    <button
                      type="button"
                      onClick={() => void handleAddManualDocuments()}
                      disabled={manualDocAdding || discoveringDocs}
                      title="Kies bestand(en) op je computer; ze worden gekopieerd naar de interne tender-map en in deze lijst getoond."
                      className="inline-flex h-6 items-center gap-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-[11px] font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]/60 disabled:opacity-50"
                    >
                      {manualDocAdding ? (
                        <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                      ) : (
                        <Plus className="h-3 w-3 shrink-0" aria-hidden />
                      )}
                      bestand
                    </button>
                  ) : null}
                  {isElectron && id && catalogSelectedKeysSet.size > 0 ? (
                    <button
                      type="button"
                      onClick={() => void removeSelectedCatalogEntries([...catalogSelectedKeysSet])}
                      disabled={removeCatalogBusy}
                      className="inline-flex h-6 items-center gap-1 rounded border border-red-200 bg-red-50 px-2 text-[11px] font-semibold text-red-800 hover:bg-red-100 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60 disabled:opacity-50"
                    >
                      {removeCatalogBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                      ) : (
                        <Trash2 className="h-3 w-3 shrink-0" aria-hidden />
                      )}
                      Verwijder ({catalogSelectedKeysSet.size})
                    </button>
                  ) : null}
                </div>
              </div>
              {isElectron && id && manualUploadHint ? (
                <p className="text-[9px] leading-tight text-[var(--muted-foreground)]">{manualUploadHint}</p>
              ) : null}
              {/* Type chips — alleen zichtbaar als "Soort" actief is en er types zijn */}
              {docSortBy === 'type' && uniqueDocTypes.length > 0 && (
                <div className="flex flex-wrap gap-0.5">
                  <button
                    type="button"
                    onClick={() => setDocTypeFilter(null)}
                    className={`h-5 rounded px-1.5 text-[9px] font-medium leading-none transition-colors ${
                      !docTypeFilter
                        ? 'bg-[var(--foreground)] text-[var(--background)]'
                        : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]/70'
                    }`}
                  >
                    Alle
                  </button>
                  {uniqueDocTypes.map((ext) => (
                    <button
                      key={ext}
                      type="button"
                      onClick={() => setDocTypeFilter(docTypeFilter === ext ? null : ext)}
                      className={`h-5 rounded px-1.5 text-[9px] font-medium leading-none transition-colors ${
                        docTypeFilter === ext
                          ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                          : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]/70'
                      }`}
                    >
                      {ext}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 basis-0 overflow-y-auto overflow-x-hidden overscroll-y-contain scroll-smooth [scrollbar-gutter:stable]">
              {/* Catalogus-documenten (van document_urls), gegroepeerd: invuldocumenten / informatie */}
              {documenten.length > 0 && (
                <div>
                  {([
                    { label: 'Inlichtingsdocumenten', docs: informatieDocumenten, show: catalogShowsInlichting },
                    { label: 'Invuldocumenten', docs: invulDocumenten, show: catalogShowsInvul },
                  ] as const)
                    .filter((g) => g.show)
                    .map(({ label, docs }) =>
                    docs.length > 0 ? (                      <div key={label} className="border-b border-[var(--border)] last:border-b-0">
                        <p className="px-3 pt-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--foreground)] bg-[var(--muted)]/40 border-b border-[var(--border)]">
                          {label}
                        </p>
                        <div className="divide-y divide-[var(--border)]">
                          {docs.map((doc, i) => {
                            const fileName = doc.naam || `Document ${i + 1}`
                            const ext = (doc.type || fileName.split('.').pop() || '').toUpperCase()
                            const isLocal = Boolean(doc.localNaam?.trim())
                            const localSize = isLocal
                              ? localFiles.find((f) => f.naam === doc.localNaam)?.size ?? 0
                              : 0
                            const docKey = catalogDocumentStableKey(doc)
                            const isFill = docShowsInvulUi(doc)
                            const qualified = t.status === 'gekwalificeerd'
                            const canFill = qualified && isFill && isLocal

                            const isNieuwDoc = nieuweDocNamen.has(doc.naam)
                            return (
                              <div key={`${doc.localNaam || doc.url || i}-${i}`} className={`group relative ${isNieuwDoc ? 'bg-red-50/60 dark:bg-red-950/20' : ''}`}>
                                {isNieuwDoc && (
                                  <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-red-500 rounded-r" aria-hidden />
                                )}
                                <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1">
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center flex-wrap gap-1">
                                    {ext && <span className="inline-flex items-center rounded bg-[var(--muted)] px-1 py-0.5 text-[9px] font-bold">{ext}</span>}
                                    {isNieuwDoc && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700 dark:bg-red-900/40 dark:text-red-400">
                                        <Zap className="h-2.5 w-2.5 animate-pulse" aria-hidden />
                                        Nieuw
                                      </span>
                                    )}
                                    {doc.addedByUser ? (
                                      <span className="font-normal normal-case text-[9px] text-emerald-700 dark:text-emerald-400">eigen upload</span>
                                    ) : null}
                                    {isLocal && (
                                      <span className="font-normal normal-case text-[9px] text-[var(--primary)]">lokaal</span>
                                    )}
                                    {FEATURE_DOCUMENT_FORM_FILL && canFill && id && (
                                      <FillStatusBadge
                                        tenderId={id}
                                        documentNaam={doc.naam}
                                        refreshKey={fillRefreshKey}
                                        compact
                                        className="ml-1"
                                      />
                                    )}
                                  </p>
                                  {FEATURE_DOCUMENT_FORM_FILL && canFill && id && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        useAgentStore.getState().openWizard(id, doc.naam)
                                      }}
                                      className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
                                      title="Open invul-wizard"
                                    >
                                      <Sparkles className="h-3 w-3" /> Invullen
                                    </button>
                                  )}
                                </div>
                                <div className="flex items-start gap-2 px-3 pb-1">
                                  <input
                                    type="checkbox"
                                    checked={catalogSelectedKeysSet.has(docKey)}
                                    onChange={(e) => {
                                      e.stopPropagation()
                                      void toggleCatalogDocKey(docKey, e.target.checked)
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="mt-2 h-3.5 w-3.5 shrink-0 rounded border-[var(--border)] accent-[var(--primary)]"
                                    aria-label={`Selecteren (filter of verwijderen): ${fileName}`}
                                  />
                                  <button
                                    type="button"
                                    title={isLocal ? doc.localNaam : doc.url}
                                    onClick={() => {
                                      setBronPreview(null)
                                      if (isLocal && doc.localNaam) {
                                        void handleLocalFileClick({ naam: doc.localNaam, size: localSize })
                                      } else if (doc.url) {
                                        setLocalPreviewFile(null)
                                        setBronPreview({ url: doc.url, naam: fileName })
                                      }
                                    }}
                                    className="flex min-w-0 flex-1 items-start gap-3 py-0.5 text-left hover:bg-[var(--muted)]/50 transition-colors rounded-md"
                                  >
                                    <div className="mt-0.5 flex-shrink-0">{getFileIcon(fileName, doc.type)}</div>
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-xs font-medium leading-tight line-clamp-2 group-hover:text-[var(--primary)] transition-colors ${isNieuwDoc ? 'text-red-700 dark:text-red-400 font-semibold' : 'text-[var(--foreground)]'}`}>
                                        {fileName}
                                      </p>
                                      {doc.bronZipLabel && (
                                        <p className="text-[9px] text-[var(--muted-foreground)] mt-0.5 line-clamp-1">Uit: {doc.bronZipLabel}</p>
                                      )}
                                      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--primary)] opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Eye className="h-3 w-3" /> Openen
                                      </div>
                                    </div>
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              )}
              {documenten.length > 0 && docCatalogWeergave === 'invul' && invulDocumenten.length === 0 && (
                <p className="border-b border-[var(--border)] px-3 py-3 text-[10px] leading-snug text-[var(--muted-foreground)]">
                  Geen invuldocumenten herkend in deze selectie. Kies <strong>Alles</strong> of <strong>Inlichting</strong> om
                  alle bijlagen te zien.
                </p>
              )}
              {documenten.length > 0 && docCatalogWeergave === 'inlichting' && informatieDocumenten.length === 0 && showBronFilesInCatalog && filteredBronFileLinks.length === 0 && (
                <p className="border-b border-[var(--border)] px-3 py-3 text-[10px] leading-snug text-[var(--muted-foreground)]">
                  Geen inlichtingsdocumenten in de catalogus.{' '}
                  {FEATURE_DOCUMENT_FORM_FILL ? (
                    <>
                      Kies <strong>Alles</strong> of <strong>Invul</strong>, of bekijk bronlinks hieronder zodra die beschikbaar zijn.
                    </>
                  ) : (
                    <>
                      Kies <strong>Alles</strong> of bekijk bronlinks hieronder zodra die beschikbaar zijn.
                    </>
                  )}
                </p>
              )}

              {/* Bestandslinks gevonden in bronpagina (bronNavLinks met bestandsextensie) */}
              {showBronFilesInCatalog && filteredBronFileLinks.length > 0 && (
                <div className={documenten.length > 0 ? 'border-t border-[var(--border)]' : ''}>
                  <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Gevonden op bronpagina
                  </p>
                  <div className="divide-y divide-[var(--border)]">
                    {filteredBronFileLinks.map((link, i) => {
                      const fileName = link.titel || decodeURIComponent(link.url.split('/').pop()?.split('?')[0] || `Bestand ${i + 1}`)
                      const bKey = bronFileLinkStableKey(link.url)
                      return (
                        <div key={`bfl-${i}`} className="group">
                          <div className="flex w-full items-start gap-2 px-3 py-3">
                            <input
                              type="checkbox"
                              checked={catalogSelectedKeysSet.has(bKey)}
                              onChange={(e) => {
                                e.stopPropagation()
                                void toggleCatalogDocKey(bKey, e.target.checked)
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-[var(--border)] accent-[var(--primary)]"
                              aria-label={`Selecteren (filter of verwijderen): ${fileName}`}
                            />
                            <div className="mt-0.5 flex-shrink-0">{getFileIcon(fileName, link.url.toLowerCase().includes('.pdf') ? 'pdf' : undefined)}</div>
                            <div className="flex-1 min-w-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setLocalPreviewFile(null)
                                  setBronPreview({ url: link.url, naam: fileName })
                                }}
                                className="text-left w-full"
                              >
                                <p className="text-xs font-medium text-[var(--foreground)] leading-tight line-clamp-2 group-hover:text-[var(--primary)] transition-colors">
                                  {fileName}
                                </p>
                                {link.categorie && (
                                  <p className="text-[9px] text-[var(--muted-foreground)] mt-0.5">{link.categorie}</p>
                                )}
                                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--primary)] opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Eye className="h-3 w-3" /> Openen &amp; opslaan
                                </div>
                              </button>
                            </div>
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="Openen in browser"
                              className="flex-shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--primary)] transition-colors"
                            >
                              <Download className="h-4 w-4" />
                            </a>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Lege staat */}
              {documenten.length === 0 && bronFileLinks.length === 0 && !orphanLocalFiles.length && (
                <div className="px-4 py-8 text-center">
                  <File className="mx-auto h-8 w-8 text-[var(--muted-foreground)]/30" />
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">Nog geen documenten in de lijst</p>
                  <p className="mt-1 text-[10px] text-[var(--muted-foreground)]/60">
                    Start documenten zoeken of een AI-analyse om bijlagen te laden
                  </p>
                </div>
              )}
              {/* Geen zoekresultaten */}
              {(docSearch.trim() || docTypeFilter || docSelectionFilter === 'selected') &&
                visibleCatalogDocsCount === 0 &&
                (!showBronFilesInCatalog || filteredBronFileLinks.length === 0) &&
                (documenten.length > 0 || bronFileLinks.length > 0) && (
                <div className="px-4 py-6 text-center">
                  <Search className="mx-auto h-6 w-6 text-[var(--muted-foreground)]/30" />
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                    {docSelectionFilter === 'selected'
                      ? catalogSelectedKeysSet.size === 0
                        ? 'Geen documenten geselecteerd. Vink er een of meer aan, of zet «Geselecteerd» uit.'
                        : docTypeFilter
                          ? `Geen geselecteerde ${docTypeFilter}-documenten${docSearch.trim() ? ` voor "${docSearch}"` : ''}`
                          : docSearch.trim()
                            ? `Geen geselecteerde documenten voor "${docSearch}"`
                            : 'Geen geselecteerde documenten voldoen aan dit filter.'
                      : docTypeFilter
                        ? `Geen ${docTypeFilter}-documenten gevonden${docSearch.trim() ? ` voor "${docSearch}"` : ''}`
                        : `Geen documenten gevonden voor "${docSearch}"`}
                  </p>
                </div>
              )}

            </div>

            {/* Bronlink vast onder de catalogus (niet in de lijst-scroll) */}
            {t.bron_url && (
              <div className="shrink-0 border-t border-[var(--border)] px-3 py-3">
                <a
                  href={t.bron_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-[var(--primary)] hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Bekijk op {t.bron_website_naam || 'bron'}
                </a>
              </div>
            )}

            {orphanLocalFiles.length > 0 && (
              <div className="shrink-0 border-t border-[var(--border)] bg-[var(--muted)]/30">
                <button
                  type="button"
                  onClick={() => setLocalAnalysePanelOpen((o) => !o)}
                  aria-expanded={localAnalysePanelOpen}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[var(--muted)]/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      Overige lokale bestanden
                    </p>
                    <p className="text-[10px] text-[var(--muted-foreground)]/80">
                      {orphanLocalFiles.length} niet in documentlijst (o.a. oude ZIP’s)
                      {localOpenError ? ' · melding' : ''}
                    </p>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform ${localAnalysePanelOpen ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
                {localAnalysePanelOpen && (
                  <div className="border-t border-[var(--border)]/80 px-3 pb-3 pt-2">
                    <p className="text-[10px] text-[var(--muted-foreground)] mb-2 leading-snug">
                      Interne app-opslag — niet als gewone map geopend; wordt gewist bij verwijderen van deze aanbesteding.
                    </p>
                    {localOpenError && (
                      <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                        {localOpenError}
                      </div>
                    )}
                    <ul className="max-h-[min(42vh,20rem)] space-y-1 overflow-y-auto overflow-x-hidden overscroll-y-contain pr-1 scroll-smooth [scrollbar-gutter:stable]">
                      {orphanLocalFiles.map((f) => (
                        <li key={f.naam}>
                          <div className="flex items-center gap-1 rounded-lg border border-transparent hover:border-[var(--border)] hover:bg-[var(--background)]/80">
                            <button
                              type="button"
                              onClick={() => void handleLocalFileClick(f)}
                              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-xs text-[var(--foreground)] transition-colors"
                            >
                              {getFileIcon(f.naam)}
                              <span className="truncate font-medium" title={f.naam}>{f.naam}</span>
                              <span className="ml-auto flex-shrink-0 text-[10px] text-[var(--muted-foreground)]">
                                {formatBytes(f.size)}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => void handleQuickSaveLocalDoc(f, e)}
                              disabled={localDocSaving === f.naam}
                              className="flex-shrink-0 rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--primary)] disabled:opacity-50"
                              title="Download naar map naar keuze"
                              aria-label={`${f.naam} opslaan`}
                            >
                              {localDocSaving === f.naam ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                              ) : (
                                <Download className="h-5 w-5" />
                              )}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto space-y-6">
            {activeTab === 'risico' && (
              <RisicoTab
                aanbestedingId={id!}
                risicoAnalyseJson={t.risico_analyse}
                risicoAnalyseAt={t.risico_analyse_at}
                risicoAnalyseV2Json={t.risico_analyse_v2}
                risicoWachtrijPositie={risicoWachtrijPositie}
                onRefresh={refresh}
              />
            )}
            {activeTab === 'inschrijving' && (
              <InschrijvingTab
                tender={t}
                procedureContext={procedureContext}
                aiExtracted={aiExtracted}
                criteriaScores={criteriaScores}
                bronNavLinks={bronNavLinks}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
