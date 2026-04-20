/**
 * Herbruikbare fetch-hulp: retries bij tijdelijke netwerk-/TLS-fouten en duidelijke foutteksten.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Node/undici geeft bij TLS/DNS/connectiefouten vaak alleen `fetch failed`.
 * De onderliggende oorzaak zit meestal in `error.cause` (ECONNREFUSED, ENOTFOUND, …).
 */
export function formatFetchFailure(err: unknown, label: string, endpoint: string): Error {
  const parts: string[] = []
  let cur: unknown = err
  const seen = new Set<unknown>()
  for (let i = 0; i < 8 && cur && typeof cur === 'object' && !seen.has(cur); i++) {
    seen.add(cur)
    const o = cur as Record<string, unknown>
    if (typeof o.code === 'string' && o.code.trim()) parts.push(o.code.trim())
    if (typeof o.errno === 'number' && Number.isFinite(o.errno)) parts.push(`errno ${o.errno}`)
    if (typeof o.syscall === 'string' && o.syscall.trim()) {
      parts.push(String(o.syscall).trim())
    }
    const msg = typeof o.message === 'string' ? o.message.trim() : ''
    if (msg && msg !== 'fetch failed') parts.push(msg)
    cur = o.cause
  }
  const unique = [...new Set(parts)]
  const causeText = unique.length ? ` Oorzaak: ${unique.join(' · ')}.` : ''
  const tip =
    ' Controleer internet, VPN en firewall; bij een cloud-provider ook API-sleutel en (Moonshot) basis-URL onder Instellingen. Bij een zakelijke proxy: HTTPS_PROXY moet voor Node/Electron kloppen.'
  const base = err instanceof Error ? err.message : String(err)
  return new Error(`${label} (${endpoint}) — ${base}.${causeText}${tip}`)
}

const RETRYABLE_ERR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

function collectErrorCodes(err: unknown): string[] {
  const out: string[] = []
  let cur: unknown = err
  const seen = new Set<unknown>()
  for (let i = 0; i < 8 && cur && typeof cur === 'object' && !seen.has(cur); i++) {
    seen.add(cur)
    const o = cur as Record<string, unknown>
    if (typeof o.code === 'string' && o.code.trim()) out.push(o.code.trim())
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (name) out.push(name)
    cur = o.cause
  }
  return out
}

function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  if (msg.includes('fetch failed')) return true
  if (msg.includes('network error')) return true
  if (msg.includes('socket') && msg.includes('hang')) return true
  if (err.name === 'AbortError') return true
  for (const code of collectErrorCodes(err)) {
    if (RETRYABLE_ERR_CODES.has(code)) return true
  }
  return false
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

export interface FetchWithRetryOptions {
  /** Totaal aantal pogingen (eerste + retries). Standaard 5. */
  maxAttempts?: number
  /** Basispauze in ms (exponentieel met plafond). Standaard 1200. */
  baseDelayMs?: number
  /** Max wachttijd tussen pogingen. Standaard 25_000. */
  maxDelayMs?: number
  /**
   * Timeout per fetch-poging tot de **response** binnen is (status + headers).
   * Het volledig binnenlezen van de body valt hier **buiten** — gebruik {@link readResponseJsonWithTimeout}
   * (of vergelijkbaar) voor chat-API’s met grote of trage antwoorden.
   */
  timeoutPerAttemptMs?: number
}

/**
 * Leest `response.text()` en parset JSON met een harde timeout.
 * Zonder dit kan een trage of vastlopende body na een geslaagde `fetch` oneindig blijven hangen
 * (de AbortController in {@link fetchWithRetry} is dan al uitgeschakeld).
 */
export async function readResponseJsonWithTimeout(
  response: Response,
  timeoutMs: number,
  label = 'HTTP response',
): Promise<unknown> {
  const ms = Math.max(1000, timeoutMs)
  const text = await Promise.race([
    response.text(),
    new Promise<never>((_, rej) =>
      setTimeout(
        () =>
          rej(
            new Error(
              `${label}: timeout na ${ms}ms — headers OK maar antwoord-body niet tijdig volledig (grote invoer, trage upstream of netwerk).`,
            ),
          ),
        ms,
      ),
    ),
  ])
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(
      `${label}: ongeldige JSON in antwoord (begin: ${text.slice(0, 160).replace(/\s+/g, ' ')})`,
    )
  }
}

/**
 * Voert fetch uit met timeouts en retries bij typische tijdelijke fouten.
 * Gooit de laatste fout (Response of Error) als alle pogingen falen.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5)
  const baseDelayMs = options.baseDelayMs ?? 1200
  const maxDelayMs = options.maxDelayMs ?? 25_000
  const timeoutPerAttemptMs = options.timeoutPerAttemptMs ?? 180_000

  let lastFailure: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutPerAttemptMs)

    const outer = init.signal
    const onOuterAbort = () => controller.abort()
    if (outer) {
      if (outer.aborted) {
        clearTimeout(timer)
        outer.removeEventListener?.('abort', onOuterAbort)
        throw new Error('Request aborted')
      }
      outer.addEventListener('abort', onOuterAbort, { once: true })
    }

    const merged: RequestInit = {
      ...init,
      signal: controller.signal,
    }

    try {
      const res = await fetch(url, merged)
      // Timer afgebroken zodra headers binnen zijn; body-lezen heeft geen Abort meer via deze controller.
      clearTimeout(timer)
      if (outer) outer.removeEventListener('abort', onOuterAbort)

      if (res.ok) return res

      if (!isRetryableHttpStatus(res.status) || attempt === maxAttempts - 1) {
        return res
      }

      await res.text().catch(() => '')
      lastFailure = new Error(`HTTP ${res.status}`)
      const retryAfter = res.headers.get('retry-after')
      let extra = 0
      if (retryAfter) {
        const n = parseInt(retryAfter, 10)
        if (Number.isFinite(n)) extra = Math.min(60_000, n * 1000)
      }
      await sleep(extra + Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) * (0.85 + Math.random() * 0.3))
    } catch (e) {
      clearTimeout(timer)
      if (outer) outer.removeEventListener('abort', onOuterAbort)
      lastFailure = e

      if (init.signal?.aborted) {
        throw e instanceof Error ? e : new Error(String(e))
      }

      if (attempt === maxAttempts - 1 || !isRetryableNetworkError(e)) {
        throw e
      }
      await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) * (0.85 + Math.random() * 0.3))
    }
  }

  throw lastFailure instanceof Error ? lastFailure : new Error(String(lastFailure))
}
