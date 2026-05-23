/**
 * Geplande tracking: dezelfde stappen als op de Tracking-pagina —
 * voor elke site met inlog: knop «Inloggen» (zelfde IPC als de UI), korte pauze
 * ertussen, daarna ALLE geselecteerde bron scrapen (niets weglaten).
 * Schema zonder bron-IDs = alle actieve bronnen (zoals alle checkboxes aan).
 */

import log from 'electron-log'
import type { BronWebsite, ScrapeProgress } from '../../shared/types'
import { openAuthLoginWindowForSite } from '../ipc/auth.ipc'

/** Tijd tussen openen van opeenvolgende inlogvensters (ms). */
const STAGGER_BETWEEN_LOGIN_MS = 2000

function staggerMs(): number {
  const raw = process.env.SCHEDULED_LOGIN_STAGGER_MS
  const n = raw != null && raw !== '' ? parseInt(raw, 10) : NaN
  if (Number.isFinite(n) && n >= 0) return n
  return STAGGER_BETWEEN_LOGIN_MS
}

/**
 * Simuleert achtereenvolgens een klik op elke «Inloggen»-knop (Tracking → Inlogstatus websites).
 * Daarna roept de scheduler `runScrapePipeline` aan met de volledige `sources`-lijst.
 */
export async function runScheduledLoginButtonClicks(
  sources: BronWebsite[],
  options?: {
    onProgress?: (p: ScrapeProgress) => void
    progressJobId?: string
  }
): Promise<void> {
  const jobId = options?.progressJobId ?? 'scheduled-prep'
  const gap = staggerMs()
  const needLogin = sources.filter((s) => s.auth_type && s.auth_type !== 'none')
  if (needLogin.length === 0) {
    options?.onProgress?.({
      jobId,
      status: 'bezig',
      message: 'Geplande tracking: geen inlogplichtige bronnen — start scraping…',
      found: 0,
    })
    return
  }

  for (let i = 0; i < needLogin.length; i++) {
    const s = needLogin[i]
    const n = i + 1
    options?.onProgress?.({
      jobId,
      status: 'bezig',
      message: `Geplande tracking: Inloggen (${n}/${needLogin.length}) — ${s.naam}…`,
      found: 0,
    })
    const r = await openAuthLoginWindowForSite(s.id)
    if (!r.success) {
      log.warn(`[geplande tracking] Inlogvenster ${s.naam}: ${r.error || 'onbekend'} — scrape start toch met alle bronnen.`)
    }
    if (i < needLogin.length - 1 && gap > 0) {
      await new Promise((res) => setTimeout(res, gap))
    }
  }

  options?.onProgress?.({
    jobId,
    status: 'gereed',
    message: `Inlogacties gedaan — start tracking met ${sources.length} ${sources.length === 1 ? 'bron' : 'bronnen'}…`,
    found: 0,
  })
}
