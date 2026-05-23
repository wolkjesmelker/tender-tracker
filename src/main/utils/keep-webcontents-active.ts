import type { BrowserWindow } from 'electron'

/**
 * Extra bescherming naast `webPreferences.backgroundThrottling: false`: Chromium kan
 * verborgen of niet-gefocuste vensters nog steeds afremmen (occlusie). Dit zet dat uit
 * voor scrape-/auth-/document-vensters zodat timers en pagina-JS normaal blijven lopen.
 */
export function keepWebContentsActiveForBackgroundWork(win: BrowserWindow): void {
  win.webContents.setBackgroundThrottling(false)
}
