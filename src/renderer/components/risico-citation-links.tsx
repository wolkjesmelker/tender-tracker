import React, { createContext, useCallback, useContext, useState } from 'react'
import { BronPageEmbedModal } from './bron-page-embed'

const OpenCitationContext = createContext<(url: string, title?: string) => void>(() => {})

/** Verwijdert leestekens die vaak per ongeluk aan een URL plakt. */
export function trimTrailingUrlPunctuation(url: string): string {
  return url.replace(/[.,;:!?)\\\]}]+$/u, '')
}

const URL_IN_TEXT_RE = /(https?:\/\/[^\s\[\]()<>"']+)/gi

export function LinkedCitationText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const openCitation = useContext(OpenCitationContext)
  if (!text) return null
  const parts = text.split(URL_IN_TEXT_RE)
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (/^https?:\/\//i.test(part)) {
          const raw = trimTrailingUrlPunctuation(part)
          const trailing = part.slice(raw.length)
          const label = raw.replace(/^https?:\/\//i, '')
          return (
            <React.Fragment key={`${i}-${raw.slice(0, 24)}`}>
              <button
                type="button"
                onClick={() => openCitation(raw, 'Geciteerde bron')}
                className="inline text-blue-600 hover:underline break-all text-left align-baseline"
              >
                {label.length > 64 ? `${label.slice(0, 64)}…` : label}
              </button>
              {trailing}
            </React.Fragment>
          )
        }
        return <React.Fragment key={i}>{part}</React.Fragment>
      })}
    </span>
  )
}

export function RisicoCitationModalLayer({
  tenderId,
  children,
}: {
  tenderId: string
  children: React.ReactNode
}) {
  const [modal, setModal] = useState<{ url: string; title: string } | null>(null)
  const openCitation = useCallback((url: string, title?: string) => {
    const u = trimTrailingUrlPunctuation(url.trim())
    if (!/^https?:\/\//i.test(u)) return
    setModal({ url: u, title: (title || 'Bron').trim() || 'Bron' })
  }, [])

  return (
    <OpenCitationContext.Provider value={openCitation}>
      {children}
      <BronPageEmbedModal
        open={Boolean(modal)}
        url={modal?.url ?? ''}
        title={modal?.title ?? ''}
        tenderId={tenderId}
        onClose={() => setModal(null)}
      />
    </OpenCitationContext.Provider>
  )
}

export function CitedSourceButton({
  url,
  label,
}: {
  url: string
  label?: string
}) {
  const openCitation = useContext(OpenCitationContext)
  const u = trimTrailingUrlPunctuation(url.trim())
  if (!/^https?:\/\//i.test(u)) return null
  const short = u.replace(/^https?:\/\//, '')
  const display =
    label?.trim() ||
    (short.length > 56 ? `${short.slice(0, 48)}…` : short)
  return (
    <button
      type="button"
      onClick={() => openCitation(u, 'Geciteerde bron')}
      className="text-blue-600 hover:underline break-all text-left"
    >
      {display}
    </button>
  )
}
