import { powerSaveBlocker } from 'electron'
import log from 'electron-log'

let refCount = 0
let blockId: number | null = null

/**
 * Voorkomt app-nap / proces-suspend (o.a. macOS) en verminderd risico op systeem-slaap tijdens
 * scrape-, document- of AI-taken. Werkt samen met backgroundThrottling:false + Chromium-flags
 * in de main process (anders blijft de pagina-JS wél traag bij uitgescherm/idle).
 * Refcount: parallelle taken delen één blocker.
 */
export function acquireBusyWorkBlocker(reason: string): void {
  refCount += 1
  if (refCount === 1) {
    blockId = powerSaveBlocker.start('prevent-app-suspension')
    log.info(`[busy-work] powerSaveBlocker gestart (${reason}), id=${blockId}`)
  }
}

export function releaseBusyWorkBlocker(reason: string): void {
  refCount = Math.max(0, refCount - 1)
  if (refCount === 0 && blockId != null) {
    powerSaveBlocker.stop(blockId)
    log.info(`[busy-work] powerSaveBlocker gestopt (${reason})`)
    blockId = null
  }
}

/** Voor interne diagnose: is prevent-app-suspension actief? */
export function getBusyWorkBlockerDebug(): { refCount: number; powerSaveActive: boolean } {
  return { refCount, powerSaveActive: blockId != null }
}
