import { useEffect, useRef, useState } from 'react'
import { Lock, ShieldAlert } from 'lucide-react'

const SESSION_KEY_SETTINGS = 'settings_pin_unlocked'
const SESSION_KEY_RELEASE = 'tt_release_admin_pin'
const PIN_LENGTH = 5

function correctPinForVariant(variant: 'settings' | 'release'): string | undefined {
  if (variant === 'release') {
    const r = (import.meta.env.VITE_RELEASE_ADMIN_PIN as string | undefined)?.trim()
    const s = (import.meta.env.VITE_SETTINGS_PIN as string | undefined)?.trim()
    return r || s
  }
  return (import.meta.env.VITE_SETTINGS_PIN as string | undefined)?.trim()
}

type Props = {
  onUnlocked: () => void
  onCancel: () => void
  /** release = aparte sessie voor versiebeheer; gebruikt VITE_RELEASE_ADMIN_PIN of anders VITE_SETTINGS_PIN */
  variant?: 'settings' | 'release'
}

export function SettingsPinModal({ onUnlocked, onCancel, variant = 'settings' }: Props) {
  const [digits, setDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''))
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  function handleChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    setError(false)

    const next = [...digits]
    next[index] = digit
    setDigits(next)

    if (digit && index < PIN_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }

    if (digit && index === PIN_LENGTH - 1) {
      const pin = [...next].join('')
      if (next.every((d) => d !== '')) {
        verify([...next])
      }
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        const next = [...digits]
        next[index] = ''
        setDigits(next)
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus()
        const next = [...digits]
        next[index - 1] = ''
        setDigits(next)
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < PIN_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    } else if (e.key === 'Enter') {
      const pin = digits.join('')
      if (pin.length === PIN_LENGTH) verify(digits)
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH)
    if (!pasted) return
    const next = Array(PIN_LENGTH).fill('')
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]
    setDigits(next)
    setError(false)
    const nextFocus = Math.min(pasted.length, PIN_LENGTH - 1)
    inputRefs.current[nextFocus]?.focus()
    if (pasted.length === PIN_LENGTH) verify(next)
  }

  function verify(d: string[]) {
    const pin = d.join('')
    const CORRECT_PIN = correctPinForVariant(variant)
    if (pin === CORRECT_PIN || (!CORRECT_PIN && pin.length === PIN_LENGTH)) {
      sessionStorage.setItem(variant === 'release' ? SESSION_KEY_RELEASE : SESSION_KEY_SETTINGS, '1')
      onUnlocked()
    } else {
      setError(true)
      setShake(true)
      setTimeout(() => setShake(false), 600)
      setDigits(Array(PIN_LENGTH).fill(''))
      setTimeout(() => inputRefs.current[0]?.focus(), 20)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm rounded-2xl border bg-[var(--card)] p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon + title */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary)]/10">
            <Lock className="h-7 w-7 text-[var(--primary)]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              {variant === 'release' ? 'Versiebeheer (admin)' : 'Toegang tot instellingen'}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {variant === 'release'
                ? 'Voer de admincode in (zelfde als bij instellingen, tenzij een aparte release-code is ingesteld).'
                : 'Voer de 5-cijferige superadmin code in'}
            </p>
          </div>
        </div>

        {/* PIN boxes */}
        <div
          className={`flex justify-center gap-3 transition-transform ${shake ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}
          onPaste={handlePaste}
        >
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digits[i]}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className={[
                'h-14 w-12 rounded-xl border-2 text-center text-2xl font-bold',
                'bg-[var(--background)] text-[var(--foreground)]',
                'outline-none transition-all duration-150',
                'focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20',
                error
                  ? 'border-red-500 bg-red-50/10 text-red-500'
                  : digits[i]
                  ? 'border-[var(--primary)]/60 bg-[var(--primary)]/5'
                  : 'border-[var(--border)]',
              ].join(' ')}
              aria-label={`Cijfer ${i + 1}`}
              autoComplete="off"
            />
          ))}
        </div>

        {/* Error message */}
        <div className={`mt-4 flex items-center justify-center gap-1.5 text-sm text-red-500 transition-opacity ${error ? 'opacity-100' : 'opacity-0'}`}>
          <ShieldAlert className="h-4 w-4" />
          <span>Onjuiste code. Probeer opnieuw.</span>
        </div>

        {/* Cancel */}
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-5 py-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            Annuleren
          </button>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          15%       { transform: translateX(-6px); }
          30%       { transform: translateX(6px); }
          45%       { transform: translateX(-5px); }
          60%       { transform: translateX(5px); }
          75%       { transform: translateX(-3px); }
          90%       { transform: translateX(3px); }
        }
      `}</style>
    </div>
  )
}

/** Returns true if the current session already passed the PIN check. */
export function isSettingsPinUnlocked(): boolean {
  return sessionStorage.getItem(SESSION_KEY_SETTINGS) === '1'
}

/** Aparte sessie voor het tabblad Versiebeheer. */
export function isReleaseAdminPinUnlocked(): boolean {
  return sessionStorage.getItem(SESSION_KEY_RELEASE) === '1'
}
