import cron from 'node-cron'
import { getDb } from '../db/connection'
import { runScrapePipeline } from '../scraping/pipeline'
import { getMainWindow } from '../index'
import { IPC } from '../../shared/constants'
import { enqueuePostScrapeAnalysis } from '../ipc/analysis.ipc'
import { isScrapingActive, setScrapingActive } from '../ipc/scraping.ipc'
import { filterTenderIdsForAutoPostScrapeAnalysis } from '../utils/post-scrape-auto-analysis-filter'
import { runScheduledLoginButtonClicks } from './scheduled-scrape-prepare'
import { acquireBusyWorkBlocker, releaseBusyWorkBlocker } from '../utils/busy-work-blocker'
import log from 'electron-log'

const activeJobs = new Map<string, cron.ScheduledTask>()

function cronTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

export function initScheduler(): void {
  try {
    const db = getDb()
    const schedules = db.prepare('SELECT * FROM scrape_schema WHERE is_actief = 1').all() as any[]

    for (const schedule of schedules) {
      addSchedule(schedule)
    }

    log.info(`Scheduler initialized with ${schedules.length} active schedule(s)`)
  } catch (error: any) {
    log.error('Scheduler init failed:', error)
  }
}

export function addSchedule(schedule: any): void {
  if (!cron.validate(schedule.cron_expressie)) {
    log.warn(`Invalid cron expression for schedule ${schedule.id}: ${schedule.cron_expressie}`)
    return
  }

  removeSchedule(schedule.id)

  const tz = cronTimezone()
  const task = cron.schedule(
    schedule.cron_expressie,
    async () => {
      if (isScrapingActive()) {
        log.info(`Geplande scrape "${schedule.naam}" overgeslagen: er loopt al een scrape.`)
        return
      }
      log.info(`Running scheduled scrape: ${schedule.naam}`)
      setScrapingActive(true)
      acquireBusyWorkBlocker('scheduled-scrape')

      const db = getDb()
      const sourceIds = JSON.parse(schedule.bron_website_ids || '[]')
      const sources = sourceIds.length > 0
        ? db.prepare(`SELECT * FROM bron_websites WHERE id IN (${sourceIds.map(() => '?').join(',')}) AND is_actief = 1`).all(...sourceIds)
        : db.prepare('SELECT * FROM bron_websites WHERE is_actief = 1').all()

      const zoektermen = schedule.zoektermen
        ? JSON.parse(schedule.zoektermen)
        : (db.prepare('SELECT term FROM zoektermen WHERE is_actief = 1 ORDER BY volgorde').all() as { term: string }[]).map(z => z.term)

      const mainWindow = getMainWindow()
      const prepJobId = `scheduled-prep-${schedule.id}`

      try {
        await runScheduledLoginButtonClicks(sources as any[], {
          progressJobId: prepJobId,
          onProgress: (p) => {
            mainWindow?.webContents.send(IPC.SCRAPING_PROGRESS, p)
          },
        })

        log.info(
          `Geplande scrape "${schedule.naam}": alle geselecteerde bronnen (${(sources as any[]).length}) — alleen NIEUWE aanbestedingen (bron_url nog niet in DB) krijgen documentdownload.`,
        )

        const { newTenderIds } = await runScrapePipeline(
          sources as any[],
          zoektermen,
          (progress) => {
            mainWindow?.webContents.send(IPC.SCRAPING_PROGRESS, progress)
          },
          { triggeredBy: 'scheduled' }
        )

        db.prepare("UPDATE scrape_schema SET laatste_run = datetime('now') WHERE id = ?").run(schedule.id)

        if (newTenderIds.length > 0) {
          const autoIds = await filterTenderIdsForAutoPostScrapeAnalysis(newTenderIds)
          if (autoIds.length > 0) {
            enqueuePostScrapeAnalysis(autoIds)
            log.info(
              `Geplande scrape "${schedule.naam}": AI-analyse + risico in wachtrij voor ${autoIds.length} nieuwe aanbesteding(en) (werkgebied / instelling).`,
            )
          } else {
            log.info(
              `Geplande scrape "${schedule.naam}": ${newTenderIds.length} nieuwe aanbesteding(en) — geen automatische AI-wachtrij (werkgebied-filter of "Verwerk meteen analyse" uit).`,
            )
          }
        }
      } catch (error: any) {
        log.error(`Scheduled scrape ${schedule.naam} failed:`, error)
      } finally {
        releaseBusyWorkBlocker('scheduled-scrape')
        setScrapingActive(false)
      }
    },
    tz ? { timezone: tz, scheduled: true } : { scheduled: true },
  )

  activeJobs.set(schedule.id, task)
  log.info(
    `Schedule added: ${schedule.naam} (${schedule.cron_expressie})${tz ? ` [tz ${tz}]` : ''}`,
  )
}

export function removeSchedule(scheduleId: string): void {
  const task = activeJobs.get(scheduleId)
  if (task) {
    task.stop()
    activeJobs.delete(scheduleId)
    log.info(`Schedule removed: ${scheduleId}`)
  }
}

export function toggleSchedule(scheduleId: string, active: boolean): void {
  if (active) {
    const db = getDb()
    const schedule = db.prepare('SELECT * FROM scrape_schema WHERE id = ?').get(scheduleId) as any
    if (schedule) addSchedule(schedule)
  } else {
    removeSchedule(scheduleId)
  }
}
