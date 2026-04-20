/** Gedeelde run-status voor analyse-voortgang en replay (geen import van analysis.ipc). */

let singleAnalysisRunning = false
let singleAnalysisAanbestedingId: string | null = null

let batchAnalysisRunning = false
let batchCurrentAanbestedingId: string | null = null

export function setSingleAnalysisRunState(running: boolean, aanbestedingId: string | null): void {
  singleAnalysisRunning = running
  singleAnalysisAanbestedingId = aanbestedingId
}

export function setBatchAnalysisRunState(running: boolean, currentAanbestedingId: string | null): void {
  batchAnalysisRunning = running
  batchCurrentAanbestedingId = currentAanbestedingId
}

/** Tender-ID waarvoor nu analyse-UI actief zou moeten zijn (losse analyse of huidige batch-item). */
export function getActiveAnalysisAanbestedingId(): string | null {
  if (singleAnalysisRunning && singleAnalysisAanbestedingId) return singleAnalysisAanbestedingId
  if (batchAnalysisRunning && batchCurrentAanbestedingId) return batchCurrentAanbestedingId
  return null
}
