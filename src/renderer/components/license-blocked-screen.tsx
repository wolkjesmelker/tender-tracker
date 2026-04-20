import { useState } from 'react'
import type { LicenseStatus } from '@shared/types'
import { Loader2 } from 'lucide-react'
import { api } from '../lib/ipc-client'
import questricLogo from '../assets/questric-logo.png'

export function LicenseBlockedScreen({ initial }: { initial: LicenseStatus }) {
  const [status, setStatus] = useState(initial)
  const [retrying, setRetrying] = useState(false)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--background)] px-6 py-12">
      <img src={questricLogo} alt="Questric" className="mb-8 h-6 w-auto max-w-[140px] object-contain drop-shadow-sm" />
      <div className="max-w-md rounded-xl border border-red-200 bg-red-50/80 p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-red-900">Licentie / installatie</h1>
        <p className="mt-3 text-sm leading-relaxed text-red-800">
          {status.message ||
            'Deze installatie is niet toegestaan onder de huidige licentie (bijv. maximum aantal computers).'}
        </p>
        {status.maxSeats != null && status.usedSeats != null && (
          <p className="mt-2 text-xs text-red-700">
            Seats: {status.usedSeats} / {status.maxSeats}
          </p>
        )}
        <button
          type="button"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true)
            try {
              const s = await api.refreshLicense?.()
              if (s) {
                if (s.ok) {
                  window.location.reload()
                  return
                }
                setStatus(s)
              }
            } finally {
              setRetrying(false)
            }
          }}
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-50 disabled:opacity-50"
        >
          {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Opnieuw verifiëren
        </button>
      </div>
      <p className="mt-8 max-w-lg text-center text-[11px] text-[var(--muted-foreground)]">
        © Questric. Deze software mag niet zonder schriftelijke toestemming worden gekopieerd of verspreid.
      </p>
    </div>
  )
}
