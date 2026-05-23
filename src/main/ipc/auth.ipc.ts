import { ipcMain, BrowserWindow, session, app, shell } from 'electron'
import { getDb } from '../db/connection'
import { IPC } from '../../shared/constants'
import { getMainWindow } from '../index'
import { getCookiesPath } from '../utils/paths'
import { keepWebContentsActiveForBackgroundWork } from '../utils/keep-webcontents-active'
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

/** Cookie-backup terugzetten + in-memory ingelogd-vlag volgens echte auth-cookies (o.a. geplande tracking). */
export async function refreshAuthFromSessionCookies(siteId: string): Promise<boolean> {
  await injectCookiesFromFile(siteId)
  return syncAuthenticatedFlagFromSession(siteId)
}

/**
 * Wacht tot de site als ingelogd geldt (UI-event of geldige auth-cookies).
 * Gebruikt door geplande tracking na openAuthLoginWindowForSite.
 */
export async function waitForSiteAuthenticated(
  siteId: string,
  maxWaitMs: number,
  pollMs = 2500
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    if (authenticatedSites.has(siteId)) return true
    if (await sessionHasUsableAuth(siteId)) {
      authenticatedSites.add(siteId)
      const mw = getMainWindow()
      const row = getDb().prepare('SELECT naam FROM bron_websites WHERE id = ?').get(siteId) as
        | { naam: string }
        | undefined
      if (mw && !mw.isDestroyed() && row?.naam) {
        mw.webContents.send(IPC.AUTH_LOGIN_COMPLETE, {
          siteId,
          success: true,
          siteName: row.naam,
        })
      }
      return true
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return authenticatedSites.has(siteId)
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

/**
 * Na het openen van een inlogvenster weer het hoofdvenster voorop (esthetiek: login blijft open maar TenderTracker blijft zichtbaar).
 */
function focusMainWindowAfterAuthWindow(): void {
  const mw = getMainWindow()
  if (!mw || mw.isDestroyed()) return
  if (mw.isMinimized()) mw.restore()
  mw.show()
  try {
    mw.moveTop()
  } catch {
    /* noop */
  }
  try {
    app.focus()
  } catch {
    /* noop */
  }
  mw.focus()
}

/**
 * Zelfde logica als de knop «Inloggen» op de Tracking-pagina — te gebruiken vanuit de main-process
 * (o.a. geplande tracking).
 */
export async function openAuthLoginWindowForSite(
  siteId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const source = getDb().prepare('SELECT * FROM bron_websites WHERE id = ?').get(siteId) as any
    if (!source) {
      return { success: false, error: 'Bron niet gevonden' }
    }

    if (authWindows.has(siteId)) {
      try {
        authWindows.get(siteId)?.close()
      } catch {
        /* noop */
      }
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
    keepWebContentsActiveForBackgroundWork(authWindow)

    void attachCdpSpoof(authWindow.webContents)

    authWindow.webContents.setUserAgent(CHROME_LIKE_UA)

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
      keepWebContentsActiveForBackgroundWork(childWindow)
      childWindow.webContents.setUserAgent(CHROME_LIKE_UA)
      void attachCdpSpoof(childWindow.webContents)
      setTimeout(() => focusMainWindowAfterAuthWindow(), 120)
    })

    const isSuccessUrl = (url: string): boolean => {
      if (siteId === 'mercell') {
        return (
          url.includes('s2c.mercell.com') &&
          !/login|signin|Account|identity\.|password\/|registration/i.test(url)
        )
      }
      try {
        const siteHost = new URL(source.url || source.login_url).hostname
        return url.includes(siteHost) && !/login|signin|account|auth|oauth|identity/i.test(url)
      } catch {
        return false
      }
    }

    const notifyLoggedIn = (url: string) => {
      if (authenticatedSites.has(siteId)) return
      authenticatedSites.add(siteId)
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

    authWindow.webContents.on('did-navigate', async (_, url) => {
      log.info(`Auth nav (${siteId}): ${url}`)
      await saveCookiesToFile(siteId, ses)
      if (isSuccessUrl(url)) notifyLoggedIn(url)
    })

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

    // Auto-fill inloggegevens als deze zijn opgeslagen
    if (source.login_gebruikersnaam && source.login_wachtwoord) {
      const gebruikersnaam = source.login_gebruikersnaam as string
      const wachtwoord = source.login_wachtwoord as string

      const tryAutoFill = async (url: string) => {
        // Alleen invullen op login-achtige pagina's
        const looksLikeLoginPage =
          /login|signin|aanmelden|inloggen|auth|identity|account\/login|password/i.test(url)
        if (!looksLikeLoginPage) return

        // Korte pauze zodat het formulier in de DOM staat
        await new Promise(r => setTimeout(r, 1200))

        try {
          const filled = await authWindow.webContents.executeJavaScript(`
            (function() {
              // Zoek gebruikersnaam-veld: type email of text, of name/id/autocomplete bevat user/email/login
              const usernameSelectors = [
                'input[type="email"]',
                'input[autocomplete="username"]',
                'input[autocomplete="email"]',
                'input[name*="user" i]',
                'input[name*="email" i]',
                'input[name*="login" i]',
                'input[id*="user" i]',
                'input[id*="email" i]',
                'input[id*="login" i]',
                'input[type="text"]',
              ];
              const passwordSelectors = [
                'input[type="password"]',
                'input[autocomplete="current-password"]',
              ];

              let usernameInput = null;
              for (const sel of usernameSelectors) {
                const el = document.querySelector(sel);
                if (el && el.offsetParent !== null) { usernameInput = el; break; }
              }
              let passwordInput = null;
              for (const sel of passwordSelectors) {
                const el = document.querySelector(sel);
                if (el && el.offsetParent !== null) { passwordInput = el; break; }
              }

              if (!usernameInput && !passwordInput) return 'geen-formulier';

              function fillInput(el, value) {
                el.focus();
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                nativeInputValueSetter.call(el, value);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }

              if (usernameInput) fillInput(usernameInput, ${JSON.stringify(gebruikersnaam)});
              if (passwordInput) fillInput(passwordInput, ${JSON.stringify(wachtwoord)});

              return 'ingevuld';
            })()
          `)
          if (filled === 'ingevuld') {
            log.info(`Auth auto-fill: inloggegevens ingevuld voor ${source.naam}`)
          } else {
            log.info(`Auth auto-fill: geen loginformulier gevonden op ${url.slice(0, 80)}`)
          }
        } catch (e) {
          log.warn(`Auth auto-fill mislukt voor ${source.naam}:`, (e as Error).message)
        }
      }

      authWindow.webContents.on('did-navigate', (_, url) => {
        void tryAutoFill(url)
      })
      authWindow.webContents.on('did-frame-finish-load', () => {
        const url = authWindow.webContents.getURL()
        void tryAutoFill(url)
      })
    }    authWindow.on('closed', () => {
      authWindows.delete(siteId)
    })

    const startUrl =
      siteId === 'mercell'
        ? 'https://s2c.mercell.com/today'
        : source.url?.startsWith('http')
          ? source.url
          : source.login_url || source.url
    try {
      await authWindow.loadURL(startUrl, { userAgent: CHROME_LIKE_UA })
    } catch (err) {
      log.warn(`Auth loadURL mislukt voor ${source.naam}:`, err)
    }

    setImmediate(() => {
      focusMainWindowAfterAuthWindow()
    })

    return { success: true }
  } catch (err: any) {
    log.error(`openAuthLoginWindowForSite mislukt voor ${siteId}:`, err?.message ?? err)
    return { success: false, error: err?.message ?? 'Onbekende fout' }
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
    return openAuthLoginWindowForSite(siteId)
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
