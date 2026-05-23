/**
 * UI-logica voor "nieuw" na een geplande scrape (scrape_schema.laatste_run).
 * Dag van de run: banner in de lijst. Dag erna: "Nieuw" op aanbestedingen die die dag zijn toegevoegd.
 */

export type ScheduleRowNieuw = {
  laatste_run?: string | null
  naam?: string | null
}

export function localDayKey(d: string | Date): string | null {
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return null
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addCalendarDaysFromKey(dayKey: string, deltaDays: number): string | null {
  const [y, m, d] = dayKey.split('-').map(Number)
  if (!y || !m || !d) return null
  const dt = new Date(y, m - 1, d + deltaDays)
  return localDayKey(dt)
}

/** Minstens één schema heeft vandaag (lokale datum) een laatste_run. */
export function hasSchemaScrapeOnLocalDay(
  schedules: ScheduleRowNieuw[] | null | undefined,
  now: Date = new Date(),
): boolean {
  const today = localDayKey(now)
  if (!today || !schedules?.length) return false
  for (const row of schedules) {
    if (!row.laatste_run) continue
    if (localDayKey(row.laatste_run) === today) return true
  }
  return false
}

/** Meest recente laatste_run-timestamp op een gegeven lokale kalenderdag (YYYY-MM-DD). */
export function latestLaatsteRunIsoOnLocalDay(
  schedules: ScheduleRowNieuw[] | null | undefined,
  dayKey: string,
): string | null {
  if (!schedules?.length) return null
  let best = -1
  for (const row of schedules) {
    if (!row.laatste_run) continue
    if (localDayKey(row.laatste_run) !== dayKey) continue
    const t = new Date(row.laatste_run).getTime()
    if (!Number.isNaN(t) && t > best) best = t
  }
  return best >= 0 ? new Date(best).toISOString() : null
}

/**
 * "Nieuw"-predicaat op een tender: alleen de dag ná een schema-scrape,
 * en alleen als de tender op die scrapedag is aangemaakt (proxy voor "die run gevonden").
 * Uploads worden uitgesloten.
 */
export function tenderIsSchemaNieuwDayAfter(
  tender: { created_at?: string | null; is_upload?: number | boolean | null },
  schedules: ScheduleRowNieuw[] | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!schedules?.length) return false
  if (tender.is_upload === 1 || tender.is_upload === true) return false
  const today = localDayKey(now)
  if (!today || !tender.created_at) return false
  const yesterday = addCalendarDaysFromKey(today, -1)
  if (!yesterday) return false
  const createdDay = localDayKey(tender.created_at)
  if (!createdDay || createdDay !== yesterday) return false
  for (const row of schedules) {
    if (!row.laatste_run) continue
    if (localDayKey(row.laatste_run) === yesterday) return true
  }
  return false
}
