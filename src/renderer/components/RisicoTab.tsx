import React, { useState, useEffect, useCallback, useRef } from 'react'
import { buildRoadmapSteps } from '../lib/risico-roadmap'
import type { RoadmapStep } from '../lib/risico-roadmap'
import {
  ShieldAlert, ShieldCheck, ShieldX, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, RefreshCw, Loader2, FileSearch,
  AlertCircle, Info, Scale, TrendingDown, Building2, Lock,
  Cpu, DollarSign, Gavel, Target, BookOpen, ClipboardList,
  MessageSquareWarning, HelpCircle, FileWarning, Play,
  Sparkles, MapPin, Layers, ListChecks, Shovel, Truck, Route,
  Calendar, BadgeAlert, FileText, CircleCheck, Network,
  HardHat, Banknote, Droplets, Construction, ShieldQuestion,
  FileCode, Eye, Navigation, ClipboardCheck, Milestone,
  Download,
  ArrowRight, Hash,
} from 'lucide-react'
import { api } from '../lib/ipc-client'
import { useAnalysisActiveStore } from '../stores/analysis-active-store'
import { useAgentStore } from '../stores/agent-store'
import type { RisicoAnalyseResult, RisicoGebied, RisicoItem, RisicoScore, InschrijfAdvies } from '../../shared/types'
import type { RisicoAnalyseV2Result, RisicoItemV2, RisicogebiedV2 } from '../../shared/types-risico-v2'
import {
  CitedSourceButton,
  LinkedCitationText,
  RisicoCitationModalLayer,
} from './risico-citation-links'

// ── HTML export ────────────────────────────────────────────────────────────────

/**
 * Zorgt dat geëxporteerde HTML alle klapsecties tonen (zelfde als volledig uitgeklapt scherm).
 */
function prepareRisicoExportClone(root: HTMLElement) {
  root.querySelectorAll('[data-risico-body]').forEach((el) => {
    el.classList.remove('hidden')
    ;(el as HTMLElement).style.removeProperty('display')
  })
  root.querySelectorAll('.risico-collapsed-preview').forEach((el) => el.remove())
}

/**
 * Bouwt een volledig zelfstandig HTML-document met alle CSS ingesloten.
 * De opmaak is identiek aan de app-weergave (Tailwind + CSS-variabelen).
 * Alle `data-risico-body` secties zijn interactief klapbaar via de `data-risico-toggle` knoppen;
 * bij openen is alles reeds uitgeklapt (carbon copy van de analysepagina).
 */
function buildRisicoHtml(reportEl: HTMLElement, title: string): string {
  // Collect all CSS rules from every stylesheet (compiled Tailwind + custom)
  const cssChunks: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        cssChunks.push(rule.cssText)
      }
    } catch {
      // Cross-origin sheets are blocked — skip
    }
  }
  const allCss = cssChunks.join('\n')

  // Clone the report element so we can strip interactive/print-hide elements
  const clone = reportEl.cloneNode(true) as HTMLElement
  // Remove print-hide elements (buttons, checkbox, TOC)
  clone.querySelectorAll('.risico-print-hide').forEach(el => el.remove())
  prepareRisicoExportClone(clone)

  const bodyHtml = clone.outerHTML

  // Inline interactive JS: makes data-risico-toggle buttons expand/collapse data-risico-body siblings
  const interactiveScript = `
(function() {
  function bodyIsHidden(body) {
    if (!body) return true;
    if (body.classList && body.classList.contains('hidden')) return true;
    if (body.style && body.style.display === 'none') return true;
    return false;
  }
  function setBodyHidden(body, hidden) {
    if (!body) return;
    if (hidden) {
      body.classList.add('hidden');
      body.style.display = 'none';
    } else {
      body.classList.remove('hidden');
      body.style.display = '';
    }
  }
  function initToggle() {
    document.querySelectorAll('[data-risico-toggle]').forEach(function(btn) {
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', function() {
        var parent = btn.parentElement;
        if (!parent) return;
        var body = parent.querySelector('[data-risico-body]');
        if (!body) return;
        var hidden = bodyIsHidden(body);
        setBodyHidden(body, !hidden);
        var svgs = btn.querySelectorAll('svg');
        if (svgs.length >= 2) {
          svgs[0].style.display = hidden ? 'none' : '';
          svgs[1].style.display = hidden ? '' : 'none';
        }
      });
    });
  }

  function expandAllForExport() {
    document.querySelectorAll('[data-risico-body]').forEach(function(el) {
      el.classList.remove('hidden');
      el.style.display = '';
    });
    document.querySelectorAll('.risico-collapsed-preview').forEach(function(el) { el.remove(); });
    document.querySelectorAll('[data-risico-toggle]').forEach(function(btn) {
      var svgs = btn.querySelectorAll('svg');
      if (svgs.length >= 2) {
        svgs[0].style.display = 'none';
        svgs[1].style.display = '';
      }
    });
  }

  // Expand-all / collapse-all toolbar
  function initToolbar() {
    var toolbar = document.getElementById('risico-html-toolbar');
    if (!toolbar) return;
    toolbar.querySelector('#btn-expand-all').addEventListener('click', function() {
      expandAllForExport();
    });
    toolbar.querySelector('#btn-collapse-all').addEventListener('click', function() {
      document.querySelectorAll('[data-risico-body]').forEach(function(el) {
        el.classList.add('hidden');
        el.style.display = 'none';
      });
      document.querySelectorAll('[data-risico-toggle]').forEach(function(btn) {
        var svgs = btn.querySelectorAll('svg');
        if (svgs.length >= 2) { svgs[0].style.display = ''; svgs[1].style.display = 'none'; }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      initToggle();
      initToolbar();
      expandAllForExport();
    });
  } else {
    initToggle();
    initToolbar();
    expandAllForExport();
  }
})();
`

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)}</title>
  <style>
    /* ── Reset ── */
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px 32px 48px;
      background: #f9fafb;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #0a0a14;
    }
    .risico-report { max-width: 960px; margin: 0 auto; }
    /* Ensure backgrounds print / display correctly */
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    /* Toolbar */
    #risico-html-toolbar {
      position: sticky; top: 0; z-index: 100;
      display: flex; align-items: center; gap: 8px;
      padding: 8px 0 10px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      margin-bottom: 16px;
    }
    #risico-html-toolbar button {
      padding: 5px 12px; border-radius: 8px; border: 1px solid #d1d5db;
      background: #fff; font-size: 12px; font-weight: 500; cursor: pointer;
      color: #374151; transition: background 0.15s;
    }
    #risico-html-toolbar button:hover { background: #f3f4f6; }
    @media print { #risico-html-toolbar { display: none !important; } }
    /* Scroll-ankers: ruimte boven sectiekoppen bij anchor-navigatie */
    [id^="s-"] { scroll-margin-top: 16px; }
    /* TOC anchor-links */
    #s-nav-toc a { text-decoration: none; }
    #s-nav-toc a:hover { text-decoration: underline; }
    /* ── Compiled Tailwind + custom CSS ── */
    ${allCss}
    /* ── Static export: volledig uitgeklopt overschrijft Tailwind .hidden ── */
    .risico-report [data-risico-body] { display: block !important; }
    .risico-report .risico-collapsed-preview { display: none !important; }
    #s-nav-toc { position: static !important; box-shadow: none !important; }
    .risico-report [class*="line-clamp"] {
      -webkit-line-clamp: unset !important;
      line-clamp: unset !important;
      overflow: visible !important;
      display: block !important;
      max-height: none !important;
    }
  </style>
</head>
<body>
  <div id="risico-html-toolbar">
    <span style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;">Weergave:</span>
    <button id="btn-expand-all">Alles uitklappen</button>
    <button id="btn-collapse-all">Alles inklappen</button>
  </div>
  ${bodyHtml}
  <footer style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;text-align:center;">
    Gegenereerd door TenderTracker &bull; ${new Date().toLocaleString('nl-NL')}
  </footer>
  <script>${interactiveScript}</script>
</body>
</html>`
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function scoreBadgeClass(score: RisicoScore | string): string {
  if (score === 'Hoog') return 'bg-red-100 text-red-700 border border-red-200'
  if (score === 'Middel') return 'bg-amber-100 text-amber-700 border border-amber-200'
  return 'bg-green-100 text-green-700 border border-green-200'
}

function scoreRingColor(score: RisicoScore | string): string {
  if (score === 'Hoog') return 'text-red-600'
  if (score === 'Middel') return 'text-amber-500'
  return 'text-green-600'
}

function scoreDot(score: RisicoScore | string): string {
  if (score === 'Hoog') return 'bg-red-500'
  if (score === 'Middel') return 'bg-amber-400'
  return 'bg-green-500'
}

function adviesBadge(advies: InschrijfAdvies | string): { label: string; cls: string } {
  switch (advies) {
    case 'inschrijfbaar': return { label: 'Inschrijfbaar', cls: 'bg-green-100 text-green-700 border border-green-200' }
    case 'inschrijfbaar_onder_voorwaarden': return { label: 'Inschrijfbaar onder voorwaarden', cls: 'bg-amber-100 text-amber-700 border border-amber-200' }
    case 'hoog_risico': return { label: 'Hoog risico', cls: 'bg-orange-100 text-orange-700 border border-orange-200' }
    case 'no_go': return { label: 'No-go — nader beoordelen', cls: 'bg-red-100 text-red-700 border border-red-200' }
    default: return { label: String(advies), cls: 'bg-gray-100 text-gray-700' }
  }
}

/** V2: tendervelden kunnen string of gekopieerde { waarde } zijn — nooit object in React children. */
function v2DisplayString(val: unknown): string {
  if (val == null || val === '') return ''
  if (typeof val === 'string') return val
  if (typeof val === 'object' && val !== null && 'waarde' in val) {
    const w = (val as { waarde?: unknown }).waarde
    return typeof w === 'string' ? w : ''
  }
  return ''
}

function v2DisplayTermijnen(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  return arr
    .map((t) => {
      if (typeof t === 'string') return t
      if (t && typeof t === 'object' && 'termijn' in (t as object)) {
        const o = t as { termijn?: string; datum?: string }
        return `${o.termijn ?? ''}: ${o.datum ?? ''}`.replace(/^\s*:\s*|:\s*$/g, '').trim()
      }
      return ''
    })
    .filter(Boolean)
}

function risicoTypeClass(type: string): string {
  switch (type) {
    case 'knock-out': return 'bg-red-50 text-red-700 border border-red-200'
    case 'juridisch': return 'bg-blue-50 text-blue-700 border border-blue-200'
    case 'commercieel': return 'bg-yellow-50 text-yellow-700 border border-yellow-200'
    case 'operationeel': return 'bg-purple-50 text-purple-700 border border-purple-200'
    case 'strategisch': return 'bg-indigo-50 text-indigo-700 border border-indigo-200'
    case 'bewijsrisico': return 'bg-gray-100 text-gray-700 border border-gray-200'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function gebiedIcon(naam: string): React.ReactNode {
  const n = naam.toLowerCase()
  if (n.includes('procedur') || n.includes('formeel')) return <ClipboardList className="h-4 w-4" />
  if (n.includes('uitsluit') || n.includes('geschikt') || n.includes('selectie')) return <Target className="h-4 w-4" />
  if (n.includes('transparant') || n.includes('proportional') || n.includes('gelijkheid')) return <Scale className="h-4 w-4" />
  if (n.includes('gunning') || n.includes('beoordeling')) return <Gavel className="h-4 w-4" />
  if (n.includes('contract') || n.includes('aansprak')) return <FileWarning className="h-4 w-4" />
  if (n.includes('financ') || n.includes('commerc')) return <DollarSign className="h-4 w-4" />
  if (n.includes('uitvoer') || n.includes('operatio')) return <Cpu className="h-4 w-4" />
  if (n.includes('privacy') || n.includes('informatie') || n.includes('beveiliging')) return <Lock className="h-4 w-4" />
  if (n.includes('intellectueel') || n.includes('eigendom')) return <BookOpen className="h-4 w-4" />
  if (n.includes('strateg') || n.includes('no-go')) return <TrendingDown className="h-4 w-4" />
  return <AlertCircle className="h-4 w-4" />
}

// ── Score ring ────────────────────────────────────────────────────────────────

function OverallScoreRing({ score }: { score: RisicoScore | string }) {
  const color = scoreRingColor(score)
  const pct = score === 'Hoog' ? 85 : score === 'Middel' ? 50 : 20
  const r = 36
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ

  return (
    <div className="relative flex h-24 w-24 flex-shrink-0 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-[var(--muted)]/40" />
        <circle
          cx="44" cy="44" r={r} fill="none" strokeWidth="7"
          stroke="currentColor" className={color}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="flex flex-col items-center">
        <span className={`text-lg font-bold ${color}`}>{score}</span>
      </div>
    </div>
  )
}

// ── Individual risico card ────────────────────────────────────────────────────

function RisicoCard({ item, index }: { item: RisicoItem; index: number }) {
  const [open, setOpen] = useState(false)
  const ernst = item.ernstscore

  return (
    <div className={`rounded-lg border transition-all ${ernst === 'Hoog' ? 'border-red-200 bg-red-50 dark:bg-red-950/25 dark:border-red-900/40' : ernst === 'Middel' ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/25 dark:border-amber-900/40' : 'border-[var(--border)] bg-[var(--card)]'}`}>
      <button
        onClick={() => setOpen(v => !v)}
        data-risico-toggle
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <span className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${ernst === 'Hoog' ? 'bg-red-100 text-red-700' : ernst === 'Middel' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {index + 1}
        </span>
        <div className="flex flex-1 flex-col gap-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--foreground)]">{item.titel}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${scoreBadgeClass(ernst)}`}>
              {ernst}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${risicoTypeClass(item.type)}`}>
              {item.type}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span className="text-xs text-[var(--muted-foreground)]">Kans: <span className={`font-semibold ${item.kans === 'Hoog' ? 'text-red-700' : item.kans === 'Middel' ? 'text-amber-700' : 'text-emerald-700'}`}>{item.kans}</span></span>
            <span className="text-xs text-[var(--muted-foreground)]">Impact: <span className={`font-semibold ${item.impact === 'Hoog' ? 'text-red-700' : item.impact === 'Middel' ? 'text-amber-700' : 'text-emerald-700'}`}>{item.impact}</span></span>
          </div>
          {!open && item.feit && (
            <p className="risico-collapsed-preview text-xs text-[var(--muted-foreground)] line-clamp-2 italic">
              <LinkedCitationText text={item.feit} />
            </p>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)] mt-1" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)] mt-1" />}
      </button>

      <div
        data-risico-body
        className={`border-t border-[var(--border)] px-4 pb-4 pt-3 space-y-3 ${!open ? 'hidden' : ''}`}
      >
          <DetailRow label="Feit uit stukken" icon={<Info className="h-3.5 w-3.5" />} value={item.feit} />
          <DetailRow label="Bron" icon={<BookOpen className="h-3.5 w-3.5" />} value={item.bron} />
          {item.juridische_duiding && item.juridische_duiding !== 'n.v.t.' && item.juridische_duiding !== 'Niet van toepassing' && (
            <DetailRow label="Juridische duiding" icon={<Scale className="h-3.5 w-3.5" />} value={item.juridische_duiding} highlight />
          )}
          {item.consequenties && item.consequenties !== 'n.v.t.' && (
            <DetailRow label="Consequenties (uit stukken)" icon={<Info className="h-3.5 w-3.5" />} value={item.consequenties} />
          )}
          <DetailRow label="Waarom een risico" icon={<AlertTriangle className="h-3.5 w-3.5" />} value={item.waarom_risico} />
          {item.verificatie && item.verificatie !== 'n.v.t.' && (
            <DetailRow label="Benodigde verificatie" icon={<HelpCircle className="h-3.5 w-3.5" />} value={item.verificatie} />
          )}
          <DetailRow label="Aanbevolen actie" icon={<CheckCircle2 className="h-3.5 w-3.5" />} value={item.actie} action />
      </div>
    </div>
  )
}

function DetailRow({ label, icon, value, highlight, action }: {
  label: string; icon: React.ReactNode; value: string; highlight?: boolean; action?: boolean
}) {
  if (!value || value.trim() === '') return null
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${highlight ? 'text-blue-700 dark:text-blue-400' : action ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--muted-foreground)]'}`}>
        {icon}
        {label}
      </div>
      <p className={`text-sm leading-relaxed pl-5 ${highlight ? 'text-blue-900 dark:text-blue-200' : action ? 'text-emerald-800 dark:text-emerald-300 font-medium' : 'text-[var(--foreground)]'}`}>
        <LinkedCitationText text={value} />
      </p>
    </div>
  )
}

// ── Risicogebied section ──────────────────────────────────────────────────────

function GebiedSection({ gebied }: { gebied: RisicoGebied }) {
  const [collapsed, setCollapsed] = useState(false)
  const hoogCount = gebied.risicos.filter(r => r.ernstscore === 'Hoog').length
  const middelCount = gebied.risicos.filter(r => r.ernstscore === 'Middel').length
  const laagCount = gebied.risicos.filter(r => r.ernstscore === 'Laag').length

  return (
    <div className="rounded-xl border bg-[var(--card)] shadow-sm overflow-hidden">
      <button
        onClick={() => setCollapsed(v => !v)}
        data-risico-toggle
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-[var(--muted)]/30 transition-colors"
      >
        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${gebied.score === 'Hoog' ? 'bg-red-100 text-red-700' : gebied.score === 'Middel' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {gebiedIcon(gebied.naam)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--foreground)]">{gebied.naam}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${scoreBadgeClass(gebied.score)}`}>
              {gebied.score}
            </span>
            <div className="flex items-center gap-1.5">
              {hoogCount > 0 && <span className="flex items-center gap-0.5 text-[10px] text-red-700 font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block" />{hoogCount} hoog</span>}
              {middelCount > 0 && <span className="flex items-center gap-0.5 text-[10px] text-amber-700 font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />{middelCount} middel</span>}
              {laagCount > 0 && <span className="flex items-center gap-0.5 text-[10px] text-emerald-700 font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />{laagCount} laag</span>}
            </div>
          </div>
          {gebied.score_toelichting && collapsed && (
            <p className="risico-collapsed-preview mt-0.5 text-xs text-[var(--muted-foreground)] line-clamp-1">
              <LinkedCitationText text={gebied.score_toelichting} />
            </p>
          )}
        </div>
        {collapsed ? <ChevronDown className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" /> : <ChevronUp className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />}
      </button>

      <div
        data-risico-body
        className={`border-t border-[var(--border)] p-4 space-y-3 ${collapsed ? 'hidden' : ''}`}
      >
          {gebied.score_toelichting && (
            <p className="text-sm text-[var(--muted-foreground)] italic border-l-2 border-[var(--border)] pl-3">
              <LinkedCitationText text={gebied.score_toelichting} />
            </p>
          )}
          {gebied.risicos.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">Geen risico's geïdentificeerd in dit gebied.</p>
          ) : (
            <div className="space-y-2">
              {gebied.risicos.map((item, idx) => (
                <RisicoCard key={idx} item={item} index={idx} />
              ))}
            </div>
          )}
      </div>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ step, percentage, agent }: { step: string; percentage: number; agent?: string }) {
  return (
    <div className="rounded-xl border bg-[var(--card)] p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--primary)]" />
        <span className="text-sm font-medium text-[var(--foreground)]">Risico-analyse bezig…</span>
        {agent?.trim() ? (
          <span className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)]">
            {agent.trim()}
          </span>
        ) : null}
      </div>
      <div className="h-2 w-full rounded-full bg-[var(--muted)]">
        <div
          className="h-2 rounded-full bg-[var(--primary)] transition-all duration-500"
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{step}</p>
    </div>
  )
}

// ── V2 Renderer ──────────────────────────────────────────────────────────────

function V2ScoreBadge({ score }: { score: string }) {
  const cls = score === 'Hoog'
    ? 'bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-300'
    : score === 'Middel'
    ? 'bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300'
    : 'bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-300'
  return <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>{score}</span>
}

function V2AdvieBadge({ advies }: { advies: string | Record<string, unknown> }) {
  // Defensief: als het model een object stuurde i.p.v. een string, extraheer de advies-sleutel
  const adviesStr = typeof advies === 'object' && advies !== null
    ? (advies.advies as string) ?? 'hoog_risico'
    : String(advies ?? 'hoog_risico')

  const map: Record<string, { label: string; cls: string }> = {
    inschrijfbaar: { label: '✓ Inschrijfbaar', cls: 'bg-green-100 text-green-800 border border-green-300' },
    inschrijfbaar_onder_voorwaarden: { label: '⚠ Onder voorwaarden', cls: 'bg-amber-100 text-amber-800 border border-amber-300' },
    hoog_risico: { label: '⚠ Hoog risico', cls: 'bg-orange-100 text-orange-800 border border-orange-300' },
    no_go: { label: '✕ No-go', cls: 'bg-red-100 text-red-800 border border-red-300' },
  }
  const b = map[adviesStr] ?? { label: adviesStr, cls: 'bg-gray-100 text-gray-700 border border-gray-200' }
  return <span className={`rounded-lg px-3 py-1 text-xs font-semibold ${b.cls}`}>{b.label}</span>
}

function V2SectionHeader({ icon, title, count, score, accent = 'gray' }: {
  icon: React.ReactNode; title: string; count?: number; score?: string; accent?: string
}) {
  const accentMap: Record<string, string> = {
    blue:    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    red:     'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    amber:   'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    purple:  'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    indigo:  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    cyan:    'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
    rose:    'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    gray:    'bg-[var(--muted)] text-[var(--muted-foreground)]',
  }
  return (
    <div className="flex items-center gap-2.5">
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${accentMap[accent] ?? accentMap.gray}`}>{icon}</div>
      <div className="flex flex-1 items-center gap-2 min-w-0">
        <h3 className="text-sm font-bold text-[var(--foreground)] truncate">{title}</h3>
        {count !== undefined && <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">{count}</span>}
        {score && <V2ScoreBadge score={score} />}
      </div>
    </div>
  )
}

// ── Inhoudsopgave ─────────────────────────────────────────────────────────────

interface TocItem {
  id: string; label: string; icon: React.ReactNode; count?: number; accent: string; show: boolean
}

function RisicoTOC({ items }: { items: TocItem[] }) {
  const visible = items.filter(i => i.show)
  if (visible.length === 0) return null
  const accentPill: Record<string, string> = {
    blue:    'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/20 dark:border-blue-800/40 dark:text-blue-300',
    red:     'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/20 dark:border-red-800/40 dark:text-red-300',
    amber:   'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/20 dark:border-amber-800/40 dark:text-amber-300',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-800/40 dark:text-emerald-300',
    purple:  'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/20 dark:border-purple-800/40 dark:text-purple-300',
    indigo:  'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/20 dark:border-indigo-800/40 dark:text-indigo-300',
    cyan:    'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:bg-cyan-950/20 dark:border-cyan-800/40 dark:text-cyan-300',
    rose:    'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/20 dark:border-rose-800/40 dark:text-rose-300',
    gray:    'border-[var(--border)] bg-[var(--muted)]/50 text-[var(--foreground)] hover:bg-[var(--muted)]',
  }
  return (
    <div className="border-t border-[var(--border)] pt-3 risico-print-hide">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-2">Inhoudsopgave</p>
      <div className="flex flex-wrap gap-1.5">
        {visible.map(item => (
          <button
            key={item.id}
            onClick={() => {
              const el = document.getElementById(item.id)
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${accentPill[item.accent] ?? accentPill.gray}`}
          >
            <span className="h-3.5 w-3.5 flex-shrink-0">{item.icon}</span>
            {item.label}
            {item.count != null && (
              <span className="rounded-full bg-white/60 dark:bg-black/20 px-1.5 py-0.5 text-[10px] font-bold leading-none">{item.count}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function V2Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm overflow-hidden ${className}`}>{children}</div>
}

function scoreTextColor(score: string): string {
  if (score === 'Hoog') return 'text-red-700'
  if (score === 'Middel') return 'text-amber-700'
  return 'text-emerald-700'
}

function V2RisicoItemCard({ item, index, expandAll }: { item: RisicoItemV2; index: number; expandAll?: boolean }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (expandAll !== undefined) setOpen(expandAll)
  }, [expandAll])

  const ernst = item.ernstscore
  const bgCls = ernst === 'Hoog'
    ? 'border-red-200 bg-red-50 dark:bg-red-950/25 dark:border-red-900/40'
    : ernst === 'Middel'
    ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/25 dark:border-amber-900/40'
    : 'border-[var(--border)] bg-[var(--card)]'

  return (
    <div className={`rounded-lg border transition-all ${bgCls}`}>
      <button onClick={() => setOpen(v => !v)} data-risico-toggle className="flex w-full items-start gap-3 p-3.5 text-left">
        <span className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${ernst === 'Hoog' ? 'bg-red-100 text-red-700' : ernst === 'Middel' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {index + 1}
        </span>
        <div className="flex flex-1 flex-col gap-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--foreground)]">{item.titel}</span>
            <V2ScoreBadge score={ernst} />
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--muted)] text-[var(--muted-foreground)]">{item.type}</span>
            {item.vraag_nvi_nodig && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/20 dark:text-blue-300 dark:border-blue-800/40">NVI nodig</span>}
            {(item.status_van_onderbouwing === 'niet vast te stellen op basis van de stukken' || item.status_van_onderbouwing === 'conflicterend in stukken') && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/20 dark:text-amber-300 dark:border-amber-800/40">
                {item.status_van_onderbouwing === 'conflicterend in stukken' ? 'Conflicterend' : 'Niet uit stukken'}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span className="text-xs text-[var(--muted-foreground)]">Kans: <span className={`font-semibold ${scoreTextColor(item.kans)}`}>{item.kans}</span></span>
            <span className="text-xs text-[var(--muted-foreground)]">Impact: <span className={`font-semibold ${scoreTextColor(item.impact)}`}>{item.impact}</span></span>
            <span className="text-xs text-[var(--muted-foreground)]">Prijs: <span className={`font-semibold ${scoreTextColor(item.mogelijke_prijsimpact)}`}>{item.mogelijke_prijsimpact}</span></span>
            <span className="text-xs text-[var(--muted-foreground)]">Planning: <span className={`font-semibold ${scoreTextColor(item.mogelijke_planningsimpact)}`}>{item.mogelijke_planningsimpact}</span></span>
          </div>
          {!open && (
            <div className="risico-collapsed-preview space-y-0.5">
              {item.feit && <p className="text-xs text-[var(--muted-foreground)] line-clamp-2 italic">{item.feit}</p>}
              {item.bron && <p className="text-[10px] text-[var(--muted-foreground)] truncate"><span className="font-semibold">Bron:</span> {item.bron}</p>}
              {(item.status_van_onderbouwing === 'niet vast te stellen op basis van de stukken' || item.status_van_onderbouwing === 'conflicterend in stukken') && (
                <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                  Niet uit de stukken af te leiden: {item.titel}{item.verificatie ? ` — verificatie: ${item.verificatie.slice(0, 80)}` : ''}
                </p>
              )}
            </div>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)] mt-1" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)] mt-1" />}
      </button>
      <div
        data-risico-body
        className={`border-t border-[var(--border)] px-4 pb-4 pt-3 space-y-3 ${!open ? 'hidden' : ''}`}
      >
          {/* Bewijs-keten: Feit → Bron → Status onderbouwing → duiding → redenering → impacts → actie/NVI */}
          {item.feit && <DetailRow label="Feit uit stukken" icon={<Info className="h-3.5 w-3.5" />} value={item.feit} />}
          {item.bron && <DetailRow label="Bron" icon={<BookOpen className="h-3.5 w-3.5" />} value={item.bron} />}
          {item.status_van_onderbouwing && (
            <>
              <DetailRow label="Status onderbouwing" icon={<ShieldQuestion className="h-3.5 w-3.5" />} value={item.status_van_onderbouwing} />
              {(item.status_van_onderbouwing === 'niet vast te stellen op basis van de stukken' || item.status_van_onderbouwing === 'conflicterend in stukken') && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800/40 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    Niet uit de stukken af te leiden: <span className="font-bold">{item.titel}</span>
                  </p>
                  {item.verificatie && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">Vereiste verificatie: {item.verificatie}</p>}
                  {item.conceptvraag_nvi && <p className="mt-0.5 text-xs text-blue-700 dark:text-blue-300 italic">Stel via NVI: {item.conceptvraag_nvi}</p>}
                </div>
              )}
            </>
          )}
          {item.juridische_duiding && <DetailRow label="Juridische duiding" icon={<Scale className="h-3.5 w-3.5" />} value={item.juridische_duiding} highlight />}
          {item.professionele_duiding && <DetailRow label="Professionele duiding" icon={<HardHat className="h-3.5 w-3.5" />} value={item.professionele_duiding} />}
          {item.waarom_risico && <DetailRow label="Waarom een risico" icon={<AlertTriangle className="h-3.5 w-3.5" />} value={item.waarom_risico} />}
          {item.prijsimpact_toelichting && <DetailRow label="Prijsimpact" icon={<Banknote className="h-3.5 w-3.5" />} value={item.prijsimpact_toelichting} />}
          {item.planningsimpact_toelichting && <DetailRow label="Planningsimpact" icon={<Calendar className="h-3.5 w-3.5" />} value={item.planningsimpact_toelichting} />}
          {item.verificatie && !(item.status_van_onderbouwing === 'niet vast te stellen op basis van de stukken' || item.status_van_onderbouwing === 'conflicterend in stukken') && (
            <DetailRow label="Verificatie" icon={<HelpCircle className="h-3.5 w-3.5" />} value={item.verificatie} />
          )}
          {item.actie && <DetailRow label="Aanbevolen actie" icon={<CheckCircle2 className="h-3.5 w-3.5" />} value={item.actie} action />}
          {item.vraag_nvi_nodig && item.conceptvraag_nvi && !(item.status_van_onderbouwing === 'niet vast te stellen op basis van de stukken' || item.status_van_onderbouwing === 'conflicterend in stukken') && (
            <DetailRow label="Concept NVI-vraag" icon={<MessageSquareWarning className="h-3.5 w-3.5" />} value={item.conceptvraag_nvi} />
          )}
      </div>
    </div>
  )
}

function V2GebiedSection({ gebied, expandAll }: { gebied: RisicogebiedV2; expandAll?: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const hoogCount = gebied.risicos.filter(r => r.ernstscore === 'Hoog').length
  const middelCount = gebied.risicos.filter(r => r.ernstscore === 'Middel').length
  const laagCount = gebied.risicos.filter(r => r.ernstscore === 'Laag').length

  useEffect(() => {
    if (expandAll !== undefined) setCollapsed(!expandAll)
  }, [expandAll])

  const headerBg = gebied.score === 'Hoog'
    ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    : gebied.score === 'Middel'
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'

  return (
    <V2Card>
      <button onClick={() => setCollapsed(v => !v)} data-risico-toggle className="flex w-full items-center gap-3 p-4 text-left hover:bg-[var(--muted)]/30 transition-colors">
        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${headerBg}`}>
          {gebiedIcon(gebied.naam)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--foreground)]">{gebied.naam}</span>
            <V2ScoreBadge score={gebied.score} />
            <div className="flex items-center gap-2">
              {hoogCount > 0 && <span className="text-[10px] text-red-700 font-semibold dark:text-red-300">{hoogCount}×H</span>}
              {middelCount > 0 && <span className="text-[10px] text-amber-700 font-semibold dark:text-amber-300">{middelCount}×M</span>}
              {laagCount > 0 && <span className="text-[10px] text-emerald-700 font-semibold dark:text-emerald-300">{laagCount}×L</span>}
            </div>
          </div>
          {gebied.score_toelichting && collapsed && (
            <p className="risico-collapsed-preview mt-0.5 text-xs text-[var(--muted-foreground)] line-clamp-1">{gebied.score_toelichting}</p>
          )}
        </div>
        {collapsed ? <ChevronDown className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" /> : <ChevronUp className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />}
      </button>
      <div
        data-risico-body
        className={`border-t border-[var(--border)] p-4 space-y-2.5 ${collapsed ? 'hidden' : ''}`}
      >
          {gebied.score_toelichting && (
            <p className="text-sm text-[var(--muted-foreground)] italic border-l-2 border-[var(--border)] pl-3">{gebied.score_toelichting}</p>
          )}
          {gebied.risicos.length === 0
            ? <p className="text-sm text-[var(--muted-foreground)]">Geen risico's in dit gebied.</p>
            : gebied.risicos.map((item, idx) => <V2RisicoItemCard key={idx} item={item} index={idx} expandAll={expandAll} />)
          }
      </div>
    </V2Card>
  )
}

// ── Roadmap timeline component ────────────────────────────────────────────────

function RoadmapTimeline({ result }: { result: RisicoAnalyseV2Result }) {
  const steps = buildRoadmapSteps(result)

  const prioriteitCls = (p: RoadmapStep['prioriteit']) => {
    if (p === 'kritiek') return { dot: 'bg-red-500', line: 'border-red-300 dark:border-red-700/60', badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800/40', label: 'Kritiek' }
    if (p === 'hoog') return { dot: 'bg-amber-500', line: 'border-amber-300 dark:border-amber-700/60', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800/40', label: 'Hoog' }
    return { dot: 'bg-blue-400', line: 'border-blue-200 dark:border-blue-800/40', badge: 'bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-300 border-blue-200 dark:border-blue-800/40', label: 'Normaal' }
  }

  return (
    <div className="relative pl-6">
      {/* Verticale lijn */}
      <div className="absolute left-2.5 top-0 bottom-0 w-px bg-[var(--border)]" />

      <div className="space-y-6">
        {steps.map((step, i) => {
          const cls = prioriteitCls(step.prioriteit)
          const isLast = i === steps.length - 1
          return (
            <div key={step.id} className="relative">
              {/* Dot op de tijdlijn */}
              <div className={`absolute -left-6 top-1 h-4 w-4 rounded-full border-2 border-[var(--card)] ${cls.dot} flex items-center justify-center`}>
                <span className="text-[8px] font-bold text-white">{i + 1}</span>
              </div>

              <div className={`rounded-xl border p-4 space-y-2 ${isLast ? `border-2 ${cls.line}` : 'border border-[var(--border)]'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-[var(--foreground)]">{step.titel}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls.badge}`}>{cls.label}</span>
                  {step.datum && (
                    <span className="flex items-center gap-1 rounded-full bg-[var(--muted)] border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                      <Calendar className="h-2.5 w-2.5" />{step.datum}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{step.beschrijving}</p>
                {step.items.length > 0 && (
                  <ul className="space-y-1 pt-1">
                    {step.items.map((item, j) => (
                      <li key={j} className="flex items-start gap-1.5 text-xs text-[var(--foreground)]">
                        <ArrowRight className="h-3 w-3 flex-shrink-0 mt-0.5 text-[var(--muted-foreground)]" />{item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── V2 Renderer props ─────────────────────────────────────────────────────────

interface V2RendererProps {
  result: RisicoAnalyseV2Result
  analyzing: boolean
  risicoBusy: boolean
  inRisicoWachtrij: boolean
  risicoWachtrijPositie: number | null
  displayStep: string
  displayPct: number
  displayAgent: string
  error: string | null
  handleAnalyse: () => void
  liveDraftStage?: string
  liveDraftAt?: string
}

function RisicoV2Renderer({
  result, analyzing, risicoBusy, inRisicoWachtrij, risicoWachtrijPositie,
  displayStep, displayPct, displayAgent, error, handleAnalyse,
  liveDraftStage, liveDraftAt,
}: V2RendererProps) {
  const [expandAll, setExpandAll] = useState(false)
  const [htmlSaving, setHtmlSaving] = useState(false)
  const [pdfSaving, setPdfSaving] = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)
  const exportPending = useRef<'html' | 'pdf' | null>(null)
  const prevExpandAll = useRef(false)

  // After React re-renders with all items expanded, capture the HTML / PDF (zelfde DOM + CSS als HTML-export)
  useEffect(() => {
    if (!exportPending.current) return
    const kind = exportPending.current
    exportPending.current = null

    const el = reportRef.current
    if (!el) {
      setExpandAll(prevExpandAll.current)
      setHtmlSaving(false)
      setPdfSaving(false)
      return
    }

    const dienst = result.algemene_tenderanalyse?.aanbestedende_dienst
    const title = `Risico-inventarisatie${dienst ? ` — ${dienst}` : ''}`
    const html = buildRisicoHtml(el, title)
    const base = `risico-inventarisatie-${new Date().toISOString().slice(0, 10)}`

    setExpandAll(prevExpandAll.current)

    const doneHtml = () => setHtmlSaving(false)
    const donePdf = () => setPdfSaving(false)
    if (kind === 'html') {
      void api.saveRisicoHtml(html, `${base}.html`).finally(doneHtml)
    } else {
      void api
        .saveRisicoPdf(html, `${base}.pdf`)
        .then((res) => {
          if (!res.success && !res.cancelled && res.error) {
            window.alert(`PDF opslaan mislukt: ${res.error}`)
          }
        })
        .finally(donePdf)
    }
  })

  const handleSaveHtml = useCallback(() => {
    prevExpandAll.current = expandAll
    exportPending.current = 'html'
    setHtmlSaving(true)
    setExpandAll(true)
  }, [expandAll])

  const handleSavePdf = useCallback(() => {
    prevExpandAll.current = expandAll
    exportPending.current = 'pdf'
    setPdfSaving(true)
    setExpandAll(true)
  }, [expandAll])

  const tocItems: TocItem[] = [
    { id: 's-samenvatting',       label: 'Samenvatting',           icon: <ShieldAlert className="h-3.5 w-3.5" />,          accent: 'indigo',  show: true },
    { id: 's-tenderoverzicht',    label: 'Tenderoverzicht',        icon: <Building2 className="h-3.5 w-3.5" />,            accent: 'blue',    show: Boolean(result.algemene_tenderanalyse) },
    { id: 's-documenten',         label: 'Documenten',             icon: <FileText className="h-3.5 w-3.5" />,             accent: 'cyan',    show: (result.document_inventarisatie?.length ?? 0) > 0, count: result.document_inventarisatie?.length },
    { id: 's-leesplicht',         label: 'Documentvolledigheid',   icon: <ClipboardCheck className="h-3.5 w-3.5" />,       accent: 'cyan',    show: Boolean(result.document_leesplicht_bevestiging) },
    { id: 's-bewijs',             label: 'Bewijs & aannames',      icon: <Scale className="h-3.5 w-3.5" />,               accent: 'gray',    show: Boolean(result.bewijs_en_aannameregel) },
    { id: 's-locatie',            label: 'Locatie & omgeving',     icon: <Navigation className="h-3.5 w-3.5" />,           accent: 'teal',    show: Boolean(result.locatie_en_omgevingsanalyse) },
    { id: 's-top5',               label: "Top 5 risico's",         icon: <BadgeAlert className="h-3.5 w-3.5" />,           accent: 'red',     show: (result.top5_risicos?.length ?? 0) > 0, count: result.top5_risicos?.length },
    { id: 's-prijs-planning',     label: 'Prijs & planning',       icon: <Banknote className="h-3.5 w-3.5" />,             accent: 'amber',   show: (result.top5_prijsverhogende_risicofactoren?.length ?? 0) > 0 || (result.top5_planningsrisicos?.length ?? 0) > 0 },
    { id: 's-risicogebieden',     label: 'Risicogebieden',         icon: <Layers className="h-3.5 w-3.5" />,              accent: 'purple',  show: (result.risicogebieden?.length ?? 0) > 0, count: result.risicogebieden?.length },
    { id: 's-tegenstrijdigheden', label: 'Tegenstrijdigheden',     icon: <AlertTriangle className="h-3.5 w-3.5" />,        accent: 'amber',   show: (result.tegenstrijdigheden?.length ?? 0) > 0, count: result.tegenstrijdigheden?.length },
    { id: 's-leemtes',            label: 'Leemtes',                icon: <HelpCircle className="h-3.5 w-3.5" />,           accent: 'gray',    show: (result.leemtes?.length ?? 0) > 0, count: result.leemtes?.length },
    { id: 's-nogo',               label: 'No-go',                  icon: <ShieldX className="h-3.5 w-3.5" />,              accent: 'red',     show: (result.no_go_factoren?.length ?? 0) > 0, count: result.no_go_factoren?.length },
    { id: 's-openpunten',         label: 'Open punten / NVI',      icon: <MessageSquareWarning className="h-3.5 w-3.5" />, accent: 'blue',    show: (result.vragen_nvi?.length ?? 0) > 0 || (result.leemtes?.some(l => l.vraag_nvi) ?? false) },
    { id: 's-nvi',                label: 'NVI-vragen (volledig)',  icon: <MessageSquareWarning className="h-3.5 w-3.5" />, accent: 'blue',    show: (result.vragen_nvi?.length ?? 0) > 0, count: result.vragen_nvi?.length },
    { id: 's-strategie',          label: 'Inschrijfstrategie',     icon: <Target className="h-3.5 w-3.5" />,              accent: 'emerald', show: Boolean(result.inschrijfstrategie) },
    { id: 's-overzicht',          label: 'Gebiedoverzicht',        icon: <ListChecks className="h-3.5 w-3.5" />,           accent: 'purple',  show: (result.risicogebieden?.length ?? 0) > 0 },
    { id: 's-gatekeeper',         label: 'Gatekeeper',             icon: <ShieldCheck className="h-3.5 w-3.5" />,          accent: 'emerald', show: Boolean(result.gatekeeper_resultaat) },
    { id: 's-conclusie',          label: 'Slotconclusie',          icon: <Milestone className="h-3.5 w-3.5" />,            accent: 'indigo',  show: true },
  ]

  // Computed NVI open punten (union van vragen_nvi, leemtes met vraag, items met conceptvraag)
  const openPunten = (() => {
    type OpenPunt = { formulering: string; bron?: string; categorie?: string; prioriteit: 'hoog' | 'middel' | 'laag'; risicoPrijs?: string; risicoPlanning?: string; risico?: string }
    const items: OpenPunt[] = []
    for (const v of result.vragen_nvi ?? []) {
      items.push({ formulering: v.formulering, bron: v.bron, categorie: v.categorie, prioriteit: 'middel', risicoPrijs: v.waarom_belangrijk_voor_aanneemsom, risicoPlanning: v.waarom_belangrijk_voor_planning, risico: v.waarom_belangrijk_voor_risico })
    }
    for (const l of result.leemtes ?? []) {
      if (l.vraag_nvi) {
        items.push({ formulering: l.vraag_nvi, categorie: 'leemte', prioriteit: 'hoog', risico: l.risico_voor_inschrijver })
      }
    }
    for (const g of result.risicogebieden ?? []) {
      for (const r of g.risicos ?? []) {
        if (r.vraag_nvi_nodig && r.conceptvraag_nvi && !items.find(i => i.formulering === r.conceptvraag_nvi)) {
          items.push({ formulering: r.conceptvraag_nvi, categorie: r.type, prioriteit: r.ernstscore === 'Hoog' ? 'hoog' : r.ernstscore === 'Middel' ? 'middel' : 'laag', risico: r.waarom_risico })
        }
      }
    }
    return items
  })()

  return (
    <div className="space-y-5 risico-report risico-print-root" ref={reportRef}>
      {/* Progress */}
      {(analyzing || risicoBusy) && <ProgressBar step={displayStep} percentage={displayPct} agent={displayAgent || undefined} />}

      {inRisicoWachtrij && !risicoBusy && !analyzing && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900 risico-print-hide">
          <Info className="h-4 w-4 flex-shrink-0" />Heranalyse in wachtrij (positie {risicoWachtrijPositie}).
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700 risico-print-hide">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
        </div>
      )}

      {/* ── 0. Statische inhoudsopgave (bovenaan, klikbaar, blijft in scrollpaneel zichtbaar) ── */}
      <nav
        id="s-nav-toc"
        aria-label="Inhoudsopgave risico-inventarisatie"
        className="sticky top-0 z-20 bg-[var(--background)] pb-1 shadow-[0_8px_16px_-8px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_16px_-8px_rgba(0,0,0,0.45)]"
      >
        <V2Card>
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <V2SectionHeader icon={<ListChecks className="h-4 w-4" />} title="Inhoudsopgave" accent="indigo" />
          </div>
          <div className="p-3">
            <ol className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3 lg:grid-cols-4">
              {tocItems.filter(t => t.show).map((t, i) => (
                <li key={t.id}>
                  <a
                    href={`#${t.id}`}
                    onClick={e => { e.preventDefault(); document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                    className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors group"
                  >
                    <span className="flex-shrink-0 text-[var(--muted-foreground)] group-hover:text-[var(--foreground)] transition-colors">{t.icon}</span>
                    <span className="truncate">{t.label}</span>
                    {t.count != null && <span className="ml-auto flex-shrink-0 rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">{t.count}</span>}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </V2Card>
      </nav>

      {/* ── 1. Header ─────────────────────────────────────────────────────── */}
      <div id="s-samenvatting">
      <V2Card>
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-5">
            <OverallScoreRing score={result.overall_score} />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-[var(--foreground)]">Agentic Risico-inventarisatie (19 agents)</span>
                <V2ScoreBadge score={result.overall_score} />
                <V2AdvieBadge advies={result.inschrijfadvies} />
                <span className="rounded-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 px-2.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1">
                  <Network className="h-3 w-3" />19 agents
                </span>
                {liveDraftStage && (
                  <span className="rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1 risico-print-hide" title={liveDraftAt ? `Bijgewerkt: ${new Date(liveDraftAt).toLocaleTimeString('nl-NL')}` : undefined}>
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Concept — stage {liveDraftStage}
                  </span>
                )}
              </div>
              <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{result.overall_toelichting}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted-foreground)]">
                <span><strong className="text-[var(--foreground)]">{result.risicogebieden?.length ?? 0}</strong> risicogebieden</span>
                <span><strong className="text-[var(--foreground)]">{result.risicogebieden?.flatMap(g => g.risicos).length ?? 0}</strong> risico's</span>
                {result.top5_risicos?.length > 0 && <span><strong className="text-[var(--foreground)]">{result.top5_risicos.length}</strong> top-risico's</span>}
                {result.vragen_nvi?.length > 0 && <span><strong className="text-[var(--foreground)]">{result.vragen_nvi.length}</strong> NVI-vragen</span>}
                {result.tegenstrijdigheden?.length > 0 && <span className="text-amber-700 dark:text-amber-300"><strong>{result.tegenstrijdigheden.length}</strong> tegenstrijdigh.</span>}
                {result.no_go_factoren?.length > 0 && <span className="text-red-700 dark:text-red-400 font-semibold"><strong>{result.no_go_factoren.length}</strong> no-go factor{result.no_go_factoren.length > 1 ? 'en' : ''}</span>}
              </div>
            </div>
            <div className="flex flex-col gap-2 flex-shrink-0 risico-print-hide">
              <button type="button" onClick={handleAnalyse} disabled={analyzing || risicoBusy || inRisicoWachtrij}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">
                <RefreshCw className="h-3.5 w-3.5" />Heranalyse
              </button>
              <button type="button" onClick={handleSavePdf} disabled={pdfSaving || htmlSaving}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">
                {pdfSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                PDF opslaan
              </button>
              <button type="button" onClick={handleSaveHtml} disabled={htmlSaving || pdfSaving}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50 risico-print-hide">
                <FileCode className="h-3.5 w-3.5" />{htmlSaving ? 'Opslaan…' : 'HTML opslaan'}
              </button>
            </div>
          </div>
          {result.management_samenvatting && (
            <div className="border-t border-[var(--border)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">Management samenvatting</p>
              <p className="text-sm leading-relaxed text-[var(--foreground)]">{result.management_samenvatting}</p>
            </div>
          )}
          {/* Executive decision strip */}
          <div className="border-t border-[var(--border)] pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">Beslispunten overzicht</p>
            <div className="flex flex-wrap gap-2">
              {(() => {
                const hoogRisicos = result.risicogebieden?.flatMap(g => g.risicos).filter(r => r.ernstscore === 'Hoog').length ?? 0
                const topGebieden = [...(result.risicogebieden ?? [])].sort((a, b) => {
                  const w = { Hoog: 3, Middel: 2, Laag: 1 }
                  return (w[b.score] ?? 0) - (w[a.score] ?? 0)
                }).slice(0, 3)
                const nviCount = result.vragen_nvi?.length ?? 0
                const leemteCount = result.leemtes?.length ?? 0
                const tegenstrijdigCount = result.tegenstrijdigheden?.length ?? 0
                const noGoCount = result.no_go_factoren?.length ?? 0
                const gkStatus = result.gatekeeper_resultaat?.gatekeeper_status
                return (
                  <>
                    {hoogRisicos > 0 && (
                      <a href="#s-risicogebieden" onClick={e => { e.preventDefault(); document.getElementById('s-risicogebieden')?.scrollIntoView({ behavior: 'smooth' }) }}
                        className="flex items-center gap-1.5 rounded-full bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800/40 px-3 py-1 text-xs font-semibold text-red-700 dark:text-red-300 hover:opacity-80 transition-opacity">
                        <BadgeAlert className="h-3.5 w-3.5" />{hoogRisicos} hoog risico{hoogRisicos !== 1 ? "'s" : ''}
                      </a>
                    )}
                    {noGoCount > 0 && (
                      <a href="#s-nogo" onClick={e => { e.preventDefault(); document.getElementById('s-nogo')?.scrollIntoView({ behavior: 'smooth' }) }}
                        className="flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-700/50 px-3 py-1 text-xs font-bold text-red-800 dark:text-red-200 hover:opacity-80 transition-opacity">
                        <ShieldX className="h-3.5 w-3.5" />{noGoCount} no-go factor{noGoCount !== 1 ? 'en' : ''}
                      </a>
                    )}
                    {nviCount > 0 && (
                      <a href="#s-openpunten" onClick={e => { e.preventDefault(); document.getElementById('s-openpunten')?.scrollIntoView({ behavior: 'smooth' }) }}
                        className="flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/40 px-3 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:opacity-80 transition-opacity">
                        <MessageSquareWarning className="h-3.5 w-3.5" />{nviCount} NVI-vraag{nviCount !== 1 ? 'en' : ''}
                      </a>
                    )}
                    {leemteCount > 0 && (
                      <a href="#s-leemtes" onClick={e => { e.preventDefault(); document.getElementById('s-leemtes')?.scrollIntoView({ behavior: 'smooth' }) }}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--muted)] border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted-foreground)] hover:opacity-80 transition-opacity">
                        <HelpCircle className="h-3.5 w-3.5" />{leemteCount} leemte{leemteCount !== 1 ? 's' : ''}
                      </a>
                    )}
                    {tegenstrijdigCount > 0 && (
                      <a href="#s-tegenstrijdigheden" onClick={e => { e.preventDefault(); document.getElementById('s-tegenstrijdigheden')?.scrollIntoView({ behavior: 'smooth' }) }}
                        className="flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:opacity-80 transition-opacity">
                        <AlertTriangle className="h-3.5 w-3.5" />{tegenstrijdigCount} tegenstrijdigheid{tegenstrijdigCount !== 1 ? 'en' : ''}
                      </a>
                    )}
                    {gkStatus && (
                      <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border ${gkStatus === 'approved' ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-950/20 dark:border-green-800/40 dark:text-green-300' : gkStatus === 'needs_revision' ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/20 dark:border-amber-800/40 dark:text-amber-300' : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/20 dark:border-red-800/40 dark:text-red-300'}`}>
                        <ShieldCheck className="h-3.5 w-3.5" />Gatekeeper: {gkStatus === 'approved' ? 'goedgekeurd' : gkStatus === 'needs_revision' ? 'revisie nodig' : 'afgekeurd'}
                      </span>
                    )}
                    {topGebieden.length > 0 && (
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mr-1">Top gebieden:</span>
                        {topGebieden.map(g => (
                          <a key={g.naam} href="#s-risicogebieden" onClick={e => { e.preventDefault(); document.getElementById('s-risicogebieden')?.scrollIntoView({ behavior: 'smooth' }) }}
                            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border hover:opacity-80 transition-opacity ${g.score === 'Hoog' ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/20 dark:border-red-800/40 dark:text-red-300' : g.score === 'Middel' ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/20 dark:border-amber-800/40 dark:text-amber-300' : 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-800/40 dark:text-emerald-300'}`}>
                            {g.naam}
                          </a>
                        ))}
                      </span>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      </V2Card>
      </div>

      {/* ── 2. Tenderoverzicht ─────────────────────────────────────────── */}
      {result.algemene_tenderanalyse && (
        <div id="s-tenderoverzicht">
        <V2Card>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <V2SectionHeader icon={<Building2 className="h-4 w-4" />} title="Tenderoverzicht" accent="blue" />
          </div>
          <div className="p-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { label: 'Aanbestedende dienst', val: v2DisplayString(result.algemene_tenderanalyse.aanbestedende_dienst as unknown) },
              { label: 'Procedure', val: v2DisplayString(result.algemene_tenderanalyse.procedure as unknown) },
              { label: 'Contractvorm', val: v2DisplayString(result.algemene_tenderanalyse.contractvorm as unknown) },
              { label: 'Gunningssystematiek', val: v2DisplayString(result.algemene_tenderanalyse.gunningssystematiek as unknown) },
            ].filter(f => f.val).map(f => (
              <div key={f.label}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{f.label}</p>
                <p className="text-sm text-[var(--foreground)]">{f.val}</p>
              </div>
            ))}
            {v2DisplayString(result.algemene_tenderanalyse.opdrachtomschrijving as unknown) && (
              <div className="sm:col-span-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Opdrachtomschrijving</p>
                <p className="text-sm text-[var(--foreground)]">{v2DisplayString(result.algemene_tenderanalyse.opdrachtomschrijving as unknown)}</p>
              </div>
            )}
            {v2DisplayTermijnen(result.algemene_tenderanalyse.belangrijkste_termijnen as unknown).length > 0 && (
              <div className="sm:col-span-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">Termijnen</p>
                <div className="flex flex-wrap gap-1.5">
                  {v2DisplayTermijnen(result.algemene_tenderanalyse.belangrijkste_termijnen as unknown).map((t, i) => (
                    <span key={i} className="rounded-md bg-blue-50 border border-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-950/20 dark:border-blue-800/30 dark:text-blue-300">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </V2Card>
        </div>
      )}

      {/* ── 3. Document inventarisatie ─────────────────────────────────── */}
      {result.document_inventarisatie?.length > 0 && (
        <div id="s-documenten">
        <V2Card>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <V2SectionHeader icon={<FileText className="h-4 w-4" />} title="Documentinventarisatie" count={result.document_inventarisatie.length} accent="cyan" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] bg-cyan-50/60 dark:bg-cyan-950/10 text-[var(--muted-foreground)]">
                  <th className="px-4 py-2 text-left font-semibold">Document</th>
                  <th className="px-4 py-2 text-left font-semibold">Type</th>
                  <th className="px-4 py-2 text-left font-semibold">Leidend</th>
                  <th className="px-4 py-2 text-left font-semibold">Rol / Opmerkingen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {result.document_inventarisatie.map((d, i) => (
                  <tr key={i} className="text-[var(--foreground)]">
                    <td className="px-4 py-2 font-medium">{d.naam}</td>
                    <td className="px-4 py-2 text-[var(--muted-foreground)]">{d.type}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${d.leidend_document === 'Ja' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'}`}>
                        {d.leidend_document}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[var(--muted-foreground)]">{d.rol || d.opmerkingen || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </V2Card>
        </div>
      )}

      {/* ── 3b. Documentleesplicht & volledigheid ──────────────────────── */}
      {result.document_leesplicht_bevestiging && (
        <div id="s-leesplicht">
        <V2Card>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <V2SectionHeader icon={<ClipboardCheck className="h-4 w-4" />} title="Documentvolledigheid & leesplicht" accent="cyan" />
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm flex-shrink-0 ${result.document_leesplicht_bevestiging.alle_aangeleverde_documenten_geanalyseerd ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                {result.document_leesplicht_bevestiging.alle_aangeleverde_documenten_geanalyseerd ? '✓' : '!'}
              </span>
              <p className="text-sm text-[var(--foreground)]">
                {result.document_leesplicht_bevestiging.alle_aangeleverde_documenten_geanalyseerd
                  ? 'Alle aangeleverde documenten zijn geanalyseerd.'
                  : 'Niet alle aangeleverde documenten konden worden geanalyseerd.'}
              </p>
            </div>
            {result.document_leesplicht_bevestiging.toelichting && (
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed border-l-2 border-[var(--border)] pl-3">{result.document_leesplicht_bevestiging.toelichting}</p>
            )}
            {result.document_leesplicht_bevestiging.ontbrekende_of_onleesbare_documenten?.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1.5">Ontbrekend of onleesbaar — niet uit de stukken af te leiden:</p>
                <ul className="space-y-1">
                  {result.document_leesplicht_bevestiging.ontbrekende_of_onleesbare_documenten.map((d, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </V2Card>
        </div>
      )}

      {/* ── 3c. Bewijs- en aannameregeling ─────────────────────────────── */}
      {result.bewijs_en_aannameregel && (
        <div id="s-bewijs">
        <V2Card>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <V2SectionHeader icon={<Scale className="h-4 w-4" />} title="Bewijs- en aannameregeling" accent="gray" />
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm flex-shrink-0 ${result.bewijs_en_aannameregel.toegepast ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'}`}>
                {result.bewijs_en_aannameregel.toegepast ? '✓' : '—'}
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {result.bewijs_en_aannameregel.toegepast ? 'Bewijsregel toegepast' : 'Bewijsregel niet van toepassing'}
                </p>
                {result.bewijs_en_aannameregel.toelichting && (
                  <p className="text-xs text-[var(--muted-foreground)]">{result.bewijs_en_aannameregel.toelichting}</p>
                )}
              </div>
            </div>
            {result.bewijs_en_aannameregel.niet_onderbouwde_aannames_geweigerd && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800/40 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">Niet-onderbouwde aannames zijn geweigerd — conclusies zijn uitsluitend gebaseerd op uit de stukken aantoonbare feiten.</p>
              </div>
            )}
          </div>
        </V2Card>
        </div>
      )}

      {/* ── 3d. Locatie & omgeving ─────────────────────────────────────── */}
      {result.locatie_en_omgevingsanalyse && (
        <div id="s-locatie">
        <V2Card>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <V2SectionHeader icon={<Navigation className="h-4 w-4" />} title="Locatie & omgeving" accent="teal" />
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Adres / werkgebied</p>
                <p className="text-sm text-[var(--foreground)]">
                  {result.locatie_en_omgevingsanalyse.exacte_locatie_vastgesteld
                    ? result.locatie_en_omgevingsanalyse.adres_of_werkgebied
                    : <span className="text-amber-700 dark:text-amber-400 font-medium">Niet uit de stukken af te leiden: exacte locatie/werkgebied — {result.locatie_en_omgevingsanalyse.adres_of_werkgebied}</span>}
                </p>
              </div>
              {(['binnenstedelijk', 'drukke_straat_of_verkeersader', 'moeilijk_bereikbaar', 'beperkte_werkruimte', 'gevoelige_omgeving'] as const).map(key => {
                const val = result.locatie_en_omgevingsanalyse[key]
                const labels: Record<string, string> = { binnenstedelijk: 'Binnenstedelijk', drukke_straat_of_verkeersader: 'Drukke weg/ader', moeilijk_bereikbaar: 'Moeilijk bereikbaar', beperkte_werkruimte: 'Beperkte werkruimte', gevoelige_omgeving: 'Gevoelige omgeving' }
                const isOnbekend = val === 'Niet vast te stellen'
                return (
                  <div key={key}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{labels[key]}</p>
                    {isOnbekend
                      ? <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Niet uit de stukken af te leiden: {labels[key].toLowerCase()}</p>
                      : <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${val === 'Ja' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>{val}</span>}
                  </div>
                )
              })}
            </div>
            {result.locatie_en_omgevingsanalyse.contractueel_vastgestelde_locatiefeiten?.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">Contractueel vastgesteld</p>
                <ul className="space-y-1">
                  {result.locatie_en_omgevingsanalyse.contractueel_vastgestelde_locatiefeiten.map((f, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--foreground)]">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />{f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.locatie_en_omgevingsanalyse.externe_verificatiepunten?.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">Externe verificatiepunten</p>
                <ul className="space-y-1">
                  {result.locatie_en_omgevingsanalyse.externe_verificatiepunten.map((v, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-blue-700 dark:text-blue-300">
                      <Eye className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{v}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.locatie_en_omgevingsanalyse.risicos_uit_locatieanalyse?.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1.5">Risico's uit locatieanalyse</p>
                <ul className="space-y-1">
                  {result.locatie_en_omgevingsanalyse.risicos_uit_locatieanalyse.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </V2Card>
        </div>
      )}

      {/* ── 4. Top 5 risico's ──────────────────────────────────────────── */}
      {result.top5_risicos?.length > 0 && (
        <div id="s-top5">
        <V2Card>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <V2SectionHeader icon={<BadgeAlert className="h-4 w-4" />} title="Top 5 zwaarste risico's" accent="red" />
          </div>
          <div className="p-4 space-y-3">
            {result.top5_risicos.map((r, i) => (
              <div key={i} className={`rounded-lg border p-3 ${r.ernstscore === 'Hoog' ? 'border-red-200 bg-red-50 dark:bg-red-950/25 dark:border-red-900/40' : r.ernstscore === 'Middel' ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/25 dark:border-amber-900/40' : 'border-[var(--border)] bg-[var(--muted)]/20'}`}>
                <div className="flex items-start gap-3">
                  <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${r.ernstscore === 'Hoog' ? 'bg-red-100 text-red-700' : r.ernstscore === 'Middel' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-[var(--foreground)]">{r.titel}</span>
                      <V2ScoreBadge score={r.ernstscore} />
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)]">{r.waarom_toprisico}</p>
                    {r.bron && <p className="mt-1 text-[10px] text-[var(--muted-foreground)] italic">Bron: {r.bron}</p>}
                    {r.actie && <p className="mt-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">→ {r.actie}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </V2Card>
        </div>
      )}

      {/* ── 5. Top 5 prijs + planning ─────────────────────────────────── */}
      <div id="s-prijs-planning">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {result.top5_prijsverhogende_risicofactoren?.length > 0 && (
            <V2Card>
              <div className="border-b border-[var(--border)] px-4 py-3">
                <V2SectionHeader icon={<Banknote className="h-4 w-4" />} title="Top 5 prijsverhogende factoren" accent="amber" />
              </div>
            <div className="p-4 space-y-2.5">
              {result.top5_prijsverhogende_risicofactoren.map((f, i) => (
                <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3">
                  <div className="flex items-start gap-2">
                    <span className="flex-shrink-0 rounded-full bg-[var(--muted)] h-5 w-5 text-[10px] font-bold flex items-center justify-center text-[var(--muted-foreground)]">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--foreground)]">{f.factor}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{f.toelichting}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {f.mogelijke_prijsimpact && <V2ScoreBadge score={f.mogelijke_prijsimpact} />}
                        {f.bron && <span className="text-[10px] text-[var(--muted-foreground)] italic">Bron: {f.bron}</span>}
                      </div>
                      {(f.status_van_onderbouwing === 'niet vast te stellen op basis van de stukken' || f.status_van_onderbouwing === 'conflicterend in stukken') && (
                        <p className="mt-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">Niet uit de stukken af te leiden: {f.factor}{f.verificatie ? ` — ${f.verificatie.slice(0, 80)}` : ''}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </V2Card>
        )}

        {result.top5_planningsrisicos?.length > 0 && (
            <V2Card>
              <div className="border-b border-[var(--border)] px-4 py-3">
                <V2SectionHeader icon={<Calendar className="h-4 w-4" />} title="Top 5 planningsrisico's" accent="amber" />
              </div>
            <div className="p-4 space-y-2.5">
              {result.top5_planningsrisicos.map((r, i) => (
                <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3">
                  <div className="flex items-start gap-2">
                    <span className="flex-shrink-0 rounded-full bg-[var(--muted)] h-5 w-5 text-[10px] font-bold flex items-center justify-center text-[var(--muted-foreground)]">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--foreground)]">{r.risico}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{r.toelichting}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {r.mogelijke_planningsimpact && <V2ScoreBadge score={r.mogelijke_planningsimpact} />}
                        {r.actie && <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">→ {r.actie}</p>}
                      </div>
                      {(r.status_van_onderbouwing === 'niet vast te stellen op basis van de stukken' || r.status_van_onderbouwing === 'conflicterend in stukken') && (
                        <p className="mt-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">Niet uit de stukken af te leiden: {r.risico}{r.actie ? ` — actie: ${r.actie.slice(0, 80)}` : ''}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </V2Card>
        )}
      </div>
      </div>

      {/* ── 6. Risicogebieden ─────────────────────────────────────────── */}
      {result.risicogebieden?.length > 0 && (
        <div id="s-risicogebieden" className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
              <Layers className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-bold text-[var(--foreground)]">Risicogebieden</h3>
            <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">{result.risicogebieden.length}</span>
            <label className="ml-auto flex cursor-pointer select-none items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors risico-print-hide">
              <input
                type="checkbox"
                checked={expandAll}
                onChange={e => setExpandAll(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-[var(--primary)] cursor-pointer"
              />
              {expandAll ? 'Alles inklappen' : 'Alles uitklappen'}
            </label>
          </div>
          {result.risicogebieden.map((g, i) => <V2GebiedSection key={i} gebied={g} expandAll={expandAll} />)}
        </div>
      )}

      {/* ── 7. Tegenstrijdigheden + Leemtes ───────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {result.tegenstrijdigheden?.length > 0 && (
          <div id="s-tegenstrijdigheden">
          <V2Card>
            <div className="border-b border-[var(--border)] px-4 py-3">
              <V2SectionHeader icon={<AlertTriangle className="h-4 w-4" />} title="Tegenstrijdigheden" count={result.tegenstrijdigheden.length} accent="amber" />
            </div>
            <div className="p-4 space-y-3">
              {result.tegenstrijdigheden.map((t, i) => (
                <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 p-3 space-y-1">
                  <p className="text-sm font-semibold text-[var(--foreground)]">{t.omschrijving}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{t.document_1} ↔ {t.document_2}</p>
                  {t.risico && <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">{t.risico}</p>}
                  {t.actie && <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">→ {t.actie}</p>}
                </div>
              ))}
            </div>
          </V2Card>
          </div>
        )}

        {result.leemtes?.length > 0 && (
          <div id="s-leemtes">
          <V2Card>
            <div className="border-b border-[var(--border)] px-4 py-3">
              <V2SectionHeader icon={<HelpCircle className="h-4 w-4" />} title="Leemtes" count={result.leemtes.length} accent="gray" />
            </div>
            <div className="p-4 space-y-3">
              {result.leemtes.map((l, i) => (
                <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3 space-y-1">
                  <p className="text-sm font-semibold text-[var(--foreground)]">{l.ontbrekende_informatie}</p>
                  {l.waarom_belangrijk && <p className="text-xs text-[var(--muted-foreground)]">{l.waarom_belangrijk}</p>}
                  {l.risico_voor_inschrijver && <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">{l.risico_voor_inschrijver}</p>}
                  {l.vraag_nvi && <p className="text-xs text-blue-700 dark:text-blue-300 italic font-medium">NVI: {l.vraag_nvi}</p>}
                </div>
              ))}
            </div>
          </V2Card>
          </div>
        )}
      </div>

      {/* ── 8. No-go factoren ─────────────────────────────────────────── */}
      {result.no_go_factoren?.length > 0 && (
        <div id="s-nogo">
        <V2Card>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <V2SectionHeader icon={<ShieldX className="h-4 w-4" />} title="No-go factoren" count={result.no_go_factoren.length} accent="red" />
          </div>
          <div className="p-4 space-y-3">
            {result.no_go_factoren.map((f, i) => (
              <div key={i} className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/25 dark:border-red-900/40 p-3 space-y-1">
                <p className="text-sm font-semibold text-red-800 dark:text-red-300">{f.factor}</p>
                {f.waarom_no_go && <p className="text-xs text-red-700 dark:text-red-400">{f.waarom_no_go}</p>}
                {f.bron && <p className="text-[10px] text-[var(--muted-foreground)] italic">Bron: {f.bron}</p>}
                {f.kan_worden_opgelost_door && <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">→ Oplossing: {f.kan_worden_opgelost_door}</p>}
              </div>
            ))}
          </div>
        </V2Card>
        </div>
      )}

      {/* ── 8b. Open punten & NVI-werkprogramma ───────────────────────── */}
      {openPunten.length > 0 && (
        <div id="s-openpunten">
        <V2Card>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <V2SectionHeader icon={<MessageSquareWarning className="h-4 w-4" />} title="Open punten & NVI-werkprogramma" count={openPunten.length} accent="blue" />
          </div>
          <div className="p-4">
            <p className="text-xs text-[var(--muted-foreground)] mb-3">Gecombineerde lijst van alle uit te zoeken punten — NVI-vragen, leemtes en conceptvragen vanuit risicogebieden. Stuur deze punten als vragen in de Nota van Inlichtingen.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-blue-50/60 dark:bg-blue-950/10 text-[var(--muted-foreground)]">
                    <th className="px-3 py-2 text-left font-semibold w-8"><Hash className="h-3 w-3" /></th>
                    <th className="px-3 py-2 text-left font-semibold">Categorie</th>
                    <th className="px-3 py-2 text-left font-semibold">Prioriteit</th>
                    <th className="px-3 py-2 text-left font-semibold">Formulering</th>
                    <th className="px-3 py-2 text-left font-semibold">Risico / belang</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {openPunten.map((p, i) => (
                    <tr key={i} className="align-top">
                      <td className="px-3 py-2 text-[var(--muted-foreground)] font-mono">{i + 1}</td>
                      <td className="px-3 py-2">
                        <span className="rounded px-1.5 py-0.5 bg-[var(--muted)] text-[var(--muted-foreground)] font-medium capitalize">{p.categorie ?? '—'}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 font-semibold ${p.prioriteit === 'hoog' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : p.prioriteit === 'middel' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>{p.prioriteit}</span>
                      </td>
                      <td className="px-3 py-2 font-medium text-[var(--foreground)] max-w-xs">{p.formulering}</td>
                      <td className="px-3 py-2 text-[var(--muted-foreground)] max-w-xs">{p.risico ?? p.risicoPrijs ?? p.risicoPlanning ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </V2Card>
        </div>
      )}

      {/* ── 9. NVI-vragen ─────────────────────────────────────────────── */}
      {result.vragen_nvi?.length > 0 && (
        <div id="s-nvi">
        <V2Card>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <V2SectionHeader icon={<MessageSquareWarning className="h-4 w-4" />} title="Nota van Inlichtingen vragen (volledig)" count={result.vragen_nvi.length} accent="blue" />
          </div>
          <div className="p-4 space-y-3">
            {(() => {
              const byCategory = result.vragen_nvi.reduce<Record<string, typeof result.vragen_nvi>>((acc, v) => {
                const cat = v.categorie || 'overig'
                if (!acc[cat]) acc[cat] = []
                acc[cat].push(v)
                return acc
              }, {})
              return Object.entries(byCategory).map(([cat, vragen]) => (
                <div key={cat}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)] mb-2 px-0.5">{cat}</p>
                  <div className="space-y-2">
                    {vragen.map((v, i) => (
                      <div key={i} className="rounded-lg border border-blue-100 bg-blue-50 dark:bg-blue-950/15 dark:border-blue-900/30 p-3">
                        <p className="text-sm font-semibold text-[var(--foreground)]">{v.formulering}</p>
                        {v.doel && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{v.doel}</p>}
                        {v.bron && <p className="mt-1 text-[10px] italic text-[var(--muted-foreground)]">Bron: {v.bron}</p>}
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--muted-foreground)]">
                          {v.waarom_belangrijk_voor_risico && <span>Risico: {v.waarom_belangrijk_voor_risico}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            })()}
          </div>
        </V2Card>
        </div>
      )}

      {/* ── 10. Inschrijfstrategie ─────────────────────────────────────── */}
      {result.inschrijfstrategie && (
        <div id="s-strategie">
        <V2Card>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <V2SectionHeader icon={<Target className="h-4 w-4" />} title="Inschrijfstrategie" accent="emerald" />
          </div>
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <V2AdvieBadge advies={result.inschrijfstrategie.advies} />
              {result.inschrijfstrategie.toelichting && (
                <p className="text-sm text-[var(--foreground)] leading-relaxed">{result.inschrijfstrategie.toelichting}</p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {result.inschrijfstrategie.belangrijkste_voorwaarden_voor_inschrijving?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">Voorwaarden voor inschrijving</p>
                  <ul className="space-y-1">
                    {result.inschrijfstrategie.belangrijkste_voorwaarden_voor_inschrijving.map((v, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--foreground)]">
                        <CircleCheck className="h-3.5 w-3.5 flex-shrink-0 text-green-600 mt-0.5" />{v}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.inschrijfstrategie.risicos_die_via_nvi_moeten_worden_opgehelderd?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">Op te helderen via NVI</p>
                  <ul className="space-y-1">
                    {result.inschrijfstrategie.risicos_die_via_nvi_moeten_worden_opgehelderd.map((v, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--foreground)]">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-blue-600 mt-0.5" />{v}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.inschrijfstrategie.risicos_die_in_prijs_of_planning_moeten_worden_verwerkt?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)] mb-1.5">In prijs / planning verwerken</p>
                  <ul className="space-y-1">
                    {result.inschrijfstrategie.risicos_die_in_prijs_of_planning_moeten_worden_verwerkt.map((v, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--foreground)]">
                        <Banknote className="h-3.5 w-3.5 flex-shrink-0 text-amber-600 mt-0.5" />{v}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.inschrijfstrategie.no_go_signalen?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-red-700 dark:text-red-400 mb-1.5">No-go signalen</p>
                  <ul className="space-y-1">
                    {result.inschrijfstrategie.no_go_signalen.map((v, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400 font-semibold">
                        <ShieldX className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{v}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </V2Card>
        </div>
      )}

      {/* ── 11. Summary overzicht per risicogebied ─────────────────────── */}
      {result.risicogebieden?.length > 0 && (
        <div id="s-overzicht">
        <V2Card>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <V2SectionHeader icon={<ListChecks className="h-4 w-4" />} title="Summary overzicht per risicogebied" accent="purple" />
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {result.risicogebieden.map((g, i) => {
                const scoreColor = g.score === 'Hoog'
                  ? 'border-red-200 bg-red-50 dark:bg-red-950/25 dark:border-red-900/40'
                  : g.score === 'Middel'
                  ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/25 dark:border-amber-900/40'
                  : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/40'
                const dotCls = g.score === 'Hoog' ? 'bg-red-500' : g.score === 'Middel' ? 'bg-amber-500' : 'bg-emerald-500'
                const hoogCount = g.risicos.filter(r => r.ernstscore === 'Hoog').length
                const middelCount = g.risicos.filter(r => r.ernstscore === 'Middel').length
                return (
                  <div key={i} className={`rounded-xl border p-3.5 space-y-2 ${scoreColor}`}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${dotCls}`} />
                      <span className="text-sm font-semibold text-[var(--foreground)] truncate">{g.naam}</span>
                      <V2ScoreBadge score={g.score} />
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] leading-snug line-clamp-3">{g.score_toelichting || '—'}</p>
                    <div className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                      <span>{g.risicos.length} risico's</span>
                      {hoogCount > 0 && <span className="text-red-700 dark:text-red-300 font-semibold">{hoogCount} hoog</span>}
                      {middelCount > 0 && <span className="text-amber-700 dark:text-amber-300 font-semibold">{middelCount} middel</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </V2Card>
        </div>
      )}

      {/* Gatekeeper */}
      {result.gatekeeper_resultaat && (
        <div id="s-gatekeeper">
        <V2Card>
          <div className="border-b border-[var(--border)] px-4 py-3">
            <V2SectionHeader
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Gatekeeper validatie"
              accent="emerald"
              score={result.gatekeeper_resultaat.gatekeeper_status === 'approved' ? 'Laag' : result.gatekeeper_resultaat.gatekeeper_status === 'needs_revision' ? 'Middel' : 'Hoog'}
            />
          </div>
          <div className="p-4">
            <div className="flex flex-wrap gap-2 text-xs">
              {[
                { label: 'Bronplicht', ok: result.gatekeeper_resultaat.bronplicht_goedgekeurd },
                { label: 'Aannames', ok: result.gatekeeper_resultaat.aannames_goedgekeurd },
                { label: 'Ext. bronnen', ok: result.gatekeeper_resultaat.externe_bronnen_correct_gelabeld },
                { label: 'Volledigheid', ok: result.gatekeeper_resultaat.volledigheid_goedgekeurd },
                { label: 'Consistentie', ok: result.gatekeeper_resultaat.consistentie_goedgekeurd },
                { label: 'JSON', ok: result.gatekeeper_resultaat.json_validatie_goedgekeurd },
              ].map(({ label, ok }) => (
                <span key={label} className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {ok ? '✓' : '✗'} {label}
                </span>
              ))}
            </div>
            {result.gatekeeper_resultaat.bevindingen?.length > 0 && (
              <div className="mt-3 space-y-1">
                {result.gatekeeper_resultaat.bevindingen.map((b, i) => (
                  <p key={i} className="text-xs text-[var(--muted-foreground)]">{typeof b === 'string' ? b : JSON.stringify(b)}</p>
                ))}
              </div>
            )}
          </div>
        </V2Card>
        </div>
      )}

      {/* ── Footer: slotconclusie + aanbevelings-roadmap ──────────────── */}
      <div id="s-conclusie">
      <V2Card>
        <div className="border-b border-[var(--border)] px-4 py-3">
          <V2SectionHeader icon={<Milestone className="h-4 w-4" />} title="Slotconclusie & aanbevelings-roadmap" accent="indigo" />
        </div>
        <div className="p-5 space-y-5">
          {/* Slotconclusie */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <V2AdvieBadge advies={result.inschrijfadvies} />
              <V2ScoreBadge score={result.overall_score} />
              {liveDraftStage && <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 italic">(concept — eindredactie volgt)</span>}
            </div>
            <p className="text-sm leading-relaxed text-[var(--foreground)]">
              {result.management_samenvatting || result.overall_toelichting || 'Analyse nog in uitvoering — slottekst volgt na afronden eindrapportage.'}
            </p>
            {result.management_samenvatting && result.overall_toelichting && result.management_samenvatting !== result.overall_toelichting && (
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed border-l-2 border-[var(--border)] pl-3">{result.overall_toelichting}</p>
            )}
          </div>

          {/* Verticale aanbevelings-roadmap */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-4">Aanbevelings-roadmap</p>
            <RoadmapTimeline result={result} />
          </div>
        </div>
      </V2Card>
      </div>

      {/* Herhaal heranalyse onderaan */}
      <div className="flex justify-center pb-2 risico-print-hide">
        <button onClick={handleAnalyse} disabled={analyzing || risicoBusy || inRisicoWachtrij}
          className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">
          <RefreshCw className="h-4 w-4" />
          {inRisicoWachtrij ? `In wachtrij (nr. ${risicoWachtrijPositie})` : 'Heranalyse uitvoeren'}
        </button>
      </div>
    </div>
  )
}

// ── Error boundary ────────────────────────────────────────────────────────────

interface EBState { hasError: boolean; message: string }
class RisicoErrorBoundary extends React.Component<{ children: React.ReactNode; onRetry: () => void }, EBState> {
  constructor(props: { children: React.ReactNode; onRetry: () => void }) {
    super(props)
    this.state = { hasError: false, message: '' }
  }
  static getDerivedStateFromError(error: unknown): EBState {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100">
            <AlertTriangle className="h-7 w-7 text-red-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">Weergavefout in risico-inventarisatie</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)] max-w-sm">{this.state.message}</p>
          </div>
          <button
            onClick={() => { this.setState({ hasError: false, message: '' }); this.props.onRetry() }}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--muted)] transition-colors"
          >
            <RefreshCw className="h-4 w-4" />Heranalyse uitvoeren
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Main RisicoTab component ──────────────────────────────────────────────────

interface RisicoTabProps {
  aanbestedingId: string
  risicoAnalyseJson: string | null | undefined
  risicoAnalyseAt: string | null | undefined
  risicoAnalyseV2Json?: string | null | undefined
  /** 1-based positie in main-process wachtrij, of null */
  risicoWachtrijPositie?: number | null
  onRefresh: () => void | Promise<void>
}

export function RisicoTab({
  aanbestedingId,
  risicoAnalyseJson,
  risicoAnalyseAt,
  risicoAnalyseV2Json,
  risicoWachtrijPositie = null,
  onRefresh,
}: RisicoTabProps) {
  const [analyzing, setAnalyzing] = useState(false)
  const [progressStep, setProgressStep] = useState('')
  const [progressPct, setProgressPct] = useState(0)
  const [progressAgent, setProgressAgent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [liveDraft, setLiveDraft] = useState<RisicoAnalyseV2Result | null>(null)
  const [liveDraftStage, setLiveDraftStage] = useState<string | null>(null)
  const [liveDraftAt, setLiveDraftAt] = useState<string | null>(null)

  const risicoStoreEntry = useAnalysisActiveStore((s) => {
    const e = s.active[aanbestedingId]
    return e?.type === 'risico' ? e : null
  })

  const result: RisicoAnalyseResult | null = risicoAnalyseJson
    ? (() => { try { return JSON.parse(risicoAnalyseJson) } catch { return null } })()
    : null

  const resultV2: RisicoAnalyseV2Result | null = risicoAnalyseV2Json
    ? (() => { try { return JSON.parse(risicoAnalyseV2Json) } catch { return null } })()
    : null

  const risicoBusy = risicoStoreEntry != null

  const displayStep = (risicoStoreEntry?.step || progressStep || '').trim() || 'Risico-analyse…'
  const displayPct =
    typeof risicoStoreEntry?.percentage === 'number'
      ? Math.min(100, Math.max(0, risicoStoreEntry.percentage))
      : progressPct
  const displayAgent = (risicoStoreEntry?.agent || progressAgent).trim()

  // effectiveResult: toon liveDraft tijdens een actieve run, DB-definitief daarna
  const effectiveResultV2: RisicoAnalyseV2Result | null =
    (risicoBusy || analyzing) && liveDraft ? liveDraft : (resultV2 ?? liveDraft)

  // Haal checkpoint-draft op bij mount als er al een run loopt
  useEffect(() => {
    void (async () => {
      try {
        const snap = await (api as any).fetchRisicoDraftCheckpoint?.(aanbestedingId)
        if (snap?.assembledDraft) {
          setLiveDraft(snap.assembledDraft)
          setLiveDraftStage(snap.assembledDraftStage ?? null)
          setLiveDraftAt(snap.assembledDraftSavedAt ?? null)
        }
      } catch { /* niet-blokkerend */ }
    })()
  }, [aanbestedingId])

  // Listen to draft snapshot push events
  useEffect(() => {
    const unsub = (api as any).onRisicoDraftSnapshot?.((data: unknown) => {
      const d = data as { aanbestedingId: string; assembledDraft: RisicoAnalyseV2Result; assembledDraftStage: string; assembledDraftSavedAt: string }
      if (d.aanbestedingId !== aanbestedingId) return
      setLiveDraft(d.assembledDraft)
      setLiveDraftStage(d.assembledDraftStage)
      setLiveDraftAt(d.assembledDraftSavedAt)
    })
    return () => unsub?.()
  }, [aanbestedingId])

  // Listen to risico progress events (both standalone and pipeline-embedded)
  useEffect(() => {
    const unsub = api.onRisicoProgress?.((data: unknown) => {
      const d = data as { aanbestedingId: string; step: string; percentage: number; agent?: string }
      if (d.aanbestedingId !== aanbestedingId) return
      setProgressStep(d.step)
      setProgressPct(d.percentage)
      if (typeof d.agent === 'string' && d.agent.trim()) setProgressAgent(d.agent.trim())
      // When the pipeline-embedded analysis finishes (100%), refresh data and clear live draft
      if (d.percentage >= 100) {
        if (d.step && (d.step.toLowerCase().includes('fout') || d.step.toLowerCase().includes('error'))) {
          setError(d.step)
        }
        void onRefresh().then(() => {
          setLiveDraft(null)
          setLiveDraftStage(null)
          setLiveDraftAt(null)
        })
      }
    })
    return () => {
      unsub?.()
    }
  }, [aanbestedingId, onRefresh])

  const inRisicoWachtrij = risicoWachtrijPositie != null && risicoWachtrijPositie > 0

  const handleAnalyse = useCallback(async () => {
    if (risicoBusy || inRisicoWachtrij) return
    setAnalyzing(true)
    setError(null)
    setProgressStep('Analyse starten…')
    setProgressPct(0)
    setProgressAgent('')
    try {
      const res = await api.startRisicoAnalyseV2(aanbestedingId) as {
        success: boolean
        error?: string
        queued?: boolean
        position?: number
        alreadyRunning?: boolean
      }
      if (res?.queued || res?.alreadyRunning) {
        /* Voortgang volgt via IPC + batch-status */
      } else if (!res?.success) {
        setError(res?.error || 'Analyse mislukt')
      } else {
        await onRefresh()
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyzing(false)
    }
  }, [aanbestedingId, onRefresh, risicoBusy, inRisicoWachtrij])

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!result && !effectiveResultV2 && !analyzing && !risicoBusy) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--muted)]">
          <ShieldAlert className="h-8 w-8 text-[var(--muted-foreground)]" />
        </div>
        <h3 className="mb-2 text-base font-semibold text-[var(--foreground)]">Nog geen risico-inventarisatie</h3>
        <p className="mb-6 max-w-sm text-sm text-[var(--muted-foreground)]">
          Na de AI-analyse start de eerste inventarisatie automatisch (als die nog niet bestaat). Daarna
          is inventarisatie eenmalig — voor een <strong>nieuwe</strong> ronde gebruik je de knop
          &quot;Nieuwe risico&quot; (balk of dit tabblad). Hieronder kun je handmatig starten.
        </p>
        {inRisicoWachtrij && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
            <Info className="h-4 w-4 flex-shrink-0" />
            Deze inventarisatie staat in de wachtrij (positie {risicoWachtrijPositie}). Hij start automatisch na de lopende analyse(s).
          </div>
        )}
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={handleAnalyse}
          disabled={risicoBusy || inRisicoWachtrij}
          title="Handmatig risico-inventarisatie starten (of in wachtrij zetten)"
          className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          {inRisicoWachtrij ? `In wachtrij (nr. ${risicoWachtrijPositie})` : 'Start risico-inventarisatie'}
        </button>
      </div>
    )
  }

  // ── Loading state (ook na navigatie: store houdt risico-analyse vast) ────────
  if (!result && !effectiveResultV2 && (analyzing || risicoBusy)) {
    return (
      <div className="space-y-4">
        <ProgressBar step={displayStep} percentage={displayPct} agent={displayAgent || undefined} />
      </div>
    )
  }

  // ── V2 renderer (agentic 19-agents pipeline output) ─────────────────────────
  // Accepteer resultV2 ook als schema_versie ontbreekt maar overall_score wél aanwezig is
  if (effectiveResultV2 && (effectiveResultV2.schema_versie === 'v2' || effectiveResultV2.overall_score)) {
    const isLiveConcept = !!(liveDraft && effectiveResultV2 === liveDraft)
    return (
      <RisicoCitationModalLayer tenderId={aanbestedingId}>
        <RisicoErrorBoundary onRetry={handleAnalyse}>
          <RisicoV2Renderer
            result={effectiveResultV2}
            analyzing={analyzing}
            risicoBusy={risicoBusy}
            inRisicoWachtrij={inRisicoWachtrij}
            risicoWachtrijPositie={risicoWachtrijPositie}
            displayStep={displayStep}
            displayPct={displayPct}
            displayAgent={displayAgent}
            error={error}
            handleAnalyse={handleAnalyse}
            liveDraftStage={isLiveConcept ? (liveDraftStage ?? undefined) : undefined}
            liveDraftAt={isLiveConcept ? (liveDraftAt ?? undefined) : undefined}
          />
        </RisicoErrorBoundary>
      </RisicoCitationModalLayer>
    )
  }

  // Fallback: geen resultaat → toon lege state (nooit wit scherm)
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--muted)]">
          <ShieldAlert className="h-8 w-8 text-[var(--muted-foreground)]" />
        </div>
        <h3 className="mb-2 text-base font-semibold text-[var(--foreground)]">Nog geen risico-inventarisatie</h3>
        <p className="mb-6 max-w-sm text-sm text-[var(--muted-foreground)]">
          Klik op de knop hieronder om een nieuwe agentic risico-inventarisatie te starten.
        </p>
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
          </div>
        )}
        <button
          type="button"
          onClick={handleAnalyse}
          disabled={risicoBusy || inRisicoWachtrij}
          className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          {inRisicoWachtrij ? `In wachtrij (nr. ${risicoWachtrijPositie})` : 'Start risico-inventarisatie'}
        </button>
      </div>
    )
  }

  const advies = adviesBadge(result.inschrijfadvies)
  const hoogGebieden = result.risicogebieden?.filter(g => g.score === 'Hoog').length ?? 0
  const middelGebieden = result.risicogebieden?.filter(g => g.score === 'Middel').length ?? 0
  const alleRisicos = result.risicogebieden?.flatMap(g => g.risicos) ?? []
  const aantalRisicos = alleRisicos.length
  const aantalHoog = alleRisicos.filter(r => r.ernstscore === 'Hoog').length

  return (
    <RisicoCitationModalLayer tenderId={aanbestedingId}>
    <div className="space-y-5 risico-report risico-print-root">
      {(analyzing || risicoBusy) && (
        <ProgressBar step={displayStep} percentage={displayPct} agent={displayAgent || undefined} />
      )}

      {inRisicoWachtrij && !risicoBusy && !analyzing && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
          <Info className="h-4 w-4 flex-shrink-0" />
          Heranalyse staat in de wachtrij (positie {risicoWachtrijPositie}).
        </div>
      )}

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">Risico Inventarisatie</h2>
          {risicoAnalyseAt && (
            <p className="text-xs text-[var(--muted-foreground)]">
              Geanalyseerd op {new Date(risicoAnalyseAt).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleAnalyse}
          disabled={analyzing || risicoBusy || inRisicoWachtrij}
          title="Vervangt de huidige risico-inventarisatie door een volledig nieuwe analyse (alleen op jouw actie)"
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {inRisicoWachtrij ? `Wachtrij ${risicoWachtrijPositie}` : 'Nieuwe risico'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Management summary card */}
      <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
        <div className="flex items-start gap-5">
          <OverallScoreRing score={result.overall_score} />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-[var(--foreground)]">Overall risicoscore</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${scoreBadgeClass(result.overall_score)}`}>
                {result.overall_score}
              </span>
              <span className={`rounded-lg px-2.5 py-0.5 text-[11px] font-semibold ${advies.cls}`}>
                {advies.label}
              </span>
            </div>
            <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
              <LinkedCitationText text={result.overall_toelichting} />
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted-foreground)]">
              <span><strong className="text-[var(--foreground)]">{result.risicogebieden?.length ?? 0}</strong> risicogebieden</span>
              <span><strong className="text-[var(--foreground)]">{aantalRisicos}</strong> risico's totaal</span>
              {aantalHoog > 0 && <span className="text-red-600 font-medium">{aantalHoog} hoog-risico</span>}
              {hoogGebieden > 0 && <span className="text-red-600">{hoogGebieden} gebied{hoogGebieden > 1 ? 'en' : ''} hoog</span>}
              {middelGebieden > 0 && <span className="text-amber-600">{middelGebieden} gebied{middelGebieden > 1 ? 'en' : ''} middel</span>}
            </div>
          </div>
        </div>

        {/* Management samenvatting */}
        {result.management_samenvatting && (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Management samenvatting</p>
            <p className="text-sm text-[var(--foreground)] leading-relaxed">
              <LinkedCitationText text={result.management_samenvatting} />
            </p>
          </div>
        )}
      </div>

      {/* Top 5 risico's */}
      {result.top5_risicos?.length > 0 && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <ShieldX className="h-4 w-4 text-red-500" />
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Top 5 zwaarste risico's</h3>
          </div>
          <ol className="space-y-2">
            {result.top5_risicos.map((r, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-100 text-[11px] font-bold text-red-700">{i + 1}</span>
                <span className="text-sm text-[var(--foreground)] leading-relaxed">
                  <LinkedCitationText text={r} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Kernbevindingen */}
      {result.kernbevindingen &&
        (result.kernbevindingen.procedureel ||
          result.kernbevindingen.juridisch ||
          result.kernbevindingen.commercieel ||
          result.kernbevindingen.uitvoering) && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[var(--primary)]" />
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Kernbevindingen</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Procedureel', text: result.kernbevindingen.procedureel },
              { label: 'Juridisch', text: result.kernbevindingen.juridisch },
              { label: 'Commercieel', text: result.kernbevindingen.commercieel },
              { label: 'Uitvoering', text: result.kernbevindingen.uitvoering },
            ].map(
              (k) =>
                k.text?.trim() && (
                  <div key={k.label} className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{k.label}</p>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                      <LinkedCitationText text={k.text} />
                    </p>
                  </div>
                ),
            )}
          </div>
        </div>
      )}

      {/* Risicogebieden */}
      {result.risicogebieden?.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <ShieldAlert className="h-4 w-4 text-[var(--primary)]" />
            Risicoanalyse per gebied
          </h3>
          {result.risicogebieden.map((gebied, idx) => (
            <GebiedSection key={idx} gebied={gebied} />
          ))}
        </div>
      )}

      {/* No-go factoren */}
      {result.no_go_factoren?.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/40 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldX className="h-4 w-4 text-red-600" />
            <h3 className="text-sm font-semibold text-red-700">No-go / Dealbreakers</h3>
          </div>
          <ul className="space-y-1.5">
            {result.no_go_factoren.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-red-800">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
                <LinkedCitationText text={f} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tegenstrijdigheden */}
      {result.tegenstrijdigheden?.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageSquareWarning className="h-4 w-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-amber-700">Tegenstrijdigheden, leemtes en onzekerheden</h3>
            </div>
            <button
              type="button"
              onClick={() => {
                const agent = useAgentStore.getState()
                agent.setActiveTender(aanbestedingId)
                agent.setPanelOpen(true)
                const lijst = (result.tegenstrijdigheden ?? []).map((t, idx) => `${idx + 1}. ${t}`).join('\n')
                agent.setPendingUserInput(
                  `Bekijk de volgende tegenstrijdigheden en leemtes in deze aanbesteding en geef per punt een korte actie/advies:\n\n${lijst}`
                )
              }}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
            >
              Bespreek met agent
            </button>
          </div>
          <ul className="space-y-1.5">
            {result.tegenstrijdigheden.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                <LinkedCitationText text={t} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Wetsartikelen / beginselen */}
      {result.wetsartikelen_bijlage && result.wetsartikelen_bijlage.length > 0 && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Scale className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Wetsartikelen en beginselen (bijlage)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                  <th className="pb-2 pr-3 text-left font-medium">Artikel / beginsel</th>
                  <th className="pb-2 pr-3 text-left font-medium">Korte inhoud</th>
                  <th className="pb-2 pr-3 text-left font-medium">Toegepast bij</th>
                  <th className="pb-2 pr-3 text-left font-medium">Relevantie</th>
                  <th className="pb-2 text-left font-medium">Bron</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {result.wetsartikelen_bijlage.map((w, i) => (
                  <tr key={i} className="text-[var(--foreground)] align-top">
                    <td className="py-2 pr-3 font-medium">
                      <LinkedCitationText text={w.artikel_of_beginsel} />
                    </td>
                    <td className="py-2 pr-3 text-[var(--muted-foreground)]">
                      <LinkedCitationText text={w.korte_inhoud} />
                    </td>
                    <td className="py-2 pr-3">
                      <LinkedCitationText text={w.toegepast_bij_risico} />
                    </td>
                    <td className="py-2 pr-3 text-[var(--muted-foreground)]">
                      <LinkedCitationText text={w.relevantie} />
                    </td>
                    <td className="py-2">
                      {w.bron_url ? (
                        <CitedSourceButton url={w.bron_url} />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vragen voor NvI */}
      {result.vragen_nvi?.length > 0 && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-blue-500" />
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Vragen voor de nota van inlichtingen</h3>
          </div>
          <div className="space-y-3">
            {result.vragen_nvi.map((v, i) => (
              <div key={i} className="rounded-lg border border-blue-100 bg-blue-50/30 p-3 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                  <LinkedCitationText text={v.doel} />
                </p>
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  Bron: <LinkedCitationText text={v.bron} />
                </p>
                <p className="text-sm text-[var(--foreground)]">
                  <LinkedCitationText text={v.formulering} />
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Document inventarisatie */}
      {result.document_inventarisatie?.length > 0 && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-[var(--muted-foreground)]" />
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Geanalyseerde documenten</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                  <th className="pb-2 pr-4 text-left font-medium">Document</th>
                  <th className="pb-2 pr-4 text-left font-medium">Versie/datum</th>
                  <th className="pb-2 pr-4 text-left font-medium">Rol</th>
                  <th className="pb-2 text-left font-medium">Opmerkingen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {result.document_inventarisatie.map((d, i) => (
                  <tr key={i} className="text-[var(--foreground)]">
                    <td className="py-1.5 pr-4 font-medium">{d.naam}</td>
                    <td className="py-1.5 pr-4 text-[var(--muted-foreground)]">{d.versie || '—'}</td>
                    <td className="py-1.5 pr-4">{d.rol}</td>
                    <td className="py-1.5 text-[var(--muted-foreground)]">
                      {d.opmerkingen ? <LinkedCitationText text={d.opmerkingen} /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Herhaal heranalyse onderaan voor gemak */}
      <div className="flex justify-center pb-2">
        <button
          onClick={handleAnalyse}
          disabled={analyzing || risicoBusy || inRisicoWachtrij}
          className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          {inRisicoWachtrij ? `In wachtrij (nr. ${risicoWachtrijPositie})` : 'Heranalyse uitvoeren'}
        </button>
      </div>
    </div>
    </RisicoCitationModalLayer>
  )
}
