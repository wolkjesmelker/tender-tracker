import cron from 'node-cron'
import log from 'electron-log'
import { runDailyBackupToSubfolder, getCloudSyncSettingsFromDb, runMirrorToCloudFolder } from './cloud-backup'

let dailyTask: cron.ScheduledTask | null = null

/** Dagelijks om 03:00 lokale tijd: backup-map bijwerken; daarna korte mirror zodat de hoofdmap actueel blijft. */
export function initCloudBackupScheduler(): void {
  if (dailyTask) {
    dailyTask.stop()
    dailyTask = null
  }

  if (!cron.validate('0 3 * * *')) {
    log.warn('[cloud-backup] Ongeldige cron voor dagelijkse backup')
    return
  }

  dailyTask = cron.schedule('0 3 * * *', () => {
    const { path: syncPath, enabled } = getCloudSyncSettingsFromDb()
    if (!enabled || !syncPath) {
      log.debug('[cloud-backup] Geplande run overgeslagen (niet ingeschakeld of geen map)')
      return
    }
    log.info('[cloud-backup] Geplande dagelijkse synchronisatie start')
    const backupRes = runDailyBackupToSubfolder(syncPath)
    if (!backupRes.ok) {
      log.warn('[cloud-backup] Dagelijkse backup:', backupRes.error)
    }
    const mirrorRes = runMirrorToCloudFolder(syncPath)
    if (!mirrorRes.ok) {
      log.warn('[cloud-backup] Mirror na backup:', mirrorRes.error)
    }
  })

  log.info('[cloud-backup] Dagelijkse planner actief (03:00): backup-submap + mirror')
}
