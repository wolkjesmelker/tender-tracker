import { getDb } from '../db/connection'
import { APP_SETTING_POST_SCRAPE_ANALYZE_IMMEDIATELY } from '../../shared/constants'

/**
 * Wanneer true (default als key ontbreekt): na elke handmatige of geplande tracking-run worden
 * nieuwe aanbestedingen in de post-scrape AI-wachtrij gezet.
 */
export function isPostScrapeAnalyzeImmediatelyEnabled(): boolean {
  const row = getDb()
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(APP_SETTING_POST_SCRAPE_ANALYZE_IMMEDIATELY) as { value: string } | undefined
  if (row == null) return true
  const v = String(row.value).trim().toLowerCase()
  if (v === '' || v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  return true
}
