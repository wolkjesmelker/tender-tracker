import { app } from 'electron'
import log from 'electron-log'
import type { LicenseStatus } from '../../shared/types'
import { getLicenseBuildConfig } from './build-env'
import { getOrCreateDeviceId } from './device-id'

/**
 * Seat-check tegen een door de ontwikkelaar gehoste HTTPS-endpoint.
 * Zonder LICENSE_SERVER_URL + LICENSE_PRODUCT_KEY bij de release-build: check wordt overgeslagen (ontwikkeling).
 *
 * Contract: POST {base}/v1/seat
 * Headers: Authorization: Bearer <PRODUCT_KEY>, Content-Type: application/json
 * Body: { deviceId, product: "tender-tracker", version }
 *
 * 200 + JSON: { "allowed": true, "maxSeats"?: number, "usedSeats"?: number }
 * 403 + JSON: { "allowed": false, "reason": "SEAT_LIMIT", "message"?: string }
 * 401: ongeldige product key
 */
export async function verifyLicenseSeat(): Promise<LicenseStatus> {
  const { serverUrl, productKey } = getLicenseBuildConfig()

  if (!serverUrl || !productKey) {
    log.info('[license] Geen server/productkey in build — seat-check overgeslagen')
    return { ok: true, skipped: true }
  }

  const base = serverUrl.replace(/\/$/, '')
  const deviceId = getOrCreateDeviceId()

  try {
    const res = await fetch(`${base}/v1/seat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${productKey}`,
      },
      body: JSON.stringify({
        deviceId,
        product: 'tender-tracker',
        version: app.getVersion(),
      }),
    })

    const text = await res.text()
    let body: Record<string, unknown> = {}
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      log.warn('[license] Ongeldige JSON van server', text.slice(0, 200))
    }

    if (res.status === 401) {
      return {
        ok: false,
        reason: 'INVALID_KEY',
        message:
          'Licentieverificatie mislukt (configuratie). Neem contact op met Questric.',
      }
    }

    if (res.ok && body.allowed === true) {
      return {
        ok: true,
        maxSeats: typeof body.maxSeats === 'number' ? body.maxSeats : undefined,
        usedSeats: typeof body.usedSeats === 'number' ? body.usedSeats : undefined,
      }
    }

    const reason = body.reason === 'SEAT_LIMIT' ? 'SEAT_LIMIT' : 'SERVER'
    const message =
      typeof body.message === 'string' && body.message.trim()
        ? body.message.trim()
        : res.status === 403
          ? 'Het maximale aantal installaties voor deze licentie is bereikt. Neem contact op met Questric voor extra seats.'
          : 'Licentie geweigerd. Neem contact op met Questric.'

    return { ok: false, reason, message }
  } catch (e) {
    log.warn('[license] Netwerkfout', e)
    return {
      ok: false,
      reason: 'NETWORK',
      message:
        'Kan geen verbinding maken met de licentieserver. Controleer internet en probeer opnieuw.',
    }
  }
}
