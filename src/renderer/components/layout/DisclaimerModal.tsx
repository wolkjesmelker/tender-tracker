import { useState } from 'react'
import { ShieldAlert, X, CheckSquare, Square } from 'lucide-react'

const STORAGE_KEY = 'questric_disclaimer_v1_accepted'

export function isDisclaimerAccepted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

interface Props {
  onAccept: () => void
  onDecline: () => void
}

export function DisclaimerModal({ onAccept, onDecline }: Props) {
  const [checkedAi, setCheckedAi] = useState(false)
  const [checkedCosts, setCheckedCosts] = useState(false)
  const [checkedLiability, setCheckedLiability] = useState(false)

  const allChecked = checkedAi && checkedCosts && checkedLiability

  const handleAccept = () => {
    if (!allChecked) return
    try {
      localStorage.setItem(STORAGE_KEY, 'true')
    } catch { /* ignore */ }
    onAccept()
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative mx-4 w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0f1729] text-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#ea0029]/15">
            <ShieldAlert className="h-5 w-5 text-[#ea0029]" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight">Algemene voorwaarden</h2>
            <p className="text-[11px] text-white/50">
              Lees en accepteer de voorwaarden voor gebruik van TenderTracker
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-3 px-5 py-4">

          {/* Intro */}
          <p className="text-xs leading-relaxed text-white/70">
            TenderTracker is een AI-ondersteund hulpmiddel voor aanbestedingsmonitoring,
            ontwikkeld door <strong className="text-white">Questric</strong> voor
            Van de Kreeke Groep. Voordat u de applicatie gebruikt, vragen wij u
            kennis te nemen van de volgende voorwaarden.
          </p>

          {/* Checkboxes */}
          <div className="space-y-2">

            <button
              onClick={() => setCheckedAi(!checkedAi)}
              className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-white/10 px-3.5 py-3 text-left transition-colors hover:border-white/20 hover:bg-white/5"
            >
              {checkedAi
                ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-[#ea0029]" />
                : <Square className="mt-0.5 h-4 w-4 shrink-0 text-white/30" />
              }
              <span className="text-xs leading-relaxed text-white/80">
                <strong className="text-white">AI geeft geen garanties.</strong>{' '}
                Ik begrijp dat de uitkomsten van TenderTracker uitsluitend dienen als hulpmiddel.
                AI-modellen kunnen fouten maken, informatie onjuist interpreteren of relevante
                zaken over het hoofd zien. Alle resultaten dienen door een vakbekwame professional
                te worden gecontroleerd alvorens beslissingen te nemen.
              </span>
            </button>

            <button
              onClick={() => setCheckedCosts(!checkedCosts)}
              className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-white/10 px-3.5 py-3 text-left transition-colors hover:border-white/20 hover:bg-white/5"
            >
              {checkedCosts
                ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-[#ea0029]" />
                : <Square className="mt-0.5 h-4 w-4 shrink-0 text-white/30" />
              }
              <span className="text-xs leading-relaxed text-white/80">
                <strong className="text-white">AI-gebruik kost geld (tokens).</strong>{' '}
                Ik begrijp dat elke analyse, inclusief risico-inventarisaties en vraagbeantwoording,
                API-tokens verbruikt bij de geconfigureerde AI-provider (OpenAI, Anthropic, Moonshot e.a.).
                Bij grote dossiers of intensief gebruik kunnen de kosten aanzienlijk oplopen.
                De gebruiker is zelf verantwoordelijk voor de hierdoor ontstane kosten bij zijn of haar
                API-provider.
              </span>
            </button>

            <button
              onClick={() => setCheckedLiability(!checkedLiability)}
              className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-white/10 px-3.5 py-3 text-left transition-colors hover:border-white/20 hover:bg-white/5"
            >
              {checkedLiability
                ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-[#ea0029]" />
                : <Square className="mt-0.5 h-4 w-4 shrink-0 text-white/30" />
              }
              <span className="text-xs leading-relaxed text-white/80">
                <strong className="text-white">Beperking aansprakelijkheid Questric.</strong>{' '}
                Ik aanvaard dat Questric geen enkele aansprakelijkheid accepteert voor schade,
                verlies of nadeel voortvloeiend uit het gebruik van deze software, onjuiste
                AI-uitkomsten, misgelopen opdrachten of beslissingen genomen op basis van de
                door TenderTracker gegenereerde informatie.
              </span>
            </button>
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3.5">
          <button
            onClick={onDecline}
            className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white/80"
          >
            <X className="h-3.5 w-3.5" />
            Weigeren (app sluiten)
          </button>

          <button
            onClick={handleAccept}
            disabled={!allChecked}
            className={[
              'flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-semibold transition-all',
              allChecked
                ? 'bg-[#ea0029] text-white shadow-lg hover:bg-[#c8001f] active:scale-95'
                : 'cursor-not-allowed bg-white/10 text-white/30',
            ].join(' ')}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            Accepteren en doorgaan
          </button>
        </div>

        {/* Copyright */}
        <div className="border-t border-white/5 px-5 py-2.5 text-center text-[10px] text-white/25">
          © {new Date().getFullYear()} Questric · TenderTracker · Alle rechten voorbehouden
        </div>
      </div>
    </div>
  )
}
