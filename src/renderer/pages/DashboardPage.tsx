import { useNavigate } from 'react-router-dom'
import { useDashboardStats, useAsyncData } from '../hooks/use-ipc'
import { api } from '../lib/ipc-client'
import { formatDate, getStatusLabel, getStatusColor, daysUntil } from '../lib/utils'
import {
  FileSearch, TrendingUp, Clock, AlertTriangle, BarChart3,
  ArrowRight, CalendarDays,
  FileText, FileCheck, MessageSquare, Send, Eye, UserCheck, Archive, PenSquare,
} from 'lucide-react'

const PIPELINE_STEPS = [
  { icon: FileText,      label: 'Publicatie',   tooltip: 'Publicatiegegevens & tijdslijn',        tab: 'overzicht' },
  { icon: FileCheck,     label: 'Documenten',   tooltip: 'Aanbestedingsdocumenten & bijlagen',    tab: 'overzicht' },
  { icon: MessageSquare, label: 'Vragen',        tooltip: 'Nota van inlichtingen & Q&A',          tab: 'inschrijving' },
  { icon: Send,          label: 'Inschrijving',  tooltip: 'Indieningsvereisten & procedure',      tab: 'inschrijving' },
  { icon: Eye,           label: 'Beoordeling',   tooltip: 'Gunningscriteria & risico-analyse',    tab: 'risico' },
  { icon: UserCheck,     label: 'Gunning',       tooltip: 'Gunningsbeslissing & uitkomst',        tab: 'inschrijving' },
  { icon: Archive,       label: 'Archief',       tooltip: 'Gearchiveerde aanbesteding',           tab: 'overzicht' },
  { icon: PenSquare,     label: 'Afgerond',      tooltip: 'Afgeronde aanbesteding',               tab: 'overzicht' },
]

function getActiveStep(status: string): number {
  switch (status) {
    case 'gevonden':       return 0
    case 'gekwalificeerd': return 5
    case 'in_aanbieding':  return 3
    case 'afgewezen':      return 6
    case 'gearchiveerd':   return 6
    default:               return 0
  }
}


function getCountryFlag(naam?: string, url?: string): string {
  const s = ((naam ?? '') + ' ' + (url ?? '')).toLowerCase()
  if (s.includes('.be') || s.includes('belgi') || s.includes('publicprocurement') || s.includes('e-procurement.be')) return '🇧🇪'
  if (
    s.includes('.nl') || s.includes('nederland') ||
    s.includes('tenderned') || s.includes('aanbesteding') ||
    s.includes('negometrix') || s.includes('mercell.nl') ||
    s.includes('tenderportal') || s.includes('pianoo')
  ) return '🇳🇱'
  if (s.includes('.de') || s.includes('deutsch')) return '🇩🇪'
  if (s.includes('.fr') || s.includes('france')) return '🇫🇷'
  return ''
}

export function DashboardPage() {
  const { data: stats, loading: statsLoading } = useDashboardStats()
  const { data: recentTenders } = useAsyncData(
    () => api.getTenders({ limit: 8 }),
    []
  )

  const navigate = useNavigate()

  const kpis = [
    {
      label: 'Totaal aanbestedingen',
      value: stats?.totaalAanbestedingen ?? 0,
      icon: FileSearch,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      filter: 'all',
    },
    {
      label: 'Actieve aanbestedingen',
      value: stats?.actieveAanbestedingen ?? 0,
      icon: TrendingUp,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      filter: 'active',
    },
    {
      label: 'Gevonden vandaag',
      value: stats?.gevondenVandaag ?? 0,
      icon: Clock,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      filter: 'today',
    },
    {
      label: 'Urgente deadlines',
      value: stats?.urgentDeadlines ?? 0,
      icon: AlertTriangle,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      filter: 'urgent',
    },
  ]

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <button
            key={kpi.label}
            onClick={() => navigate(`/aanbestedingen?filter=${kpi.filter}`)}
            className="rounded-xl border bg-[var(--card)] p-5 shadow-sm hover:shadow-md hover:border-[var(--primary)]/30 transition-all text-left cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">{kpi.label}</p>
                <p className="mt-1 text-3xl font-bold text-[var(--foreground)]">
                  {statsLoading ? '...' : kpi.value}
                </p>
              </div>
              <div className={`rounded-xl p-3 ${kpi.bgColor}`}>
                <kpi.icon className={`h-6 w-6 ${kpi.color}`} />
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Average Score */}
      {stats && stats.gemiddeldeScore > 0 && (
        <div className="rounded-xl border bg-[var(--card)] p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-3">
              <BarChart3 className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm text-[var(--muted-foreground)]">Gemiddelde relevantiescore</p>
              <p className="text-2xl font-bold text-[var(--foreground)]">
                {Math.round(stats.gemiddeldeScore)}%
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Recent Tenders */}
      <div className="rounded-xl border bg-[var(--card)] shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-base font-semibold text-[var(--foreground)]">Recente aanbestedingen</h3>
          <button
            onClick={() => navigate('/aanbestedingen')}
            className="flex items-center gap-1 text-sm text-[var(--primary)] hover:underline"
          >
            Bekijk alle <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <div className="divide-y">
          {!recentTenders || (recentTenders as any[]).length === 0 ? (
            <div className="px-5 py-12 text-center">
              <FileSearch className="mx-auto h-12 w-12 text-[var(--muted-foreground)]/30" />
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                Nog geen aanbestedingen gevonden. Start tracking om te beginnen.
              </p>
              <button
                onClick={() => navigate('/tracking')}
                className="mt-6 group flex flex-col items-center gap-3 rounded-2xl bg-[#0f1729] px-8 py-5 shadow-lg transition-all duration-200 hover:shadow-[0_0_24px_rgba(234,0,41,0.25)] hover:scale-[1.03] active:scale-[0.97]"
              >
                {/* VDK logo — 3 rode hexagonen */}
                <div className="flex flex-col items-center gap-1.5">
                  <div className="h-4 w-4 rotate-45 bg-[#ea0029] shadow-[0_0_6px_rgba(234,0,41,0.6)]" />
                  <div className="flex gap-1.5">
                    <div className="h-4 w-4 rotate-45 bg-[#ea0029] shadow-[0_0_6px_rgba(234,0,41,0.6)]" />
                    <div className="h-4 w-4 rotate-45 bg-[#ea0029] shadow-[0_0_6px_rgba(234,0,41,0.6)]" />
                  </div>
                </div>
                <span className="text-sm font-semibold tracking-wide text-white/90 group-hover:text-white transition-colors">
                  Start tracking
                </span>
              </button>
            </div>
          ) : (
            (recentTenders as any[]).map((tender: any) => {
              const days = daysUntil(tender.sluitingsdatum)
              const activeStep = getActiveStep(tender.status)
              const flag = getCountryFlag(tender.bron_website_naam, tender.bron_url)
              const scoreDisplay = tender.totaal_score != null
                ? Math.round(tender.totaal_score)
                : Array.isArray(tender.document_urls) ? tender.document_urls.length : null
              return (
                <div
                  key={tender.id}
                  onClick={() => navigate(`/aanbestedingen/${tender.id}`)}
                  className="flex w-full min-h-[80px] text-left hover:bg-[var(--muted)]/40 transition-colors overflow-hidden cursor-pointer"
                >
                  {/* Left panel */}
                  <div className="w-[180px] flex-shrink-0 border-r border-[var(--border)] px-4 py-3 flex flex-col justify-between">
                    <div className="flex items-center gap-1.5">
                      {flag && <span className="text-sm leading-none">{flag}</span>}
                      <span className="text-xs font-semibold text-[var(--foreground)] line-clamp-2 leading-snug">
                        {tender.opdrachtgever || 'Onbekend'}
                      </span>
                    </div>
                    <div className="mt-1.5 space-y-0.5">
                      {tender.publicatiedatum && (
                        <div className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                          <CalendarDays className="h-2.5 w-2.5 flex-shrink-0" />
                          <span>{formatDate(tender.publicatiedatum)}</span>
                        </div>
                      )}
                      {tender.sluitingsdatum && (
                        <div className={`flex items-center gap-1 text-[10px] ${days != null && days <= 7 ? 'text-red-500 font-medium' : 'text-[var(--muted-foreground)]'}`}>
                          <CalendarDays className={`h-2.5 w-2.5 flex-shrink-0 ${days != null && days >= 0 && days <= 7 ? 'animate-deadline-blink text-red-500' : ''}`} />
                          <span className={days != null && days >= 0 && days <= 7 ? 'animate-deadline-blink' : ''}>
                            {formatDate(tender.sluitingsdatum)}
                            {days != null && days > 0 && days <= 30 && ` (${days}d)`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right panel — title + pipeline */}
                  <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-between">
                    <p className="text-sm font-semibold text-[var(--foreground)] line-clamp-2 leading-snug">
                      {tender.titel}
                    </p>

                    {/* Mini pipeline — elke stap klikbaar */}
                    <div className="mt-2 flex items-center">
                      {PIPELINE_STEPS.map((step, idx) => {
                        const StepIcon = step.icon
                        const isActive = idx === activeStep
                        const isPast = idx < activeStep
                        const isLast = idx === PIPELINE_STEPS.length - 1
                        return (
                          <div key={idx} className="flex items-center flex-1 last:flex-none">
                            <div className="relative flex-shrink-0 group">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  navigate(`/aanbestedingen/${tender.id}?tab=${step.tab}`)
                                }}
                                className={[
                                  'h-6 w-6 rounded-full border-2 flex items-center justify-center transition-all',
                                  'hover:scale-110 hover:shadow-sm',
                                  isActive
                                    ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                                    : isPast
                                      ? 'border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]'
                                      : 'border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]',
                                ].join(' ')}
                              >
                                <StepIcon className="h-3 w-3" />
                              </button>
                              {isActive && scoreDisplay != null && (
                                <span className={[
                                  'absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center px-0.5 leading-none pointer-events-none',
                                  tender.totaal_score != null && tender.totaal_score >= 70 ? 'bg-green-500 text-white' :
                                  tender.totaal_score != null && tender.totaal_score >= 40 ? 'bg-yellow-500 text-white' :
                                  tender.totaal_score != null ? 'bg-red-500 text-white' :
                                  'bg-[var(--primary)] text-[var(--primary-foreground)]',
                                ].join(' ')}>
                                  {scoreDisplay}
                                </span>
                              )}
                              {/* Tooltip */}
                              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 hidden group-hover:block">
                                <div className="rounded-md bg-gray-900 px-2 py-1 text-[10px] text-white whitespace-nowrap shadow-lg">
                                  <span className="font-semibold">{step.label}</span>
                                  <span className="text-gray-300"> — {step.tooltip}</span>
                                </div>
                                <div className="mx-auto mt-0.5 h-1.5 w-1.5 rotate-45 bg-gray-900" />
                              </div>
                            </div>
                            {!isLast && (
                              <div className={[
                                'h-[2px] flex-1 mx-0.5',
                                isPast || isActive ? 'bg-[var(--primary)]/30' : 'border-t-2 border-dashed border-[var(--border)]',
                              ].join(' ')} style={isPast || isActive ? {} : { background: 'none' }} />
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Bottom meta */}
                    <div className="mt-2 flex items-center gap-3 border-t border-[var(--border)]/40 pt-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getStatusColor(tender.status)}`}>
                        {getStatusLabel(tender.status)}
                      </span>
                      <span className="text-[10px] text-[var(--muted-foreground)]">
                        {PIPELINE_STEPS[activeStep]?.label}
                      </span>
                      {tender.bron_website_naam && (
                        <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[9px] text-[var(--muted-foreground)]">
                          {tender.bron_website_naam}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
