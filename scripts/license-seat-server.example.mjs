#!/usr/bin/env node
/**
 * Voorbeeld licentieserver (Node18+). Alleen voor demo — productie: gebruik een echte DB/KV
 * en HTTPS achter een reverse proxy.
 *
 * Start: node scripts/license-seat-server.example.mjs
 * Stel in je release-build in:
 *   LICENSE_SERVER_URL=http://localhost:8799 LICENSE_PRODUCT_KEY=geheim npm run build
 *
 * Contract: zie src/main/license/license-service.ts
 */

import http from 'http'

const PORT = 8799
/** Moet exact overeenkomen met LICENSE_PRODUCT_KEY bij de app-build */
const PRODUCT_KEYS = new Set(['vervang-dit-door-jouw-geheime-sleutel'])
/** Maximaal aantal unieke deviceId-registraties */
const MAX_SEATS = 5

/** @type {Map<string, true>} */
const devices = new Map()

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'POST' && req.url === '/v1/seat') {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      const auth = req.headers.authorization || ''
      const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
      if (!PRODUCT_KEYS.has(key)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ allowed: false, reason: 'INVALID_KEY' }))
        return
      }
      let payload
      try {
        payload = JSON.parse(body || '{}')
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ allowed: false, reason: 'BAD_JSON' }))
        return
      }
      const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId : ''
      if (!deviceId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ allowed: false, reason: 'NO_DEVICE' }))
        return
      }

      if (devices.has(deviceId)) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            allowed: true,
            maxSeats: MAX_SEATS,
            usedSeats: devices.size,
          })
        )
        return
      }

      if (devices.size >= MAX_SEATS) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            allowed: false,
            reason: 'SEAT_LIMIT',
            message: 'Maximum aantal installaties bereikt voor deze licentie.',
          })
        )
        return
      }

      devices.set(deviceId, true)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          allowed: true,
          maxSeats: MAX_SEATS,
          usedSeats: devices.size,
        })
      )
    })
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, () => {
  console.log(`License seat server listening on http://127.0.0.1:${PORT}`)
  console.log(`POST /v1/seat — max seats: ${MAX_SEATS}`)
})
