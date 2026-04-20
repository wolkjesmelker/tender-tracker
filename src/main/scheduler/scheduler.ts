import cron from 'node-cron'
import { getDb } from '../db/connection'
import { runScrapePipeline } from '../scraping/pipeline'
import { getMainWindow } from '../index'
import { IPC } from '../../shared/constants'
import { enqueuePostScrapeAnalysis } from '../ipc/analysis.ipc'
import { isScrapingActive, setScrapingActive } from '../ipc/scraping.ipc'
import log from 'electron-log'

const activeJobs = new Map<string, cron.ScheduledTask>()

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

  const task = cron.schedule(schedule.cron_expressie, async () => {
    if (isScrapingActive()) {
      log.info(`Geplande scrape "${schedule.naam}" overgeslagen: er loopt al een scrape.`)
      return
    }
    log.info(`Running scheduled scrape: ${schedule.naam}`)
    setScrapingActive(true)

    const db = getDb()
    const sourceIds = JSON.parse(schedule.bron_website_ids || '[]')
    const sources = sourceIds.length > 0
      ? db.prepare(`SELECT * FROM bron_websites WHERE id IN (${sourceIds.map(() => '?').join(',')}) AND is_actief = 1`).all(...sourceIds)
      : db.prepare('SELECT * FROM bron_websites WHERE is_actief = 1').all()

    const zoektermen = schedule.zoektermen
      ? JSON.parse(schedule.zoektermen)
      : (db.prepare('SELECT term FROM zoektermen WHERE is_actief = 1 ORDER BY volgorde').all() as { term: string }[]).map(z => z.term)

    const mainWindow = getMainWindow()

    try {
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
        enqueuePostScrapeAnalysis(newTenderIds)
        log.info(
          `Scheduled scrape "${schedule.naam}": AI-analyse + risico in wachtrij voor ${newTenderIds.length} nieuwe aanbesteding(en)`
        )
      }
    } catch (error: any) {
      log.error(`Scheduled scrape ${schedule.naam} failed:`, error)
    } finally {
      setScrapingActive(false)
    }
  })

  activeJobs.set(schedule.id, task)
  log.info(`Schedule added: ${schedule.naam} (${schedule.cron_expressie})`)
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
