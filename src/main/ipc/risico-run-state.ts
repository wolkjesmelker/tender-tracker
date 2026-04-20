/** Gedeelde status voor batch-status IPC (geen import van risico.ipc → voorkomt circulaire deps). */

let risicoAnalyseRunning = false
let risicoAnalyseAanbestedingId: string | null = null
const risicoWachtrij: string[] = []

export function setRisicoRunState(running: boolean, aanbestedingId: string | null): void {
  risicoAnalyseRunning = running
  risicoAnalyseAanbestedingId = aanbestedingId
}

export function getRisicoRunSnapshot(): {
  running: boolean
  aanbestedingId: string | null
  queuedIds: string[]
} {
  return {
    running: risicoAnalyseRunning,
    aanbestedingId: risicoAnalyseAanbestedingId,
    queuedIds: [...risicoWachtrij],
  }
}

/** Volgende ID uit de wachtrij, of undefined. Alleen aanroepen als er geen run actief is. */
export function shiftRisicoWachtrij(): string | undefined {
  return risicoWachtrij.shift()
}

/**
 * Zet een aanbesteding in de risico-wachtrij. Geen dubbele ID’s; actieve run telt niet als wachtrij.
 * @returns positie 1-based in wachtrij, of 0 bij al actief op dit ID
 */
export function tryEnqueueRisicoWachtrij(
  aanbestedingId: string,
  actiefId: string | null
): { ok: boolean; position: number; alreadyActive: boolean; duplicateInQueue: boolean } {
  const id = String(aanbestedingId || '').trim()
  if (!id) return { ok: false, position: 0, alreadyActive: false, duplicateInQueue: false }
  if (actiefId === id) return { ok: false, position: 0, alreadyActive: true, duplicateInQueue: false }
  const idx = risicoWachtrij.indexOf(id)
  if (idx >= 0) {
    return { ok: true, position: idx + 1, alreadyActive: false, duplicateInQueue: true }
  }
  risicoWachtrij.push(id)
  return { ok: true, position: risicoWachtrij.length, alreadyActive: false, duplicateInQueue: false }
}
