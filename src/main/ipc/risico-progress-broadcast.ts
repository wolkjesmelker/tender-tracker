import { BrowserWindow, type WebContents } from 'electron'
import { IPC } from '../../shared/constants'
import { getRisicoRunSnapshot } from './risico-run-state'

export type RisicoProgressPayload = {
  aanbestedingId: string
  step: string
  percentage: number
  agent: string
}

const lastByTender = new Map<string, { step: string; percentage: number; agent: string }>()

/** Laatste UI-stap voor diagnose-snapshot (main process). */
export function getRisicoLastBroadcastForTender(
  aanbestedingId: string | null,
): { step: string; percentage: number; agent: string } | null {
  if (!aanbestedingId) return null
  return lastByTender.get(aanbestedingId) ?? null
}
const pendingTerminal: RisicoProgressPayload[] = []

function dedupePending(p: RisicoProgressPayload): void {
  const i = pendingTerminal.findIndex((x) => x.aanbestedingId === p.aanbestedingId)
  if (i >= 0) pendingTerminal.splice(i, 1)
  pendingTerminal.push(p)
}

/**
 * Stuurt risico-voortgang naar alle vensters. Zonder venster (bijv. macOS: hoofdvenster dicht)
 * worden terminal updates (≥100%) bewaard voor replay zodra de renderer weer luistert.
 */
export function broadcastRisicoProgress(payload: RisicoProgressPayload): void {
  const full: RisicoProgressPayload = {
    aanbestedingId: payload.aanbestedingId,
    step: payload.step,
    percentage: payload.percentage,
    agent: (payload.agent && payload.agent.trim()) || 'Kimi (risico-inventarisatie)',
  }
  lastByTender.set(full.aanbestedingId, {
    step: full.step,
    percentage: full.percentage,
    agent: full.agent,
  })

  const wins = BrowserWindow.getAllWindows()
  for (const w of wins) {
    const wc = w.webContents
    if (!wc.isDestroyed()) {
      wc.send(IPC.RISICO_PROGRESS, full)
    }
  }

  if (wins.length === 0 && full.percentage >= 100) {
    dedupePending(full)
  }
}

/**
 * Na paginaload: misgelopen terminal-events + huidige run (als die nog loopt) opnieuw naar deze renderer.
 */
export function replayRisicoUiToWebContents(wc: WebContents): void {
  if (wc.isDestroyed()) return

  for (const p of pendingTerminal) {
    wc.send(IPC.RISICO_PROGRESS, p)
  }
  pendingTerminal.length = 0

  const snap = getRisicoRunSnapshot()
  if (!snap.running || !snap.aanbestedingId) return

  const last = lastByTender.get(snap.aanbestedingId)
  if (last && last.percentage < 100) {
    wc.send(IPC.RISICO_PROGRESS, {
      aanbestedingId: snap.aanbestedingId,
      step: last.step,
      percentage: last.percentage,
      agent: last.agent,
    })
    return
  }
  if (!last) {
    wc.send(IPC.RISICO_PROGRESS, {
      aanbestedingId: snap.aanbestedingId,
      step: 'Risico-analyse wordt voortgezet op de achtergrond…',
      percentage: 5,
      agent: 'Kimi (risico-inventarisatie)',
    })
  }
}
