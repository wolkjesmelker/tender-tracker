import { BrowserWindow, type WebContents } from 'electron'
import { IPC } from '../../shared/constants'
import { getRisicoRunSnapshot } from './risico-run-state'
import type { RisicoAnalyseV2Result } from '../../shared/types-risico-v2'

export type RisicoProgressPayload = {
  aanbestedingId: string
  step: string
  percentage: number
  agent: string
}

export type RisicoDraftSnapshotPayload = {
  aanbestedingId: string
  assembledDraftStage: string
  assembledDraftSavedAt: string
  assembledDraft: RisicoAnalyseV2Result
}

const lastDraftByTender = new Map<string, RisicoDraftSnapshotPayload>()

/** Laatste draft-snapshot per tender voor replay na mount. */
export function getRisicoLastDraftForTender(
  aanbestedingId: string,
): RisicoDraftSnapshotPayload | null {
  return lastDraftByTender.get(aanbestedingId) ?? null
}

/**
 * Stuurt assembledDraft-snapshot naar alle vensters na elke stage-overgang.
 * Wordt bewaard voor replay naar nieuwe vensters/navigatie.
 */
export function broadcastRisicoDraftSnapshot(payload: RisicoDraftSnapshotPayload): void {
  lastDraftByTender.set(payload.aanbestedingId, payload)
  const wins = BrowserWindow.getAllWindows()
  for (const w of wins) {
    const wc = w.webContents
    if (!wc.isDestroyed()) {
      wc.send(IPC.RISICO_DRAFT_SNAPSHOT, payload)
    }
  }
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
 * Stuurt ook de laatste draft-snapshot mee als er een actieve run is.
 */
export function replayRisicoUiToWebContents(wc: WebContents): void {
  if (wc.isDestroyed()) return

  for (const p of pendingTerminal) {
    wc.send(IPC.RISICO_PROGRESS, p)
  }
  pendingTerminal.length = 0

  const snap = getRisicoRunSnapshot()
  if (!snap.running || !snap.aanbestedingId) return

  // Replay draft snapshot als die beschikbaar is
  const lastDraft = lastDraftByTender.get(snap.aanbestedingId)
  if (lastDraft) {
    wc.send(IPC.RISICO_DRAFT_SNAPSHOT, lastDraft)
  }

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
