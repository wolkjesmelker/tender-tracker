import { useEffect, useState } from 'react'
import { api, isElectron } from '../../lib/ipc-client'
import questricLogo from '../../assets/questric-logo.png'

export function Footer() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (!isElectron || !api.getAppVersion) return
    void api.getAppVersion().then(setVersion).catch(() => setVersion(''))
  }, [])

  return (
    <footer className="border-t bg-[var(--card)] px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <a
            href="https://www.questric.eu"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0"
            title="Questric"
          >
            <img
              src={questricLogo}
              alt="Questric — AI Application Developers"
              className="h-[18px] w-auto max-w-[110px] object-contain object-left drop-shadow-sm"
            />
          </a>
          <div className="text-[11px] leading-snug text-[var(--muted-foreground)]">
            <p>
              <span className="font-medium text-[var(--foreground)]">Questric</span>
              {' — '}
              <a
                href="https://www.questric.eu"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline"
              >
                www.questric.eu
              </a>
            </p>
            <p className="mt-1 max-w-xl">
              © {new Date().getFullYear()} Questric. Alle rechten voorbehouden. Zonder uitdrukkelijke schriftelijke
              toestemming is verveelvoudiging, distributie of doorverkoop van deze software niet toegestaan.
            </p>
          </div>
        </div>
        {version ? (
          <span className="shrink-0 text-[10px] tabular-nums text-[var(--muted-foreground)] sm:text-right">
            v{version}
          </span>
        ) : null}
      </div>
    </footer>
  )
}
