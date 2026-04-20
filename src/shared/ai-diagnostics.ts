/**
 * Types voor het interne AI-/risico-diagnose-dashboard (Instellingen → AI-diagnose).
 * Geen API-sleutels; alleen samenvattingen en tellingen.
 */

export type AiDiagnosticsCheckpointRow = {
  tenderId: string
  titel: string | null
  updatedAt: string
  parseOk: boolean
  stage: string | null
  documentBlocks: number
  totalChars: number
  detailTextChars: number
  aiPhase: string | null
  criteriaChunksTotal: number | null
  criteriaChunksCompleted: number | null
  bronProgress: string
  dbProgress: string
}

export type AiDiagnosticsTokenEvent = {
  id: number
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  createdAt: string
}

export type AiDiagnosticsTenderSignals = {
  withCheckpoint: number
  withScoreNoRisico: number
  withRisico: number
  staleCheckpoints: number
}

export type AiDiagnosticsAiSettingsRedacted = {
  ai_provider: string
  ai_model: string
  moonshotBaseConfigured: boolean
  kimiCliPathConfigured: boolean
  ollamaBaseUrl: string
  /** Hoofd-API-sleutel (Claude/OpenAI/Ollama via `ai_api_key` in DB) */
  hasAiApiKey: boolean
  hasMoonshotKey: boolean
}

export type AiDiagnosticsTokenCostRow = {
  provider: string
  model: string
  label: string
  inputTokens: number
  outputTokens: number
  estimatedEurOrNull: number | null
}

export type AiDiagnosticsSnapshot = {
  collectedAt: string
  databasePath: string
  llmChunkConcurrency: number
  busyWork: { refCount: number; powerSaveActive: boolean }
  /** Geaggregeerd token- en kostenverbruik afgelopen 7 dagen per model. */
  tokenStats7d: {
    byModel: AiDiagnosticsTokenCostRow[]
    totalInputTokens: number
    totalOutputTokens: number
    totalEurOrNull: number | null
  }
  pipeline: {
    batchRunning: boolean
    batchCurrent: number
    batchTotal: number
    batchCurrentId: string
    batchCurrentTitle: string
    singleRunning: boolean
    singleAnalysisId: string | null
    pendingSingleAnalysisIds: string[]
    pendingPostScrapeIdsCount: number
    analysisPipelineBusy: boolean
  }
  risico: {
    running: boolean
    aanbestedingId: string | null
    queuedCount: number
    /** Laatst uitgezonden voortgang (IPC), ook tijdens lange LLM-wachttijd — niet afhankelijk van token-DB. */
    lastProgress: { step: string; percentage: number; agent: string } | null
  }
  checkpoints: AiDiagnosticsCheckpointRow[]
  tokenEventsRecent: AiDiagnosticsTokenEvent[]
  tokenEventsLast2Min: number
  tokenEventsLast15Min: number
  /** Aantal token-registraties in de laatste 6 uur (lange analyses/sessies). */
  tokenEventsLast6h: number
  /** Registraties met Kimi/Moonshot in de laatste 6 uur. */
  kimiTokenEventsLast6h: number
  tenderSignals: AiDiagnosticsTenderSignals
  aiSettings: AiDiagnosticsAiSettingsRedacted
  hints: string[]
}
