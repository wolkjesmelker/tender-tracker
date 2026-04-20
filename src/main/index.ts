import { app, BrowserWindow, ipcMain, shell, protocol } from 'electron'
import path from 'path'
import fs from 'fs'

// Zonder dit vertraagt Chromium timers/JS sterk als het scherm uit staat of de PC “idle” is,
// waardoor browser-gebaseerde tracking (Mercell, België, documenten) lijkt te “hangen”.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
import { initDatabase } from './db/connection'
import { registerAllHandlers } from './ipc'
import { restoreAuthStateOnStartup } from './ipc/auth.ipc'
import { setStartupLicenseStatus } from './ipc/app.ipc'
import { verifyLicenseSeat } from './license/license-service'
import { initScheduler } from './scheduler/scheduler'
import { initCloudBackupScheduler } from './backup/backup-scheduler'
import { setupAutoUpdater } from './updater'
import log from 'electron-log'

// Custom protocol for serving local tender documents in iframes (avoids data: URI size limits)
// Must be registered before app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tender-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false,
    },
  },
])

log.transports.file.level = 'info'
log.transports.console.level = 'debug'

// Ensure only one instance of the app runs at a time.
// If a second instance is launched, it will quit and focus the first one.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  log.info('Another instance is already running - quitting this one')
  app.quit()
}

app.on('second-instance', () => {
  // Someone tried to start a second instance - focus our window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

process.env.DIST_ELECTRON = path.join(__dirname, '..')
process.env.DIST = path.join(process.env.DIST_ELECTRON, '../dist')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.DIST_ELECTRON, '../src/renderer/public')
  : process.env.DIST

let mainWindow: BrowserWindow | null = null
let appShellIpcRegistered = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'TenderTracker - Van de Kreeke Groep',
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: true,
      backgroundThrottling: false,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerAppShellIpcOnce(): void {
  if (appShellIpcRegistered) return
  appShellIpcRegistered = true

  ipcMain.on('app:quit', () => {
    app.quit()
  })

  ipcMain.handle('app:open-external', (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      void shell.openExternal(url)
    }
  })
}

app.whenReady().then(async () => {
  log.info('TenderTracker starting...')

  // Serve local tender documents via tender-file://local/{tenderId}/{fileName}
  // Serve bron preview cache via tender-file://bron-cache/{fileName}
  // This avoids data: URI size limits when displaying large PDFs in iframes.
  protocol.handle('tender-file', (request) => {
    try {
      const url = new URL(request.url)
      const host = url.host // 'local' or 'bron-cache'
      const parts = url.pathname.replace(/^\//, '').split('/')

      if (host === 'bron-cache') {
        // Serve from temporary bron preview cache
        const fileName = decodeURIComponent(parts[0] || '')
        if (!fileName || fileName.includes('..') || fileName.includes('/')) {
          return new Response('Forbidden', { status: 403 })
        }
        const tmpDir = path.join(app.getPath('userData'), 'bron-preview-cache')
        const fullPath = path.join(tmpDir, fileName)
        if (!path.resolve(fullPath).startsWith(path.resolve(tmpDir))) {
          return new Response('Forbidden', { status: 403 })
        }
        if (!fs.existsSync(fullPath)) return new Response('Not found', { status: 404 })
        const data = fs.readFileSync(fullPath)
        return new Response(data, {
          status: 200,
          headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(data.length) },
        })
      }

      if (host === 'local') {
        // Serve from internal tender document store
        if (parts.length < 2) return new Response('Not found', { status: 404 })
        const tenderId = decodeURIComponent(parts[0])
        const fileName = decodeURIComponent(parts.slice(1).join('/'))
        if (
          !tenderId || !fileName ||
          tenderId.includes('..') || tenderId.includes('/') ||
          fileName.includes('..')
        ) {
          return new Response('Forbidden', { status: 403 })
        }
        const userData = app.getPath('userData')
        const roots = [
          path.join(userData, 'internal-document-store', tenderId),
          path.join(userData, 'documents', tenderId),
        ]
        for (const dir of roots) {
          const fullPath = path.join(dir, fileName)
          if (!path.resolve(fullPath).startsWith(path.resolve(dir))) continue
          if (!fs.existsSync(fullPath)) continue
          const data = fs.readFileSync(fullPath)
          const ext = path.extname(fileName).toLowerCase()
          const mimeTypes: Record<string, string> = {
            '.pdf': 'application/pdf',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
          }
          const mime = mimeTypes[ext] || 'application/octet-stream'
          return new Response(data, {
            status: 200,
            headers: { 'Content-Type': mime, 'Content-Length': String(data.length) },
          })
        }
        return new Response('Not found', { status: 404 })
      }

      return new Response('Not found', { status: 404 })
    } catch (err) {
      log.warn('tender-file protocol error:', err)
      return new Response('Internal error', { status: 500 })
    }
  })

  // Initialize database
  initDatabase()
  log.info('Database initialized')

  // Register IPC handlers
  registerAllHandlers()
  registerAppShellIpcOnce()
  log.info('IPC handlers registered')

  await restoreAuthStateOnStartup()
  log.info('Auth-sessies (TenderNed / Mercell / België) hersteld vanaf schijf')

  const licenseStatus = await verifyLicenseSeat()
  setStartupLicenseStatus(licenseStatus)
  if (!licenseStatus.ok) {
    log.warn('[license] Seat-check geweigerd:', licenseStatus.reason, licenseStatus.message)
  }

  // Create main window
  createWindow()

  setupAutoUpdater(getMainWindow)

  // Initialize scheduler
  initScheduler()
  log.info('Scheduler initialized')

  initCloudBackupScheduler()
  log.info('Cloud backup scheduler initialized')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Export for IPC handlers that need window reference
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
