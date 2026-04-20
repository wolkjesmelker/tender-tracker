import { ipcMain, BrowserWindow, session, app, shell } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'
import { getMainWindow } from '../index'
import { getCookiesPath } from '../utils/paths'
import log from 'electron-log'
import path from 'path'
import fs from 'fs'

const authWindows = new Map<string, BrowserWindow>()
/** Gesynchroniseerd met echte cookies in persist:auth-* (ook na app-herstart). */
const authenticatedSites = new Set<string>()

/** Zelfde UA als document-fetch en Mercell-scraper. */
const CHROME_LIKE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * JavaScript dat vóór paginascripts wordt geïnjecteerd via CDP
 * om Electron/WebDriver-detectie te omzeilen (o.a. Azure AD B2C check).
 */
const WEBDRIVER_SPOOF_JS = `
  try { Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true }); } catch(e) {}
  try { Object.defineProperty(navigator, 'languages', { get: () => ['nl-NL', 'nl', 'en-US', 'en'], configurable: true }); } catch(e) {}
  try { Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true }); } catch(e) {}
  window.chrome = window.chrome || { runtime: {}, loadTimes: function(){}, csi: function(){}, app: {} };
`

/**
 * Cookies die ZEKER geen authenticatie-bewijs zijn (tracking / analytics / consent).
 * Bezoek aan een pagina zonder in te loggen zet dit soort cookies — die tellen niet mee.
 */
const SKIP_COOKIE_RE =
  /^(_ga|_gid|_gcl|_fbp|_gat|gtm|CookieConsent|cookieconsent|cookie_|gdpr|privacy|ajs_|intercom|hubspot|drift|segment|mixpanel|amplitude|heap|__utm|OptanonConsent|euphoria|ai_|ApplicationInsights|ARRAffinity|BIGipServer)/i

/**
 * Geeft true als de cookie waarschijnlijk een server-side auth-cookie is:
 *  – httpOnly (browser mag hem niet lezen via JS → typisch voor auth-tokens)
 *  – EN een waarde die lang genoeg is om een echte token te zijn (> 20 tekens)
 *  – EN niet een tracking-cookie
 * Of: de naam bevat expliciet auth-gerelateerde termen.
 */
function cookieIndicatesAuth(cookie: Electron.Cookie): boolean {
  if (SKIP_COOKIE_RE.test(cookie.name)) return false
  const valueLen = (cookie.value ?? '').length
  if (cookie.httpOnly && valueLen > 20) return true
  return /\b(auth|token|\.aspnetcore|identity|bearer|access_token|refresh_token|id_token|login_state|x-ms-cpim)\b/i.test(
    cookie.name
  )
}

function hasNonExpiredCookies(cookies: Electron.Cookie[]): boolean {
  if (!cookies?.length) return false
  const nowSec = Date.now() / 1000
  return cookies.some(c => {
    if (c.expirationDate == null || c.expirationDate === undefined) return true
    return c.expirationDate > nowSec
  })
}

async function injectCookiesFromFile(siteId: string): Promise<number> {
  const cookieFile = path.join(getCookiesPath(), `${siteId}.json`)
  if (!fs.existsSync(cookieFile)) return 0
  let n = 0
  try {
    const saved = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'))
    if (!Array.isArray(saved)) return 0
    const ses = session.fromPartition(`persist:auth-${siteId}`)
    for (const c of saved) {
      try {
        await ses.cookies.set(c as Electron.CookiesSetDetails)
        n++
      } catch {
        /* cookie-formaat of domein mismatch */
      }
    }
  } catch (e) {
    log.warn(`Auth: cookiebestand voor ${siteId} onleesbaar:`, e)
  }
  return n
}

async function sessionHasUsableAuth(siteId: string): Promise<boolean> {
  const ses = session.fromPartition(`persist:auth-${siteId}`)
  const cookies = await ses.cookies.get({})
  // Gebruik strikte filter: alleen echte auth-cookies tellen mee
  const authCookies = cookies.filter(cookieIndicatesAuth)
  return hasNonExpiredCookies(authCookies)
}

async function syncAuthenticatedFlagFromSession(siteId: string): Promise<boolean> {
  const ok = await sessionHasUsableAuth(siteId)
  if (ok) authenticatedSites.add(siteId)
  else authenticatedSites.delete(siteId)
  return ok
}

/** Bewaar alle cookies van een sessie naar disk-backup. */
async function saveCookiesToFile(siteId: string, ses: Electron.Session): Promise<void> {
  try {
    const cookies = await ses.cookies.get({})
    if (cookies.length === 0) return
    const cookieData = cookies.map(c => ({
      url: `https://${(c.domain || '').replace(/^\./, '')}${c.path || '/'}`,
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: c.secure,
      httpOnly: c.httpOnly,
      expirationDate: c.expirationDate,
    }))
    const cookieFile = path.join(getCookiesPath(), `${siteId}.json`)
    fs.writeFileSync(cookieFile, JSON.stringify(cookieData, null, 2))
  } catch (e) {
    log.warn(`Auth: cookie-opslaan mislukt voor ${siteId}:`, e)
  }
}

/**
 * Koppel CDP aan een BrowserWindow en injecteer de webdriver-spoof
 * vóór elke paginascript. Faalt stilletjes als CDP niet beschikbaar is.
 */
async function attachCdpSpoof(wc: Electron.WebContents): Promise<void> {
  try {
    wc.debugger.attach('1.3')
    await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: WEBDRIVER_SPOOF_JS,
    })
  } catch (e) {
    log.warn('CDP attach/spoof mislukt (niet kritiek):', (e as Error).message)
  }
}

/**
 * Bij app-start: JSON-backup terug in de sessie zetten.
 * Status wordt NIET op "ingelogd" gezet — dat vereist een echte bevestiging
 * (expliciete login via auth-venster, of een succesvolle scrape).
 * Zo voorkom je vals-positieve "Ingelogd"-badges op basis van verlopen cookies.
 */
export async function restoreAuthStateOnStartup(): Promise<void> {
  try {
    const rows = getDb().prepare("SELECT id, naam FROM bron_websites WHERE auth_type != 'none'").all() as {
      id: string
      naam: string
    }[]
    for (const { id, naam } of rows) {
      const injected = await injectCookiesFromFile(id)
      if (injected > 0) {
        log.info(`Auth: ${injected} cookie(s) teruggezet voor ${id} (${naam}) — sessie nog niet geverifieerd`)
      }
      // Bewust GEEN syncAuthenticatedFlagFromSession: cookies ≠ actieve sessie.
      // Status wordt bijgewerkt zodra de gebruiker inlogt of een scrape slaagt.
    }
  } catch (e) {
    log.warn('restoreAuthStateOnStartup:', e)
  }
}

/** Schrijf alle auth-partities naar JSON (best effort bij afsluiten). */
export async function persistAllAuthCookiesToDisk(): Promise<void> {
  try {
    const rows = getDb().prepare("SELECT id FROM bron_websites WHERE auth_type != 'none'").all() as { id: string }[]
    for (const { id } of rows) {
      const ses = session.fromPartition(`persist:auth-${id}`)
      await saveCookiesToFile(id, ses)
    }
    log.info('Auth: cookie-backup bij afsluiten bijgewerkt')
  } catch (e) {
    log.warn('persistAllAuthCookiesToDisk:', e)
  }
}

export function registerAuthHandlers(): void {
  ipcMain.handle(IPC.AUTH_STATUS, async () => {
    const sources = getDb().prepare("SELECT * FROM bron_websites WHERE auth_type != 'none'").all() as any[]
    const out: {
      siteId: string
      siteName: string
      isAuthenticated: boolean
      loginUrl: string
    }[] = []

    for (const s of sources) {
      // Gebruik uitsluitend de in-memory staat — status wordt ALLEEN "true" na een
      // expliciete login via het auth-venster of een bevestigde scrape.
      // Cookie-gebaseerde herinspectie hier geeft vals-positieven.
      out.push({
        siteId: s.id,
        siteName: s.naam,
        isAuthenticated: authenticatedSites.has(s.id),
        loginUrl: s.login_url,
      })
    }
    return out
  })

  /**
   * Opent een standalone Electron-browser voor het inloggen op een bron.
   *
   * Cruciale verbeteringen t.o.v. de vorige versie:
   * - UA wordt zowel op sessie- als vensterniveau gezet
   * - CDP injecteert `navigator.webdriver = false` vóór paginascripts (Azure AD B2C fix)
   * - Venster opent direct zichtbaar (geen wit flash door show:false/ready-to-show)
   * - Start-URL is de hoofd-app URL (source.url), niet de Azure AD login-URL;
   *   Mercell's eigen frontend handelt de SSO-redirect af, wat betrouwbaarder is
   * - Cookies worden bij elke navigatie opgeslagen (ook tijdens OAuth-redirects)
   * - OAuth-popups krijgen dezelfde partition én CDP-spoof
   */
  ipcMain.handle(IPC.AUTH_OPEN_LOGIN, async (_event, siteId: string) => {
    try {
      const source = getDb().prepare('SELECT * FROM bron_websites WHERE id = ?').get(siteId) as any
      if (!source) {
        return { success: false, error: 'Bron niet gevonden' }
      }

      // Sluit bestaand venster
      if (authWindows.has(siteId)) {
        try { authWindows.get(siteId)?.close() } catch { /* noop */ }
        authWindows.delete(siteId)
      }

      const partition = `persist:auth-${siteId}`
      const ses = session.fromPartition(partition)

      ses.setUserAgent(CHROME_LIKE_UA)
      await injectCookiesFromFile(siteId)

      const authWindow = new BrowserWindow({
        width: 1280,
        height: 900,
        title: `Inloggen — ${source.naam}`,
        show: true,
        webPreferences: {
          partition,
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
        },
      })

      authWindows.set(siteId, authWindow)

      // CDP fire-and-forget — NIET blockerend, anders crash als venster snel navigeert
      void attachCdpSpoof(authWindow.webContents)

      authWindow.webContents.setUserAgent(CHROME_LIKE_UA)

      // OAuth-popups (bijv. Microsoft login)
      authWindow.webContents.setWindowOpenHandler((details) => {
        log.info(`Auth popup (${siteId}): ${details.url.slice(0, 160)}`)
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 1024,
            height: 768,
            webPreferences: {
              partition,
              nodeIntegration: false,
              contextIsolation: true,
              backgroundThrottling: false,
            },
          },
        }
      })

      authWindow.webContents.on('did-create-window', (childWindow) => {
        childWindow.webContents.setUserAgent(CHROME_LIKE_UA)
        void attachCdpSpoof(childWindow.webContents)
      })

      // ── Login-detectie helper ────────────────────────────────────────────────
      // Geeft true als url wijst op een succesvol ingelogde sessiepagina.
      const isSuccessUrl = (url: string): boolean => {
        if (siteId === 'mercell') {
          // Na OAuth-callback landen we op s2c.mercell.com/logon?code=...
          // of na SPA-redirect op s2c.mercell.com/ of /search etc.
          return (
            url.includes('s2c.mercell.com') &&
            !/login|signin|Account|identity\.|password\/|registration/i.test(url)
          )
        }
        // Generiek: zelfde host als de geconfigureerde URL, geen login-patroon
        try {
          const siteHost = new URL(source.url || source.login_url).hostname
          return url.includes(siteHost) && !/login|signin|account|auth|oauth|identity/i.test(url)
        } catch {
          return false
        }
      }

      const notifyLoggedIn = (url: string) => {
        if (authenticatedSites.has(siteId)) return // al gemeld
        authenticatedSites.add(siteId)
        // Haal mainWindow HIER op (niet buiten de callback) zodat we altijd de actuele ref hebben
        const mw = getMainWindow()
        if (mw && !mw.isDestroyed()) {
          mw.webContents.send(IPC.AUTH_LOGIN_COMPLETE, {
            siteId,
            success: true,
            siteName: source.naam,
          })
        }
        log.info(`Auth: succesvol ingelogd bij ${source.naam} (${url.slice(0, 100)})`)
      }
      // ────────────────────────────────────────────────────────────────────────

      // Volledige navigaties (OAuth-redirectketen, callback-URL)
      authWindow.webContents.on('did-navigate', async (_, url) => {
        log.info(`Auth nav (${siteId}): ${url}`)
        await saveCookiesToFile(siteId, ses)
        if (isSuccessUrl(url)) notifyLoggedIn(url)
      })

      // SPA-navigaties (pushState/replaceState) — Mercell navigeert na login via SPA
      authWindow.webContents.on('did-navigate-in-page', async (_, url) => {
        await saveCookiesToFile(siteId, ses)
        if (isSuccessUrl(url)) {
          log.info(`Auth SPA-nav (${siteId}): ${url}`)
          notifyLoggedIn(url)
        }
      })

      authWindow.webContents.on('did-fail-load', (_e, code, desc, failedUrl) => {
        if (!failedUrl || failedUrl === 'about:blank' || failedUrl.startsWith('about:')) return
        log.warn(`Auth laad-fout (${siteId}): ${code} ${desc} — ${failedUrl}`)
      })

      authWindow.on('closed', () => {
        authWindows.delete(siteId)
      })

      // Start op vaste Mercell discovery-pagina; andere bronnen gebruiken hun geconfigureerde URL.
      const startUrl =
        siteId === 'mercell'
          ? 'https://s2c.mercell.com/today'
          : source.url?.startsWith('http')
            ? source.url
            : (source.login_url || source.url)
      try {
        await authWindow.loadURL(startUrl, { userAgent: CHROME_LIKE_UA })
      } catch (err) {
        log.warn(`Auth loadURL mislukt voor ${source.naam}:`, err)
      }

      return { success: true }
    } catch (err: any) {
      log.error(`AUTH_OPEN_LOGIN mislukt voor ${siteId}:`, err?.message ?? err)
      return { success: false, error: err?.message ?? 'Onbekende fout' }
    }
  })

  /**
   * Open Mercell (of een andere bron) in de standaardbrowser van het systeem.
   * Handig als fallback — maar de cookies komen NIET in Electron terecht.
   * Gebruik AUTH_OPEN_LOGIN voor de geïntegreerde login die cookies deelt met de scraper.
   */
  ipcMain.handle(IPC.AUTH_OPEN_EXTERNAL, (_event, siteId: string) => {
    const source = getDb().prepare('SELECT * FROM bron_websites WHERE id = ?').get(siteId) as any
    if (!source) return { success: false, error: 'Bron niet gevonden' }
    const url =
      siteId === 'mercell'
        ? 'https://s2c.mercell.com/today'
        : source.url?.startsWith('http')
          ? source.url
          : source.login_url
    shell.openExternal(url)
    return { success: true }
  })

  ipcMain.handle(IPC.AUTH_LOGOUT, (_event, siteId: string) => {
    authenticatedSites.delete(siteId)
    const cookieFile = path.join(getCookiesPath(), `${siteId}.json`)
    if (fs.existsSync(cookieFile)) fs.unlinkSync(cookieFile)
    const partition = `persist:auth-${siteId}`
    session.fromPartition(partition).clearStorageData()
    // Notify renderer so auth status badge updates immediately
    const mw = getMainWindow()
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send(IPC.AUTH_LOGIN_COMPLETE, { siteId, success: false, siteName: siteId })
    }
    log.info(`Auth: uitgelogd bij ${siteId} — cookies en sessie gewist`)
    return { success: true }
  })

  app.on('before-quit', () => {
    void persistAllAuthCookiesToDisk()
  })
}

export function isAuthenticated(siteId: string): boolean {
  return authenticatedSites.has(siteId)
}

export function getSessionForSite(siteId: string): Electron.Session {
  return session.fromPartition(`persist:auth-${siteId}`)
}

/**
 * Markeer een site als ingelogd (bijv. na succesvolle scrape).
 * Stuurt ook een IPC-bericht naar de renderer om de UI bij te werken.
 */
export function markSiteAsLoggedIn(siteId: string, siteName?: string): void {
  if (authenticatedSites.has(siteId)) return // al gemarkeerd, geen onnodige update
  authenticatedSites.add(siteId)
  const mainWindow = getMainWindow()
  mainWindow?.webContents.send(IPC.AUTH_LOGIN_COMPLETE, {
    siteId,
    success: true,
    siteName: siteName ?? siteId,
  })
  log.info(`Auth: ${siteId} gemarkeerd als ingelogd (via scrape-bevestiging)`)
}

/**
 * Markeer een site als NIET ingelogd (bijv. bij login-redirect tijdens scrapen).
 * Stuurt ook een IPC-bericht naar de renderer om de UI bij te werken.
 */
export function markSiteAsLoggedOut(siteId: string, siteName?: string): void {
  if (!authenticatedSites.has(siteId)) return // al niet ingelogd
  authenticatedSites.delete(siteId)
  const mainWindow = getMainWindow()
  mainWindow?.webContents.send(IPC.AUTH_LOGIN_COMPLETE, {
    siteId,
    success: false,
    siteName: siteName ?? siteId,
  })
  log.info(`Auth: ${siteId} gemarkeerd als NIET ingelogd (sessie verlopen)`)
}
