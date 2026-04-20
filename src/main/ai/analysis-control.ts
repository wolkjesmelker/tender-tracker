/** Pauze/stop voor lopende losse analyse (main process). */

let pauseRequested = false
let stopRequested = false
let activeTenderId = ''

export function analysisControlBegin(tenderId: string): void {
  pauseRequested = false
  stopRequested = false
  activeTenderId = tenderId
}

export function analysisControlReset(): void {
  pauseRequested = false
  stopRequested = false
  activeTenderId = ''
}

export function analysisControlRequestPause(): void {
  pauseRequested = true
}

export function analysisControlRequestStop(): void {
  stopRequested = true
}

/** Alleen pause/stop vlaggen wissen (na geslaagde pause zodat hervatten kan). */
export function analysisControlClearFlags(): void {
  pauseRequested = false
  stopRequested = false
}

export function analysisControlPoll(tenderId: string): 'pause' | 'stop' | null {
  if (activeTenderId !== tenderId) return null
  if (stopRequested) return 'stop'
  if (pauseRequested) return 'pause'
  return null
}

export function analysisControlActiveTenderId(): string {
  return activeTenderId
}
