import React from 'react'
import { X, Sparkles, Zap, BrainCircuit, Bot, CheckCircle2, Star, Network } from 'lucide-react'

export interface RisicoModelOption {
  id: string
  label: string
  badge: string
  description: string
  note?: string
  icon: React.ElementType
  isDefault?: boolean
  recommended?: boolean
  isAgentic?: boolean
}

export const RISICO_MODEL_OPTIONS: RisicoModelOption[] = [
  {
    id: 'agentic',
    label: 'Agentic (19 agents)',
    badge: 'Nieuw',
    description: 'Volledige analyse via 19 gespecialiseerde agents met bronplicht-validatie en parallelle verwerking. Stage 1: documenten inlezen · Stage 2: 11 domeinagenten parallel · Stage 3: synthese · Stage 4: gatekeeper + eindrapport. Veel diepgaander dan enkelvoudige analyse.',
    note: '~6 min',
    icon: Network,
    isAgentic: true,
    recommended: false,
  },
  {
    id: 'default',
    label: 'Standaard (Kimi K2 / hoofd-AI)',
    badge: 'Standaard',
    description: 'Gebruikt de geconfigureerde AI-provider (Kimi K2 met fallback naar hoofd-AI). Ideaal als nieuwe documenten zijn toegevoegd en je dezelfde kwaliteit wilt als de eerste analyse.',
    icon: Bot,
    isDefault: true,
  },
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    badge: 'Anthropic',
    description: 'Diepste juridische redenering, sterkste in complexe aanbestedingsdocumenten en Nederlandse juridische nuances. Aanbevolen voor dossiers met tegenstrijdige clausules of hoge contractwaarde.',
    note: 'Aanbevolen',
    icon: Star,
    recommended: true,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    badge: 'Anthropic',
    description: 'Uitstekende balans: sneller dan Opus, maar nog steeds superieur in juridisch taalgevoel. Al de standaard hoofd-AI in deze app bij Claude-configuratie.',
    icon: BrainCircuit,
    recommended: true,
  },
  {
    id: 'o3',
    label: 'o3',
    badge: 'OpenAI',
    description: 'Diepste stapsgewijze redenering van OpenAI. Sterk bij wiskundig-logische clausules, gunningscriteria en tegenstrijdige specificaties.',
    note: 'Traag (5–10 min)',
    icon: Zap,
  },
  {
    id: 'o4-mini',
    label: 'o4-mini',
    badge: 'OpenAI',
    description: 'Efficiënt redeneermodel — bijna even nauwkeurig als o3, maar aanzienlijk sneller en goedkoper.',
    icon: Sparkles,
  },
  {
    id: 'gpt-4.1',
    label: 'gpt-4.1',
    badge: 'OpenAI',
    description: 'Meest recente standaard GPT-model met sterke instructieopvolging en brede kennisbasis.',
    icon: CheckCircle2,
  },
  {
    id: 'gpt-4o',
    label: 'gpt-4o',
    badge: 'OpenAI',
    description: 'Betrouwbaar en bewezen model voor complexe analyses. Goede balans tussen snelheid en kwaliteit.',
    icon: CheckCircle2,
  },
]

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (modelId: string) => void
}

const BADGE_STYLE: Record<string, string> = {
  OpenAI:
    'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-300/60 dark:ring-emerald-600/40',
  Anthropic:
    'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300/60 dark:ring-violet-600/40',
  Standaard:
    'bg-[var(--muted)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]',
  Nieuw:
    'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300/60 dark:ring-blue-600/40',
}

const NOTE_STYLE: Record<string, string> = {
  'Aanbevolen': 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300/60 dark:ring-violet-600/40',
  'Traag (5–10 min)': 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300/60 dark:ring-amber-600/40',
  '~6 min': 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300/60 dark:ring-blue-600/40',
}

export function RisicoModelPickerModal({ open, onClose, onSelect }: Props) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="risico-model-picker-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        style={{ maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] bg-[var(--muted)]/25 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Risico-heranalyse
            </p>
            <h2
              id="risico-model-picker-title"
              className="mt-0.5 text-base font-semibold text-[var(--foreground)]"
            >
              Kies AI-model
            </h2>
            <p className="mt-1 text-xs leading-snug text-[var(--muted-foreground)]">
              Het gekozen model wordt alleen voor deze ene run gebruikt. Alle documenten (inclusief nieuw toegevoegde) worden meegenomen.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            aria-label="Sluiten"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Model list */}
        <div className="flex flex-col gap-2 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]">
          {RISICO_MODEL_OPTIONS.map((opt) => {
            const Icon = opt.icon
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSelect(opt.id)}
                className={`group flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-all hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                  opt.isAgentic
                    ? 'border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-950/20 hover:border-blue-400/60 dark:hover:border-blue-600/60 hover:bg-blue-50 dark:hover:bg-blue-950/30'
                    : opt.isDefault
                    ? 'border-[var(--border)] bg-[var(--muted)]/30 hover:bg-[var(--muted)]/60'
                    : opt.recommended
                      ? 'border-violet-200 dark:border-violet-800/50 bg-violet-50/50 dark:bg-violet-950/20 hover:border-violet-400/60 dark:hover:border-violet-600/60 hover:bg-violet-50 dark:hover:bg-violet-950/30'
                      : 'border-[var(--border)] bg-gradient-to-br from-[var(--muted)]/20 to-[var(--card)] hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/5'
                }`}
              >
                <div
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${
                    opt.isAgentic
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 ring-blue-200 dark:ring-blue-700/50'
                      : opt.isDefault
                      ? 'bg-[var(--muted)] text-[var(--muted-foreground)] ring-[var(--border)]'
                      : opt.recommended
                        ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 ring-violet-200 dark:ring-violet-700/50'
                        : 'bg-[var(--primary)]/10 text-[var(--primary)] ring-[var(--primary)]/20 group-hover:bg-[var(--primary)]/15'
                  }`}
                  aria-hidden
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-[var(--foreground)]">{opt.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE_STYLE[opt.badge] ?? BADGE_STYLE['Standaard']}`}
                    >
                      {opt.badge}
                    </span>
                    {opt.note && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${NOTE_STYLE[opt.note] ?? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300/60'}`}>
                        {opt.note}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-snug text-[var(--muted-foreground)]">
                    {opt.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer note */}
        <div className="shrink-0 border-t border-[var(--border)] bg-[var(--muted)]/20 px-5 py-3">
          <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">
            <strong>Anthropic-modellen</strong> gebruiken je Claude API-sleutel (Instellingen → AI-provider → Claude).{' '}
            <strong>OpenAI-modellen</strong> vereisen een OpenAI API-sleutel.
          </p>
        </div>
      </div>
    </div>
  )
}
